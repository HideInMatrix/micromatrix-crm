import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'
import type { AuthUser } from '../../common/auth-user'
import type { ExportTaskVO } from '@micromatrix/shared'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import {
  prisma8Now,
  prisma8TimestampToISOString,
} from '../../prisma/prisma8-temporal.js'
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
    private readonly prisma8: Prisma8Service,
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
    const client = this.prisma8.client
    const task = await client.transaction(async (tx) => {
      const lockKey = `export-user:${user.tenantId}:${user.id}`
      const lockQuery = client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${lockKey}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break

      const exportTasks = tx.orm.public.ExportTasks
      const pending = await exportTasks
        .where({ tenantId: user.tenantId, userId: user.id, status: 'PENDING' })
        .select('id')
        .limit(MAX_PENDING_PER_USER)
        .all()
      if (pending.length >= MAX_PENDING_PER_USER) {
        throw new BadRequestException('当前已有 10 个导出任务正在处理，请稍后再试')
      }
      const duplicate = await exportTasks
        .where({
          tenantId: user.tenantId,
          userId: user.id,
          module: input.module,
          status: 'PENDING',
        })
        .select('id')
        .first()
      if (duplicate) throw new BadRequestException('当前模块已有导出任务正在处理，请勿重复提交')
      return exportTasks
        .select(
          'id',
          'module',
          'fileName',
          'status',
          'rowCount',
          'fileSize',
          'errorMessage',
          'createdAt',
          'completedAt',
          'expiresAt',
        )
        .create({
          tenantId: user.tenantId,
          userId: user.id,
          module: input.module,
          fileName,
          payload,
          expiresAt: prisma8Now().add({ milliseconds: DAY_MS }),
        })
    })

    try {
      await this.asyncJobs.enqueueExport(task.id)
      return this.toVO(task)
    } catch (error) {
      await this.tasks()
        .where({ id: task.id, tenantId: user.tenantId, userId: user.id, status: 'PENDING' })
        .deleteAndCount()
      throw error
    }
  }

  async beginAttempt(taskId: string) {
    return this.prisma8.client.transaction(async (tx) => {
      const tasks = tx.orm.public.ExportTasks
      const current = await tasks.where({ id: taskId }).first()
      if (
        !current ||
        current.status !== 'PENDING' ||
        current.expiresAt.epochMilliseconds <= Date.now()
      ) {
        return null
      }
      return tasks.where({ id: taskId }).update({
        attempts: current.attempts + 1,
        ...(current.startedAt ? {} : { startedAt: prisma8Now() }),
      })
    })
  }

  async taskForWorker(taskId: string) {
    return this.tasks().where({ id: taskId }).first()
  }

  async complete(taskId: string, user: { tenantId: string; id: string }, result: ExportBuildResult): Promise<boolean> {
    const dir = path.join(this.root, user.tenantId, user.id)
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${taskId}.xlsx`)
    await fs.writeFile(filePath, result.data)
    const completedAt = prisma8Now()
    const updated = await this.tasks()
      .where({ id: taskId, tenantId: user.tenantId, userId: user.id, status: 'PENDING' })
      .updateAndCount({
        status: 'SUCCESS',
        filePath,
        rowCount: result.rowCount,
        fileSize: result.data.byteLength,
        errorMessage: null,
        completedAt,
      })
    if (updated === 1) return true
    await fs.rm(filePath, { force: true }).catch(() => undefined)
    return false
  }

  async fail(taskId: string, message: string): Promise<void> {
    await this.tasks()
      .where({ id: taskId, status: 'PENDING' })
      .updateAndCount({
        status: 'FAILED',
        errorMessage: message.slice(0, 500),
        completedAt: prisma8Now(),
      })
  }

  async recoverPending(): Promise<{ recovered: number; kept: number; failedLegacy: number }> {
    const pending = await this.tasks()
      .where({ status: 'PENDING' })
      .where((task) => task.expiresAt.gt(prisma8Now()))
      .orderBy((task) => task.createdAt.asc())
      .limit(2_000)
      .select('id', 'payload')
      .all()
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
    const tasks = await this.tasks()
      .where({ tenantId: user.tenantId, userId: user.id })
      .where((task) => task.expiresAt.gt(prisma8Now()))
      .orderBy((task) => task.createdAt.desc())
      .limit(100)
      .all()
    return tasks.map((task) => this.toVO(task))
  }

  async download(user: AuthUser, id: string) {
    const task = await this.getOwnTask(user, id)
    if (task.status !== 'SUCCESS' || !task.filePath) throw new BadRequestException('导出文件尚未生成完成')
    if (task.expiresAt.epochMilliseconds <= Date.now()) {
      throw new BadRequestException('导出文件已过期')
    }
    try {
      await fs.access(task.filePath)
    } catch {
      throw new NotFoundException('导出文件不存在或已清理')
    }
    return { fileName: `${task.fileName}.xlsx`, stream: createReadStream(task.filePath) }
  }

  async cancel(user: AuthUser, id: string): Promise<{ id: string }> {
    const task = await this.getOwnTask(user, id)
    await this.tasks().where({ id }).update({
      status: 'CANCELED',
      filePath: null,
      completedAt: task.completedAt ?? prisma8Now(),
    })
    await this.asyncJobs.cancelExportJob(id)
    if (task.filePath) await fs.rm(task.filePath, { force: true }).catch(() => undefined)
    return { id }
  }

  private async getOwnTask(user: AuthUser, id: string) {
    const task = await this.tasks().where({ id, tenantId: user.tenantId, userId: user.id }).first()
    if (!task) throw new NotFoundException('导出任务不存在')
    return task
  }

  private async cleanupExpired(user: AuthUser) {
    const expired = await this.tasks()
      .where({ tenantId: user.tenantId, userId: user.id })
      .where((task) => task.expiresAt.lte(prisma8Now()))
      .select('id', 'filePath')
      .all()
    for (const task of expired) {
      if (task.filePath) await fs.rm(task.filePath, { force: true }).catch(() => undefined)
    }
    if (expired.length > 0) {
      await this.tasks()
        .where((task) => task.id.in(expired.map((item) => item.id)))
        .deleteAndCount()
    }
  }

  private tasks() {
    return this.prisma8.client.orm.public.ExportTasks
  }

  private jsonValue(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
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
    createdAt: Parameters<typeof prisma8TimestampToISOString>[0]
    completedAt: Parameters<typeof prisma8TimestampToISOString>[0] | null
    expiresAt: Parameters<typeof prisma8TimestampToISOString>[0]
  }): ExportTaskVO {
    return {
      id: task.id,
      module: task.module,
      fileName: task.fileName,
      status: task.status as ExportTaskVO['status'],
      rowCount: task.rowCount,
      fileSize: task.fileSize,
      errorMessage: task.errorMessage,
      createdAt: prisma8TimestampToISOString(task.createdAt),
      completedAt: task.completedAt ? prisma8TimestampToISOString(task.completedAt) : null,
      expiresAt: prisma8TimestampToISOString(task.expiresAt),
    }
  }
}
