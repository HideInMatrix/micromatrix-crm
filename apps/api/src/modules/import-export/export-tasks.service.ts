import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { ExportTaskVO } from '@micromatrix/shared'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AsyncJobsService } from '../../async-jobs/async-jobs.service'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PENDING_PER_USER = 10

export interface QueuedExportTaskPayload {
  version: 1
  query: unknown
  input: unknown
}

export interface ExportBuildResult {
  data: Buffer
  rowCount: number
}

@Injectable()
export class ExportTasksService {
  private readonly root: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly asyncJobs: AsyncJobsService,
    config: ConfigService,
  ) {
    const uploadRoot = config.get<string>('UPLOAD_DIR') ?? path.resolve(__dirname, '../../../uploads')
    this.root = path.join(uploadRoot, 'exports')
  }


  async enqueue(
    user: AuthUser,
    input: {
      module: string
      fileName: string
      payload: QueuedExportTaskPayload
    },
  ): Promise<ExportTaskVO> {
    const fileName = this.normalizeFileName(input.fileName)
    const payload = this.jsonValue(input.payload)
    const task = await this.prisma.$transaction(async (tx) => {
      const lockKey = `export-user:${user.tenantId}:${user.id}`
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked`,
      )
      const pendingCount = await tx.exportTask.count({
        where: { tenantId: user.tenantId, userId: user.id, status: 'PENDING' },
      })
      if (pendingCount >= MAX_PENDING_PER_USER) {
        throw new BadRequestException('当前已有 10 个导出任务正在处理，请稍后再试')
      }
      const duplicate = await tx.exportTask.findFirst({
        where: {
          tenantId: user.tenantId,
          userId: user.id,
          module: input.module,
          status: 'PENDING',
        },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException('当前模块已有导出任务正在处理，请勿重复提交')
      return tx.exportTask.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          module: input.module,
          fileName,
          payload,
          expiresAt: new Date(Date.now() + DAY_MS),
        },
      })
    })

    try {
      await this.asyncJobs.enqueueExport(task.id)
      return this.toVO(task)
    } catch (error) {
      await this.prisma.exportTask.deleteMany({
        where: { id: task.id, tenantId: user.tenantId, userId: user.id, status: 'PENDING' },
      })
      throw error
    }
  }

  async beginAttempt(taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.exportTask.findUnique({ where: { id: taskId } })
      if (!current || current.status !== 'PENDING' || current.expiresAt.getTime() <= Date.now()) return null
      return tx.exportTask.update({
        where: { id: taskId },
        data: {
          attempts: { increment: 1 },
          ...(current.startedAt ? {} : { startedAt: new Date() }),
        },
      })
    })
  }

  async taskForWorker(taskId: string) {
    return this.prisma.exportTask.findUnique({ where: { id: taskId } })
  }

  async complete(taskId: string, user: { tenantId: string; id: string }, result: ExportBuildResult): Promise<boolean> {
    const dir = path.join(this.root, user.tenantId, user.id)
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${taskId}.xlsx`)
    await fs.writeFile(filePath, result.data)
    const completedAt = new Date()
    const updated = await this.prisma.exportTask.updateMany({
      where: { id: taskId, tenantId: user.tenantId, userId: user.id, status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        filePath,
        rowCount: result.rowCount,
        fileSize: result.data.byteLength,
        errorMessage: null,
        completedAt,
      },
    })
    if (updated.count === 1) return true
    await fs.rm(filePath, { force: true }).catch(() => undefined)
    return false
  }

  async fail(taskId: string, message: string): Promise<void> {
    await this.prisma.exportTask.updateMany({
      where: { id: taskId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        errorMessage: message.slice(0, 500),
        completedAt: new Date(),
      },
    })
  }

  async recoverPending(): Promise<{ recovered: number; kept: number; failedLegacy: number }> {
    const pending = await this.prisma.exportTask.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 2_000,
      select: { id: true, payload: true },
    })
    let recovered = 0
    let kept = 0
    let failedLegacy = 0
    for (const task of pending) {
      if (!task.payload) {
        await this.fail(task.id, '历史导出任务缺少异步执行参数，请重新创建导出任务')
        failedLegacy += 1
        continue
      }
      const result = await this.asyncJobs.ensureExportJob(task.id)
      if (result === 'RECOVERED') recovered += 1
      else kept += 1
    }
    return { recovered, kept, failedLegacy }
  }

  async list(user: AuthUser): Promise<ExportTaskVO[]> {
    await this.cleanupExpired(user)
    const tasks = await this.prisma.exportTask.findMany({
      where: { tenantId: user.tenantId, userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return tasks.map((task) => this.toVO(task))
  }

  async download(user: AuthUser, id: string) {
    const task = await this.getOwnTask(user, id)
    if (task.status !== 'SUCCESS' || !task.filePath) throw new BadRequestException('导出文件尚未生成完成')
    if (task.expiresAt.getTime() <= Date.now()) throw new BadRequestException('导出文件已过期')
    try {
      await fs.access(task.filePath)
    } catch {
      throw new NotFoundException('导出文件不存在或已清理')
    }
    return { fileName: `${task.fileName}.xlsx`, stream: createReadStream(task.filePath) }
  }

  async cancel(user: AuthUser, id: string): Promise<{ id: string }> {
    const task = await this.getOwnTask(user, id)
    await this.prisma.exportTask.update({
      where: { id },
      data: { status: 'CANCELED', filePath: null, completedAt: task.completedAt ?? new Date() },
    })
    await this.asyncJobs.cancelExportJob(id)
    if (task.filePath) await fs.rm(task.filePath, { force: true }).catch(() => undefined)
    return { id }
  }

  private async getOwnTask(user: AuthUser, id: string) {
    const task = await this.prisma.exportTask.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.id },
    })
    if (!task) throw new NotFoundException('导出任务不存在')
    return task
  }

  private async cleanupExpired(user: AuthUser) {
    const expired = await this.prisma.exportTask.findMany({
      where: { tenantId: user.tenantId, userId: user.id, expiresAt: { lte: new Date() } },
      select: { id: true, filePath: true },
    })
    for (const task of expired) {
      if (task.filePath) await fs.rm(task.filePath, { force: true }).catch(() => undefined)
    }
    if (expired.length > 0) {
      await this.prisma.exportTask.deleteMany({ where: { id: { in: expired.map((task) => task.id) } } })
    }
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
  }

  private normalizeFileName(fileName: string) {
    const normalized = fileName.trim().replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]/g, '_')
    if (!normalized) throw new BadRequestException('导出文件名不能为空')
    return normalized.slice(0, 50)
  }

  private toVO(task: {
    id: string
    module: string
    fileName: string
    status: string
    rowCount: number
    fileSize: number | null
    errorMessage: string | null
    createdAt: Date
    completedAt: Date | null
    expiresAt: Date
  }): ExportTaskVO {
    return {
      id: task.id,
      module: task.module,
      fileName: task.fileName,
      status: task.status as ExportTaskVO['status'],
      rowCount: task.rowCount,
      fileSize: task.fileSize,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
      expiresAt: task.expiresAt.toISOString(),
    }
  }
}
