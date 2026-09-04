import { BadRequestException, Injectable } from '@nestjs/common'
import type { OperationLogSettingVO } from '@micromatrix/shared'
import type { OperationLogCleanupSource } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { resolveOperationLogCleanupConfig } from './operation-log-config'

const PERMANENT_SENTINEL = 0
export const MIN_RETENTION_DAYS = 30
export const MAX_RETENTION_DAYS = 3650

type SettingRow = {
  retentionDays: number | null
  lastCleanupAt: Date | null
  lastCleanupDeleted: number
  lastCleanupSource: OperationLogCleanupSource | null
}

@Injectable()
export class OperationLogSettingsService {
  private readonly defaultRetentionDays = resolveOperationLogCleanupConfig().retentionDays

  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string): Promise<OperationLogSettingVO> {
    const row = await this.prisma.operationLogSetting.findUnique({ where: { tenantId } })
    return this.toVO(row)
  }

  async resolvePolicy(tenantId: string) {
    const row = await this.prisma.operationLogSetting.findUnique({ where: { tenantId } })
    const setting = this.toVO(row)
    return { retentionDays: setting.permanent ? null : setting.retentionDays, setting }
  }

  async update(tenantId: string, retentionDays: number | null): Promise<OperationLogSettingVO> {
    if (
      retentionDays !== null &&
      (!Number.isInteger(retentionDays) ||
        retentionDays < MIN_RETENTION_DAYS ||
        retentionDays > MAX_RETENTION_DAYS)
    ) {
      throw new BadRequestException(
        `操作日志保留天数必须为永久保留或 ${MIN_RETENTION_DAYS}～${MAX_RETENTION_DAYS} 的整数`,
      )
    }
    const storedValue = retentionDays === null ? PERMANENT_SENTINEL : retentionDays
    const row = await this.prisma.operationLogSetting.upsert({
      where: { tenantId },
      create: { tenantId, retentionDays: storedValue },
      update: { retentionDays: storedValue },
    })
    return this.toVO(row)
  }

  async recordCleanup(
    tenantId: string,
    deleted: number,
    source: OperationLogCleanupSource,
    at: Date,
  ): Promise<OperationLogSettingVO> {
    const row = await this.prisma.operationLogSetting.upsert({
      where: { tenantId },
      create: {
        tenantId,
        retentionDays: null,
        lastCleanupAt: at,
        lastCleanupDeleted: deleted,
        lastCleanupSource: source,
      },
      update: {
        lastCleanupAt: at,
        lastCleanupDeleted: deleted,
        lastCleanupSource: source,
      },
    })
    return this.toVO(row)
  }

  private toVO(row: SettingRow | null): OperationLogSettingVO {
    const permanent = row?.retentionDays === PERMANENT_SENTINEL
    const configured = row?.retentionDays !== null && row?.retentionDays !== undefined
    return {
      configured,
      retentionDays: permanent ? null : (row?.retentionDays ?? this.defaultRetentionDays),
      defaultRetentionDays: this.defaultRetentionDays,
      permanent,
      lastCleanupAt: row?.lastCleanupAt?.toISOString() ?? null,
      lastCleanupDeleted: row?.lastCleanupDeleted ?? 0,
      lastCleanupSource: row?.lastCleanupSource ?? null,
    }
  }
}
