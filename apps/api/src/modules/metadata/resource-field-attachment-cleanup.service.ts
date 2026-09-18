import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { AttachmentsService } from '../attachments/attachments.service'
import {
  RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX,
  RESOURCE_FIELD_TYPES,
  type ResourceFieldType,
  ResourceFieldValueService,
} from './resource-field-value.service'

const TEMP_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 200
const CLEANUP_MAX_BATCHES = 10
const RESOURCE_TYPE_SET = new Set<ResourceFieldType>(RESOURCE_FIELD_TYPES)

@Injectable()
export class ResourceFieldAttachmentCleanupService {
  private readonly logger = new Logger(ResourceFieldAttachmentCleanupService.name)

  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly fields: ResourceFieldValueService,
    private readonly attachments: AttachmentsService,
    private readonly coordinator: DistributedCoordinatorService,
  ) {}

  @Cron('0 17 * * * *')
  async scheduledCleanup(): Promise<void> {
    await this.coordinator.runScheduledOnce('resource-field-attachment-cleanup', 'MINUTE', () =>
      this.cleanup(),
    )
  }

  async cleanup(now = new Date()): Promise<{ scanned: number; deleted: number }> {
    const temporaryCutoff = new Date(now.getTime() - TEMP_ATTACHMENT_TTL_MS)
    let scanned = 0
    let deleted = 0

    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
      const client = this.prisma8.client
      const cutoff = temporaryCutoff.toISOString()
      const query = client.raw.sql`SELECT
          attachment.id,
          attachment."tenantId",
          attachment."targetType",
          attachment."targetId"
        FROM attachments AS attachment
        WHERE attachment."targetType" LIKE ${`${RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX}%`}
           OR (
             attachment."targetType" IS NULL
             AND attachment."targetId" IS NULL
             AND attachment."createdAt" < ${cutoff}::timestamptz
             AND NOT EXISTS (
               SELECT 1
               FROM approval_instance_attachments AS relation
               WHERE relation.attachment_id = attachment.id
             )
           )
        ORDER BY attachment."createdAt" ASC
        LIMIT ${CLEANUP_BATCH_SIZE}`.returnsRow({
        id: client.sql.public.attachments.columns.id,
        tenantId: client.sql.public.attachments.columns.tenantId,
        targetType: client.sql.public.attachments.columns.targetType,
        targetId: client.sql.public.attachments.columns.targetId,
      })
      const rows: Array<{
        id: string
        tenantId: string
        targetType: string | null
        targetId: string | null
      }> = []
      for await (const row of client.runtime().query(query.build())) rows.push(row)
      if (!rows.length) break
      scanned += rows.length

      for (const row of rows) {
        try {
          if (!row.targetType && !row.targetId) {
            if (await this.attachments.removeTemporary(row.tenantId, row.id)) deleted++
            continue
          }
          const targetType = row.targetType
          const targetId = row.targetId
          const resourceType = this.parseResourceType(targetType)
          if (!resourceType || !targetType || !targetId) continue
          const referenced = await this.fields.isAttachmentReferenced(
            row.tenantId,
            resourceType,
            targetId,
            row.id,
          )
          if (referenced) continue
          if (await this.attachments.removeFromTarget(row.tenantId, row.id, targetType, targetId)) {
            deleted++
          }
        } catch (error) {
          this.logger.warn(
            `资源字段附件清理失败 attachmentId=${row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }

      if (rows.length < CLEANUP_BATCH_SIZE) break
    }

    return { scanned, deleted }
  }

  private parseResourceType(targetType: string | null): ResourceFieldType | null {
    if (!targetType?.startsWith(RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX)) return null
    const value = targetType.slice(
      RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX.length,
    ) as ResourceFieldType
    return RESOURCE_TYPE_SET.has(value) ? value : null
  }
}
