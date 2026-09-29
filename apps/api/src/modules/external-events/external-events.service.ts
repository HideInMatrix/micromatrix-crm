import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { CustomersService } from '../../customers/customers.service'
import type { PrismaClient } from '../../prisma/db.js'
import { PrismaService } from '../../prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { LeadsService } from '../leads/leads.service'
import type { ApplyExternalCustomerEventDto } from './dto/external-event.dto'
import { ExternalResourceResolverService } from './external-resource-resolver.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

interface InboxClaimRow {
  id: string
  source: string
  externalEventId: string
  requestHash: string
  status: string
  resolvedType: string | null
  resolvedId: string | null
  customerId: string | null
  attempts: number
  updatedAt: { epochMilliseconds: number }
}

const PROCESSING_STALE_MS = 15 * 60 * 1000

@Injectable()
export class ExternalEventsService {
  private readonly logger = new Logger(ExternalEventsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ExternalResourceResolverService,
    private readonly customers: CustomersService,
    private readonly leads: LeadsService,
  ) {}

  async applyCustomerEvent(user: AuthUser, dto: ApplyExternalCustomerEventDto) {
    const source = dto.source.trim()
    const externalEventId = dto.externalEventId.trim()
    if (!source || !externalEventId) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_ID',
        message: 'source 和 externalEventId 不能为空',
      })
    }
    const requestHash = this.requestHash(dto.where, dto.set)
    const claim = await this.claimInbox(user, source, externalEventId, requestHash)
    if (claim.replayed) return this.successResponse(claim.row, true)

    try {
      const resolved = await this.resolver.resolve(user, dto.where)
      if (resolved.kind === 'CUSTOMER') {
        const prepared = await this.customers.prepareDynamicFieldUpdate(
          user,
          resolved.customerId,
          dto.set,
        )
        const resolvedType = resolved.sourceLeadId ? 'LEAD' : 'CUSTOMER'
        const resolvedId = resolved.sourceLeadId ?? resolved.customerId
        const result = await this.prisma.client.transaction(async (tx) => {
          const customer = await this.customers.applyPreparedDynamicFieldUpdateInTransaction(
            user,
            prepared,
            tx,
          )
          const inbox = await this.markSuccessInTransaction(tx, {
            inboxId: claim.row.id,
            requestHash,
            resolvedType,
            resolvedId,
            customerId: String(customer.id),
          })
          return { inbox }
        })
        return this.successResponse(result.inbox, false)
      }

      const customerSet = await this.customers.normalizeWritableDynamicFields(user, dto.set)
      const prepared = await this.leads.prepareResolvedLeadConversion(
        user,
        resolved.leadId,
        customerSet,
      )
      const result = await this.prisma.client.transaction(async (tx) => {
        const converted = await this.leads.convertResolvedLeadInTransaction(user, prepared, tx)
        const inbox = await this.markSuccessInTransaction(tx, {
          inboxId: claim.row.id,
          requestHash,
          resolvedType: 'LEAD',
          resolvedId: resolved.leadId,
          customerId: converted.customerId,
        })
        return { converted, inbox }
      })
      await this.leads
        .notifyResolvedLeadConversion(user, prepared, result.converted)
        .catch((error: unknown) =>
          this.logger.warn(
            `外部事件已成功提交，但转换通知发送失败 inbox=${claim.row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        )
      return this.successResponse(result.inbox, false)
    } catch (error) {
      await this.markFailed(claim.row.id, requestHash, error).catch((markError: unknown) =>
        this.logger.error(
          `外部事件失败状态记录失败 inbox=${claim.row.id}: ${
            markError instanceof Error ? markError.message : String(markError)
          }`,
        ),
      )
      throw error
    }
  }

  private async claimInbox(
    user: AuthUser,
    source: string,
    externalEventId: string,
    requestHash: string,
  ) {
    const scope = {
      organizationId: user.tenantId,
      source,
      externalEventId,
    }
    const existing = await this.prisma.client.orm.public.ExternalEventInbox.where(scope).first()
    if (existing) return this.claimExisting(existing, user.id, requestHash)

    const now = nowInstant()
    try {
      const row = await this.prisma.client.orm.public.ExternalEventInbox.create({
        ...scope,
        requestHash,
        apiKeyUserId: user.id,
        status: 'PROCESSING',
        startedAt: now,
        updatedAt: now,
      })
      return { row, replayed: false }
    } catch (error) {
      if ((error as { sqlState?: string } | null)?.sqlState !== '23505') throw error
      const raced = await this.prisma.client.orm.public.ExternalEventInbox.where(scope).first()
      if (!raced) throw error
      return this.claimExisting(raced, user.id, requestHash)
    }
  }

  private async claimExisting(
    existing: InboxClaimRow,
    userId: string,
    requestHash: string,
  ) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: '同一 externalEventId 已用于不同请求内容',
      })
    }
    if (existing.status === 'SUCCESS') return { row: existing, replayed: true }

    const now = nowInstant()
    const stale =
      existing.status === 'PROCESSING' &&
      now.epochMilliseconds - existing.updatedAt.epochMilliseconds >= PROCESSING_STALE_MS
    if (existing.status === 'PROCESSING' && !stale) {
      throw new ConflictException({
        code: 'EVENT_PROCESSING',
        message: '该外部事件正在处理，请稍后重试',
      })
    }

    const row = await this.prisma.client.orm.public.ExternalEventInbox.where({
      id: existing.id,
      status: existing.status,
      updatedAt: existing.updatedAt,
    }).update({
      status: 'PROCESSING',
      apiKeyUserId: userId,
      attempts: existing.attempts + 1,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
    })
    if (!row) {
      throw new ConflictException({
        code: 'EVENT_PROCESSING',
        message: '该外部事件已被其它请求抢占处理',
      })
    }
    return { row, replayed: false }
  }

  private async markSuccessInTransaction(
    tx: PrismaTransaction,
    input: {
      inboxId: string
      requestHash: string
      resolvedType: 'CUSTOMER' | 'LEAD'
      resolvedId: string
      customerId: string
    },
  ) {
    const now = nowInstant()
    const inbox = await tx.orm.public.ExternalEventInbox.where({
      id: input.inboxId,
      status: 'PROCESSING',
      requestHash: input.requestHash,
    }).update({
      status: 'SUCCESS',
      resolvedType: input.resolvedType,
      resolvedId: input.resolvedId,
      customerId: input.customerId,
      completedAt: now,
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
    })
    if (!inbox) {
      throw new ConflictException({
        code: 'EVENT_STATE_CHANGED',
        message: '外部事件处理状态已变化，请重新请求',
      })
    }
    return inbox
  }

  private async markFailed(inboxId: string, requestHash: string, error: unknown) {
    const now = nowInstant()
    const detail = this.errorDetail(error)
    await this.prisma.client.orm.public.ExternalEventInbox.where({
      id: inboxId,
      status: 'PROCESSING',
      requestHash,
    }).update({
      status: 'FAILED',
      completedAt: now,
      updatedAt: now,
      errorCode: detail.code.slice(0, 100),
      errorMessage: detail.message.slice(0, 2_000),
    })
  }

  private errorDetail(error: unknown): { code: string; message: string } {
    if (error instanceof HttpException) {
      const response = error.getResponse()
      if (response && typeof response === 'object' && !Array.isArray(response)) {
        const body = response as { code?: unknown; message?: unknown }
        return {
          code:
            typeof body.code === 'string' && body.code
              ? body.code
              : `HTTP_${error.getStatus()}`,
          message:
            typeof body.message === 'string' && body.message ? body.message : error.message,
        }
      }
      return { code: `HTTP_${error.getStatus()}`, message: error.message }
    }
    return {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  private successResponse(
    row: {
      source: string
      externalEventId: string
      resolvedType: string | null
      resolvedId: string | null
      customerId: string | null
      attempts: number
    },
    replayed: boolean,
  ) {
    return {
      status: 'SUCCESS' as const,
      source: row.source,
      externalEventId: row.externalEventId,
      resolvedType: row.resolvedType,
      resolvedId: row.resolvedId,
      customerId: row.customerId,
      attempts: row.attempts,
      replayed,
    }
  }

  private requestHash(where: Record<string, unknown>, set: Record<string, unknown>): string {
    const canonical = JSON.stringify(this.canonicalize({ where, set }))
    return createHash('sha256').update(canonical).digest('hex')
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonicalize(item))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.canonicalize(item)]),
      )
    }
    return value
  }
}
