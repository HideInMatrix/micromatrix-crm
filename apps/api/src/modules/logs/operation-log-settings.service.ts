import { BadRequestException, Injectable } from '@nestjs/common'
import type { LogCategory, OperationLogSettingVO } from '@micromatrix/shared'
import { instantToISOString } from '../../prisma/temporal.js'
import { PrismaService } from '../../prisma.service.js'
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
  lastCleanupAt: Parameters<typeof instantToISOString>[0] | null
  lastCleanupDeleted: number
  lastCleanupSource: OperationLogCleanupSource | null
}

type StoredSettingsRow = SettingRow & {
  loginRetentionDays: number | null
  eventRetentionDays: number | null
  loginLastCleanupAt: SettingRow['lastCleanupAt']
  eventLastCleanupAt: SettingRow['lastCleanupAt']
  loginLastCleanupDeleted: number
  eventLastCleanupDeleted: number
  loginLastCleanupSource: OperationLogCleanupSource | null
  eventLastCleanupSource: OperationLogCleanupSource | null
}

@Injectable()
export class OperationLogSettingsService {
  private readonly defaultRetentionDays = resolveOperationLogCleanupConfig().retentionDays

  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, category: LogCategory = 'operation'): Promise<OperationLogSettingVO> {
    const row = await this.find(tenantId)
    return this.toVO(this.byCategory(row, category))
  }

  async resolvePolicy(tenantId: string, category: LogCategory = 'operation') {
    const setting = await this.get(tenantId, category)
    return { retentionDays: setting.permanent ? null : setting.retentionDays, setting }
  }

  async update(
    tenantId: string,
    retentionDays: number | null,
    category: LogCategory = 'operation',
  ): Promise<OperationLogSettingVO> {
    if (
      retentionDays !== null &&
      (!Number.isInteger(retentionDays) ||
        retentionDays < MIN_RETENTION_DAYS ||
        retentionDays > MAX_RETENTION_DAYS)
    ) {
      throw new BadRequestException(
        `日志保留天数必须为永久保留或 ${MIN_RETENTION_DAYS}～${MAX_RETENTION_DAYS} 的整数`,
      )
    }
    const storedValue = retentionDays === null ? PERMANENT_SENTINEL : retentionDays
    const client = this.prisma.client
    const query =
      category === 'login'
        ? client.raw
            .sql`INSERT INTO operation_log_settings ("tenantId", "loginRetentionDays", "updatedAt")
            VALUES (${tenantId}, ${storedValue}, CURRENT_TIMESTAMP)
            ON CONFLICT ("tenantId") DO UPDATE SET
              "loginRetentionDays" = EXCLUDED."loginRetentionDays",
              "updatedAt" = CURRENT_TIMESTAMP
            RETURNING "loginRetentionDays" AS "retentionDays",
              "loginLastCleanupAt" AS "lastCleanupAt", "loginLastCleanupDeleted" AS "lastCleanupDeleted",
              "loginLastCleanupSource"::text AS "lastCleanupSource"`
        : category === 'event'
          ? client.raw
              .sql`INSERT INTO operation_log_settings ("tenantId", "eventRetentionDays", "updatedAt")
              VALUES (${tenantId}, ${storedValue}, CURRENT_TIMESTAMP)
              ON CONFLICT ("tenantId") DO UPDATE SET
                "eventRetentionDays" = EXCLUDED."eventRetentionDays",
                "updatedAt" = CURRENT_TIMESTAMP
              RETURNING "eventRetentionDays" AS "retentionDays",
                "eventLastCleanupAt" AS "lastCleanupAt", "eventLastCleanupDeleted" AS "lastCleanupDeleted",
                "eventLastCleanupSource"::text AS "lastCleanupSource"`
          : client.raw
              .sql`INSERT INTO operation_log_settings ("tenantId", "retentionDays", "updatedAt")
              VALUES (${tenantId}, ${storedValue}, CURRENT_TIMESTAMP)
              ON CONFLICT ("tenantId") DO UPDATE SET
                "retentionDays" = EXCLUDED."retentionDays", "updatedAt" = CURRENT_TIMESTAMP
              RETURNING "retentionDays", "lastCleanupAt", "lastCleanupDeleted",
                "lastCleanupSource"::text AS "lastCleanupSource"`
    const row = await this.firstRow(query.returnsRow(this.settingRowCodec()).build())
    return this.toVO(row)
  }

  async recordCleanup(
    tenantId: string,
    deleted: number,
    source: OperationLogCleanupSource,
    at: Date,
    category: LogCategory = 'operation',
  ): Promise<OperationLogSettingVO> {
    const client = this.prisma.client
    const atIso = at.toISOString()
    const query =
      category === 'login'
        ? client.raw.sql`INSERT INTO operation_log_settings (
            "tenantId", "loginRetentionDays", "loginLastCleanupAt", "loginLastCleanupDeleted",
            "loginLastCleanupSource", "updatedAt"
          ) VALUES (
            ${tenantId}, NULL, ${atIso}::timestamptz, ${deleted},
            ${source}::"OperationLogCleanupSource", CURRENT_TIMESTAMP
          ) ON CONFLICT ("tenantId") DO UPDATE SET
            "loginLastCleanupAt" = EXCLUDED."loginLastCleanupAt",
            "loginLastCleanupDeleted" = EXCLUDED."loginLastCleanupDeleted",
            "loginLastCleanupSource" = EXCLUDED."loginLastCleanupSource", "updatedAt" = CURRENT_TIMESTAMP
          RETURNING "loginRetentionDays" AS "retentionDays",
            "loginLastCleanupAt" AS "lastCleanupAt", "loginLastCleanupDeleted" AS "lastCleanupDeleted",
            "loginLastCleanupSource"::text AS "lastCleanupSource"`
        : category === 'event'
          ? client.raw.sql`INSERT INTO operation_log_settings (
              "tenantId", "eventRetentionDays", "eventLastCleanupAt", "eventLastCleanupDeleted",
              "eventLastCleanupSource", "updatedAt"
            ) VALUES (
              ${tenantId}, NULL, ${atIso}::timestamptz, ${deleted},
              ${source}::"OperationLogCleanupSource", CURRENT_TIMESTAMP
            ) ON CONFLICT ("tenantId") DO UPDATE SET
              "eventLastCleanupAt" = EXCLUDED."eventLastCleanupAt",
              "eventLastCleanupDeleted" = EXCLUDED."eventLastCleanupDeleted",
              "eventLastCleanupSource" = EXCLUDED."eventLastCleanupSource", "updatedAt" = CURRENT_TIMESTAMP
            RETURNING "eventRetentionDays" AS "retentionDays",
              "eventLastCleanupAt" AS "lastCleanupAt", "eventLastCleanupDeleted" AS "lastCleanupDeleted",
              "eventLastCleanupSource"::text AS "lastCleanupSource"`
          : client.raw.sql`INSERT INTO operation_log_settings (
              "tenantId", "retentionDays", "lastCleanupAt", "lastCleanupDeleted", "lastCleanupSource", "updatedAt"
            ) VALUES (
              ${tenantId}, NULL, ${atIso}::timestamptz, ${deleted},
              ${source}::"OperationLogCleanupSource", CURRENT_TIMESTAMP
            ) ON CONFLICT ("tenantId") DO UPDATE SET
              "lastCleanupAt" = EXCLUDED."lastCleanupAt",
              "lastCleanupDeleted" = EXCLUDED."lastCleanupDeleted",
              "lastCleanupSource" = EXCLUDED."lastCleanupSource", "updatedAt" = CURRENT_TIMESTAMP
            RETURNING "retentionDays", "lastCleanupAt", "lastCleanupDeleted",
              "lastCleanupSource"::text AS "lastCleanupSource"`
    const row = await this.firstRow(query.returnsRow(this.settingRowCodec()).build())
    return this.toVO(row)
  }

  private async find(tenantId: string): Promise<StoredSettingsRow | null> {
    return this.prisma.client.orm.public.OperationLogSettings.where({ tenantId })
      .select(
        'retentionDays',
        'lastCleanupAt',
        'lastCleanupDeleted',
        'lastCleanupSource',
        'loginRetentionDays',
        'loginLastCleanupAt',
        'loginLastCleanupDeleted',
        'loginLastCleanupSource',
        'eventRetentionDays',
        'eventLastCleanupAt',
        'eventLastCleanupDeleted',
        'eventLastCleanupSource',
      )
      .first()
  }

  private byCategory(row: StoredSettingsRow | null, category: LogCategory): SettingRow | null {
    if (!row || category === 'operation') return row
    const prefix = category === 'event' ? 'event' : 'login'
    return {
      retentionDays: row[`${prefix}RetentionDays`],
      lastCleanupAt: row[`${prefix}LastCleanupAt`],
      lastCleanupDeleted: row[`${prefix}LastCleanupDeleted`],
      lastCleanupSource: row[`${prefix}LastCleanupSource`],
    }
  }

  private settingRowCodec() {
    const columns = this.prisma.client.sql.public.operation_log_settings.columns
    return {
      retentionDays: columns.retentionDays,
      lastCleanupAt: columns.lastCleanupAt,
      lastCleanupDeleted: columns.lastCleanupDeleted,
      lastCleanupSource: { codecId: 'pg/text@1', nullable: true } as const,
    }
  }

  private async firstRow(query: unknown): Promise<SettingRow> {
    for await (const row of this.prisma.client.runtime().query(query as never)) {
      return row as SettingRow
    }
    throw new Error('日志设置写入后未返回记录')
  }

  private toVO(row: SettingRow | null): OperationLogSettingVO {
    const permanent = row?.retentionDays === PERMANENT_SENTINEL
    const configured = row?.retentionDays !== null && row?.retentionDays !== undefined
    return {
      configured,
      retentionDays: permanent ? null : (row?.retentionDays ?? this.defaultRetentionDays),
      defaultRetentionDays: this.defaultRetentionDays,
      permanent,
      lastCleanupAt: row?.lastCleanupAt ? instantToISOString(row.lastCleanupAt) : null,
      lastCleanupDeleted: row?.lastCleanupDeleted ?? 0,
      lastCleanupSource: row?.lastCleanupSource ?? null,
    }
  }
}
