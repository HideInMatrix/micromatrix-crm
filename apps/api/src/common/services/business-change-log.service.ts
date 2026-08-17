import { Injectable, Logger } from '@nestjs/common'
import type { AuthUser } from '../auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

export interface RecordBusinessChangeInput {
  module: string
  action?: string
  targetId: string
  targetName?: string | null
  before: unknown
  after: unknown
  ignore?: string[]
}

const DEFAULT_IGNORED = new Set([
  'updatedAt',
  'createdAt',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'credentials',
])

/**
 * 通用业务字段 diff + 历史日志。
 * 递归展开对象（包括 customData），数组作为一个整体比较，避免未变化的 customData 键污染时间线。
 */
@Injectable()
export class BusinessChangeLogService {
  private readonly logger = new Logger(BusinessChangeLogService.name)

  constructor(private readonly prisma: PrismaService) {}

  diff(before: unknown, after: unknown, ignore: string[] = []): FieldChange[] {
    const ignored = new Set([...DEFAULT_IGNORED, ...ignore])
    const changes: FieldChange[] = []
    this.walk('', this.toComparable(before), this.toComparable(after), ignored, changes)
    return changes
  }

  async record(user: AuthUser, input: RecordBusinessChangeInput): Promise<void> {
    const changes = this.diff(input.before, input.after, input.ignore)
    if (changes.length === 0) return
    try {
      await this.prisma.operationLog.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          userName: user.name,
          module: input.module,
          action: input.action ?? 'change',
          targetId: input.targetId,
          targetName: input.targetName ?? undefined,
          detail: { changes } as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (error) {
      this.logger.warn(`业务变更日志写入失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private walk(
    path: string,
    before: unknown,
    after: unknown,
    ignored: Set<string>,
    changes: FieldChange[],
  ) {
    const key = path.split('.').at(-1) ?? ''
    if (ignored.has(key)) return
    if (this.equal(before, after)) return

    if (this.isPlainObject(before) && this.isPlainObject(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const child of keys) {
        this.walk(path ? `${path}.${child}` : child, before[child], after[child], ignored, changes)
      }
      return
    }

    changes.push({ field: path || '$', before, after })
  }

  private equal(a: unknown, b: unknown) {
    if (Object.is(a, b)) return true
    return JSON.stringify(a) === JSON.stringify(b)
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  private toComparable(value: unknown): unknown {
    if (value === undefined) return null
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map((item) => this.toComparable(item))
    if (
      value &&
      typeof value === 'object' &&
      'toJSON' in value &&
      typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ) {
      return this.toComparable((value as { toJSON: () => unknown }).toJSON())
    }
    if (this.isPlainObject(value)) {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) out[key] = this.toComparable(item)
      return out
    }
    if (typeof value === 'bigint') return value.toString()
    return value
  }
}
