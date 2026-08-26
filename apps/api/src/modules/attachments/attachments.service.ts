import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { AttachmentVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { LocalDiskStorage } from './storage/local-disk.storage'
import type { StorageProvider } from './storage/storage-provider'

const MAX_SIZE = 20 * 1024 * 1024
const ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.zip',
])

@Injectable()
export class AttachmentsService {
  private readonly storage: StorageProvider

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const root = config.get<string>('UPLOAD_DIR') ?? path.resolve(__dirname, '../../../uploads')
    this.storage = new LocalDiskStorage(root)
  }

  async list(user: AuthUser, targetType: string, targetId: string): Promise<AttachmentVO[]> {
    if (!targetType || !targetId) throw new BadRequestException('请指定挂载对象')
    const rows = await this.prisma.attachment.findMany({
      where: { tenantId: user.tenantId, targetType, targetId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => this.toVO(r))
  }

  async listByTargets(
    tenantId: string,
    targetType: string,
    targetIds: string[],
  ): Promise<Map<string, AttachmentVO[]>> {
    const map = new Map<string, AttachmentVO[]>()
    if (targetIds.length === 0) return map
    const rows = await this.prisma.attachment.findMany({
      where: { tenantId, targetType, targetId: { in: targetIds } },
      orderBy: { createdAt: 'asc' },
    })
    for (const row of rows) {
      if (!row.targetId) continue
      const list = map.get(row.targetId) ?? []
      list.push(this.toVO(row))
      map.set(row.targetId, list)
    }
    return map
  }

  async upload(
    user: AuthUser,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    targetType?: string,
    targetId?: string,
  ): Promise<AttachmentVO> {
    if (!file) throw new BadRequestException('请选择要上传的文件')
    if (file.size > MAX_SIZE) throw new BadRequestException('文件不能超过 20MB')
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) throw new BadRequestException('不支持的文件类型')

    const stored = await this.storage.save(user.tenantId, file.originalname, file.buffer)
    const row = await this.prisma.attachment.create({
      data: {
        tenantId: user.tenantId,
        uploaderId: user.id,
        name: file.originalname,
        path: stored.relativePath,
        size: stored.size,
        mime: file.mimetype,
        targetType: targetType || null,
        targetId: targetId || null,
      },
    })
    return this.toVO(row)
  }

  async download(user: AuthUser, id: string): Promise<StreamableFile> {
    const row = await this.ensureOwned(user, id)
    const abs = this.storage.resolveAbsolute(row.path)
    return new StreamableFile(createReadStream(abs), {
      type: row.mime || 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    })
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensureOwned(user, id)
    const isAdmin = user.permissions.includes('*')
    if (!isAdmin && row.uploaderId && row.uploaderId !== user.id) {
      throw new BadRequestException('只能删除自己上传的附件')
    }
    await this.storage.remove(row.path)
    await this.prisma.attachment.delete({ where: { id } })
    return { id, name: row.name }
  }

  /**
   * 供拥有目标对象写权限的领域服务清理被替换的附件。
   * 这里不使用 uploaderId 作为授权依据，调用方必须先验证目标对象归属。
   */
  async removeFromTarget(tenantId: string, id: string, targetType: string, targetId: string) {
    const row = await this.prisma.attachment.findFirst({
      where: { id, tenantId, targetType, targetId },
    })
    if (!row) return false
    await this.storage.remove(row.path)
    await this.prisma.attachment.delete({ where: { id } })
    return true
  }

  async viewFromTarget(tenantId: string, id: string, targetType: string, targetId: string) {
    const row = await this.prisma.attachment.findFirst({
      where: { id, tenantId, targetType, targetId },
    })
    if (!row) throw new NotFoundException('附件不存在')
    const abs = this.storage.resolveAbsolute(row.path)
    return new StreamableFile(createReadStream(abs), {
      type: row.mime || 'application/octet-stream',
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    })
  }

  private async ensureOwned(user: AuthUser, id: string) {
    const row = await this.prisma.attachment.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!row) throw new NotFoundException('附件不存在')
    return row
  }

  private toVO(row: {
    id: string
    name: string
    size: number
    mime: string | null
    targetType: string | null
    targetId: string | null
    uploaderId: string | null
    createdAt: Date
  }): AttachmentVO {
    return {
      id: row.id,
      name: row.name,
      size: row.size,
      mime: row.mime,
      targetType: row.targetType,
      targetId: row.targetId,
      uploaderId: row.uploaderId,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
