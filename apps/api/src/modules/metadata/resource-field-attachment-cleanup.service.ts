import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { PrismaService } from '../../prisma/prisma.service'
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
    private readonly prisma: PrismaService,
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
      const rows = await this.prisma.attachment.findMany({
        where: {
          OR: [
            { targetType: { startsWith: RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX } },
            {
              targetType: null,
              targetId: null,
              createdAt: { lt: temporaryCutoff },
              approvalInstanceAttachments: { none: {} },
            },
          ],
        },
        select: { id: true, tenantId: true, targetType: true, targetId: true },
        orderBy: { createdAt: 'asc' },
        take: CLEANUP_BATCH_SIZE,
      })
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
