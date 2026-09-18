import { BadRequestException, Injectable } from '@nestjs/common'
import type { OperationLogSettingVO } from '@micromatrix/shared'
import { prisma8TimestampToISOString } from '../../prisma/prisma8-temporal.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { resolveOperationLogCleanupConfig } from './operation-log-config'

const PERMANENT_SENTINEL = 0
export const MIN_RETENTION_DAYS = 30
export const MAX_RETENTION_DAYS = 3650

export const OperationLogCleanupSources = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const
export type OperationLogCleanupSource =
  (typeof OperationLogCleanupSources)[keyof typeof OperationLogCleanupSources]

type SettingRow = {
  retentionDays: number | null
  lastCleanupAt: Parameters<typeof prisma8TimestampToISOString>[0] | null
  lastCleanupDeleted: number
  lastCleanupSource: OperationLogCleanupSource | null
}

@Injectable()
export class OperationLogSettingsService {
  private readonly defaultRetentionDays = resolveOperationLogCleanupConfig().retentionDays

  constructor(private readonly prisma8: Prisma8Service) {}

  async get(tenantId: string): Promise<OperationLogSettingVO> {
    const row = await this.find(tenantId)
    return this.toVO(row)
  }

  async resolvePolicy(tenantId: string) {
    const row = await this.find(tenantId)
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
    const client = this.prisma8.client
    const query = client.raw.sql`INSERT INTO operation_log_settings (
        "tenantId", "retentionDays", "updatedAt"
      ) VALUES (
        ${tenantId}, ${storedValue}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId") DO UPDATE SET
        "retentionDays" = EXCLUDED."retentionDays",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "retentionDays", "lastCleanupAt", "lastCleanupDeleted",
        "lastCleanupSource"::text AS "lastCleanupSource"`.returnsRow(
      this.settingRowCodec(),
    )
    const row = await this.firstRow(query.build())
    return this.toVO(row)
  }

  async recordCleanup(
    tenantId: string,
    deleted: number,
    source: OperationLogCleanupSource,
    at: Date,
  ): Promise<OperationLogSettingVO> {
    const client = this.prisma8.client
    const atIso = at.toISOString()
    const query = client.raw.sql`INSERT INTO operation_log_settings (
        "tenantId", "retentionDays", "lastCleanupAt", "lastCleanupDeleted", "lastCleanupSource", "updatedAt"
      ) VALUES (
        ${tenantId}, NULL, ${atIso}::timestamptz, ${deleted},
        ${source}::"OperationLogCleanupSource", CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId") DO UPDATE SET
        "lastCleanupAt" = EXCLUDED."lastCleanupAt",
        "lastCleanupDeleted" = EXCLUDED."lastCleanupDeleted",
        "lastCleanupSource" = EXCLUDED."lastCleanupSource",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "retentionDays", "lastCleanupAt", "lastCleanupDeleted",
        "lastCleanupSource"::text AS "lastCleanupSource"`.returnsRow(
      this.settingRowCodec(),
    )
    const row = await this.firstRow(query.build())
    return this.toVO(row)
  }

  private async find(tenantId: string): Promise<SettingRow | null> {
    return this.prisma8.client.orm.public.OperationLogSettings.where({ tenantId })
      .select('retentionDays', 'lastCleanupAt', 'lastCleanupDeleted', 'lastCleanupSource')
      .first()
  }

  private settingRowCodec() {
    const columns = this.prisma8.client.sql.public.operation_log_settings.columns
    return {
      retentionDays: columns.retentionDays,
      lastCleanupAt: columns.lastCleanupAt,
      lastCleanupDeleted: columns.lastCleanupDeleted,
      lastCleanupSource: { codecId: 'pg/text@1', nullable: true } as const,
    }
  }

  private async firstRow(query: unknown): Promise<SettingRow> {
    // The query object is intentionally kept opaque at this boundary; runtime.query
    // validates it against the contract codec supplied by returnsRow above.
    for await (const row of this.prisma8.client.runtime().query(query as never)) {
      return row as SettingRow
    }
    throw new Error('操作日志设置写入后未返回记录')
  }

  private toVO(row: SettingRow | null): OperationLogSettingVO {
    const permanent = row?.retentionDays === PERMANENT_SENTINEL
    const configured = row?.retentionDays !== null && row?.retentionDays !== undefined
    return {
      configured,
      retentionDays: permanent ? null : (row?.retentionDays ?? this.defaultRetentionDays),
      defaultRetentionDays: this.defaultRetentionDays,
      permanent,
      lastCleanupAt: row?.lastCleanupAt ? prisma8TimestampToISOString(row.lastCleanupAt) : null,
      lastCleanupDeleted: row?.lastCleanupDeleted ?? 0,
      lastCleanupSource: row?.lastCleanupSource ?? null,
    }
  }
}
