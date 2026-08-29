import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { ExportTaskVO } from '@micromatrix/shared'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { PrismaService } from '../../prisma/prisma.service'
import { SpreadsheetService, type SpreadsheetColumn } from './spreadsheet.service'

const DAY_MS = 24 * 60 * 60 * 1000

@Injectable()
export class ExportTasksService {
  private readonly root: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly spreadsheet: SpreadsheetService,
    config: ConfigService,
  ) {
    const uploadRoot = config.get<string>('UPLOAD_DIR') ?? path.resolve(__dirname, '../../../uploads')
    this.root = path.join(uploadRoot, 'exports')
  }

  async create(
    user: AuthUser,
    input: {
      module: string
      fileName: string
      columns: SpreadsheetColumn[]
      rows: Record<string, unknown>[]
    },
  ): Promise<ExportTaskVO> {
    const fileName = this.normalizeFileName(input.fileName)
    const task = await this.prisma.exportTask.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        module: input.module,
        fileName,
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    })

    try {
      const data = await this.spreadsheet.buildExportWorkbook(input.columns, input.rows)
      const dir = path.join(this.root, user.tenantId, user.id)
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${task.id}.xlsx`)
      await fs.writeFile(filePath, data)
      const completed = await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: 'SUCCESS',
          filePath,
          rowCount: input.rows.length,
          fileSize: data.byteLength,
          completedAt: new Date(),
        },
      })
      return this.toVO(completed)
    } catch (error) {
      const failed = await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : '导出失败',
          completedAt: new Date(),
        },
      })
      return this.toVO(failed)
    }
  }

  async createFromBuffer(
    user: AuthUser,
    input: { module: string; fileName: string; data: Buffer; rowCount: number },
  ): Promise<ExportTaskVO> {
    const fileName = this.normalizeFileName(input.fileName)
    const task = await this.prisma.exportTask.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        module: input.module,
        fileName,
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    })
    try {
      const dir = path.join(this.root, user.tenantId, user.id)
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${task.id}.xlsx`)
      await fs.writeFile(filePath, input.data)
      const completed = await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: 'SUCCESS',
          filePath,
          rowCount: input.rowCount,
          fileSize: input.data.byteLength,
          completedAt: new Date(),
        },
      })
      return this.toVO(completed)
    } catch (error) {
      const failed = await this.prisma.exportTask.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : '导出失败',
          completedAt: new Date(),
        },
      })
      return this.toVO(failed)
    }
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
    if (task.filePath) await fs.rm(task.filePath, { force: true }).catch(() => undefined)
    await this.prisma.exportTask.update({
      where: { id },
      data: { status: 'CANCELED', filePath: null, completedAt: task.completedAt ?? new Date() },
    })
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
