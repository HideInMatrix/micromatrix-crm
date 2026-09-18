import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { AttachmentVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8TimestampToDate } from '../../prisma/prisma8-temporal'
import { LocalDiskStorage } from './storage/local-disk.storage'
import type { StorageProvider } from './storage/storage-provider'

const MAX_SIZE = 20 * 1024 * 1024
const DOMAIN_GUARDED_TARGETS = new Set(['customFormData'])
const RESOURCE_FIELD_TARGET_PREFIX = 'resourceField:'
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
    private readonly prisma8: Prisma8Service,
    config: ConfigService,
  ) {
    const root = config.get<string>('UPLOAD_DIR') ?? path.resolve(__dirname, '../../../uploads')
    this.storage = new LocalDiskStorage(root)
  }

  async list(user: AuthUser, targetType: string, targetId: string): Promise<AttachmentVO[]> {
    if (!targetType || !targetId) throw new BadRequestException('请指定挂载对象')
    const rows = await this.attachments()
      .where({ tenantId: user.tenantId, targetType, targetId })
      .orderBy((row) => row.createdAt.desc())
      .all()
    return rows.map((r) => this.toVO(r))
  }

  async listByTargets(
    tenantId: string,
    targetType: string,
    targetIds: string[],
  ): Promise<Map<string, AttachmentVO[]>> {
    const map = new Map<string, AttachmentVO[]>()
    if (targetIds.length === 0) return map
    const rows = await this.attachments()
      .where({ tenantId, targetType })
      .where((row) => row.targetId.in(targetIds))
      .orderBy((row) => row.createdAt.asc())
      .all()
    for (const row of rows) {
      if (!row.targetId) continue
      const list = map.get(row.targetId) ?? []
      list.push(this.toVO(row))
      map.set(row.targetId, list)
    }
    return map
  }

  async listByIdsFromTarget(
    tenantId: string,
    ids: string[],
    targetType: string,
    targetId: string,
  ): Promise<AttachmentVO[]> {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) return []
    const rows = await this.attachments()
      .where({ tenantId, targetType, targetId })
      .where((row) => row.id.in(uniqueIds))
      .orderBy((row) => row.createdAt.asc())
      .all()
    return rows.map((row) => this.toVO(row))
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
    const row = await this.attachments().create({
      tenantId: user.tenantId,
      uploaderId: user.id,
      name: file.originalname,
      path: stored.relativePath,
      size: stored.size,
      mime: file.mimetype,
      targetType: targetType || null,
      targetId: targetId || null,
    })
    return this.toVO(row)
  }

  async download(user: AuthUser, id: string): Promise<StreamableFile> {
    const row = await this.ensureOwned(user, id)
    if (row.targetType && this.isDomainGuardedTarget(row.targetType)) {
      throw new BadRequestException('该附件必须通过所属业务数据读取')
    }
    const abs = this.storage.resolveAbsolute(row.path)
    return new StreamableFile(createReadStream(abs), {
      type: row.mime || 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    })
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensureOwned(user, id)
    if (row.targetType && this.isDomainGuardedTarget(row.targetType)) {
      throw new BadRequestException('该附件必须通过所属业务数据修改')
    }
    const isAdmin = user.permissions.includes('*')
    if (!isAdmin && row.uploaderId && row.uploaderId !== user.id) {
      throw new BadRequestException('只能删除自己上传的附件')
    }
    await this.ensureNotApprovalBound(user.tenantId, id)
    await this.storage.remove(row.path)
    await this.attachments().where({ id }).deleteAndCount()
    return { id, name: row.name }
  }

  /**
   * 供拥有目标对象写权限的领域服务清理被替换的附件。
   * 这里不使用 uploaderId 作为授权依据，调用方必须先验证目标对象归属。
   */
  async removeFromTarget(tenantId: string, id: string, targetType: string, targetId: string) {
    const row = await this.attachments().where({ id, tenantId, targetType, targetId }).first()
    if (!row) return false
    await this.ensureNotApprovalBound(tenantId, id)
    await this.storage.remove(row.path)
    await this.attachments().where({ id }).deleteAndCount()
    return true
  }

  async removeAllFromTargets(tenantId: string, targetType: string, targetIds: string[]) {
    const uniqueTargetIds = [...new Set(targetIds.filter(Boolean))]
    if (!uniqueTargetIds.length) return 0
    const rows = await this.attachments()
      .where({ tenantId, targetType })
      .where((row) => row.targetId.in(uniqueTargetIds))
      .select('id', 'path')
      .all()
    for (const row of rows) {
      await this.ensureNotApprovalBound(tenantId, row.id)
      await this.storage.remove(row.path)
    }
    if (rows.length) {
      await this.attachments()
        .where({ tenantId })
        .where((row) => row.id.in(rows.map((item) => item.id)))
        .deleteAndCount()
    }
    return rows.length
  }

  async removeTemporary(tenantId: string, id: string): Promise<boolean> {
    const row = await this.attachments()
      .where({ id, tenantId, targetType: null, targetId: null })
      .first()
    if (!row) return false
    await this.ensureNotApprovalBound(tenantId, id)
    await this.storage.remove(row.path)
    await this.attachments().where({ id }).deleteAndCount()
    return true
  }

  async viewFromTarget(tenantId: string, id: string, targetType: string, targetId: string) {
    const row = await this.attachments().where({ id, tenantId, targetType, targetId }).first()
    if (!row) throw new NotFoundException('附件不存在')
    const abs = this.storage.resolveAbsolute(row.path)
    return new StreamableFile(createReadStream(abs), {
      type: row.mime || 'application/octet-stream',
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    })
  }

  private async ensureOwned(user: AuthUser, id: string) {
    const row = await this.attachments().where({ id, tenantId: user.tenantId }).first()
    if (!row) throw new NotFoundException('附件不存在')
    return row
  }

  private isDomainGuardedTarget(targetType: string): boolean {
    return (
      DOMAIN_GUARDED_TARGETS.has(targetType) || targetType.startsWith(RESOURCE_FIELD_TARGET_PREFIX)
    )
  }

  private async ensureNotApprovalBound(tenantId: string, attachmentId: string) {
    const linked = await this.prisma8.client.orm.public.ApprovalInstanceAttachments.where({
      tenantId,
      attachmentId,
    }).aggregate((agg) => ({ count: agg.count() }))
    if (linked.count > 0) throw new BadRequestException('审批历史附件不能删除')
  }

  private attachments() {
    return this.prisma8.client.orm.public.Attachments
  }

  private toVO(row: {
    id: string
    name: string
    size: number
    mime: string | null
    targetType: string | null
    targetId: string | null
    uploaderId: string | null
    createdAt: Parameters<typeof prisma8TimestampToDate>[0]
  }): AttachmentVO {
    return {
      id: row.id,
      name: row.name,
      size: row.size,
      mime: row.mime,
      targetType: row.targetType,
      targetId: row.targetId,
      uploaderId: row.uploaderId,
      createdAt: prisma8TimestampToDate(row.createdAt).toISOString(),
    }
  }
}
