import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ForbiddenException,
  Optional,
} from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import {
  hasPermission,
  type ExternalEventExecuteInput,
  type ExternalEventTemplateVO,
} from '@micromatrix/shared'
import { ExternalEventTemplatesService } from './external-event-templates.service'
import { CustomersService } from '../../customers/customers.service'
import type { PrismaClient } from '../../prisma/db.js'
import { PrismaService } from '../../prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import { LeadsService } from '../leads/leads.service'
import type { ApplyExternalCustomerEventDto } from './dto/external-event.dto'
import { ExternalResourceResolverService } from './external-resource-resolver.service'
import { auditExternalEventRequest } from './external-event-audit-payload'

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

interface ExternalEventRequestMeta {
  ip?: string
  accessKey?: string
}

interface ExternalEventAudit {
  user: AuthUser
  source: string
  externalEventId: string
  eventType: string
  businessAction: string
  request: unknown
  requestMeta?: ExternalEventRequestMeta
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
    @Optional() private readonly templates?: ExternalEventTemplatesService,
  ) {}

  async applyCustomerEvent(
    user: AuthUser,
    dto: ApplyExternalCustomerEventDto,
    requestMeta?: ExternalEventRequestMeta,
  ) {
    const source = dto.source.trim()
    const externalEventId = dto.externalEventId.trim()
    if (!source || !externalEventId) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_ID',
        message: 'source 和 externalEventId 不能为空',
      })
    }
    const requestHash = this.requestHash(dto.where, dto.set)
    const audit: ExternalEventAudit = {
      user,
      source,
      externalEventId,
      eventType: 'CUSTOMER_SYNC',
      businessAction: 'sync',
      request: auditExternalEventRequest({
        source,
        externalEventId,
        where: dto.where,
        set: dto.set,
      }),
      requestMeta,
    }
    const claim = await this.claimInbox(user, source, externalEventId, requestHash)
    if (claim.replayed) {
      await this.recordReplayed(audit, claim.row)
      return this.successResponse(claim.row, true)
    }

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
            audit: { ...audit, businessAction: 'updateCustomer' },
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
          audit: { ...audit, businessAction: 'convert' },
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
      await this.markFailed(audit, claim.row.id, requestHash, error).catch((markError: unknown) =>
        this.logger.error(
          `外部事件失败状态记录失败 inbox=${claim.row.id}: ${
            markError instanceof Error ? markError.message : String(markError)
          }`,
        ),
      )
      throw error
    }
  }

  /** One API call executes a persisted, enabled template with transactional/idempotent CRM actions. */
  async executeConfigured(
    user: AuthUser,
    dto: ExternalEventExecuteInput,
    requestMeta?: ExternalEventRequestMeta,
  ) {
    if (!this.templates) throw new BadRequestException('外部事件配置服务不可用')
    const template = await this.templates.findEnabled(user, dto.eventType, dto.source)
    const source = dto.source.trim()
    const externalEventId = dto.externalEventId?.trim()
    if (!externalEventId) throw new BadRequestException('externalEventId 不能为空')
    const requestHash = this.requestHash({ eventType: dto.eventType }, dto.data)
    const audit: ExternalEventAudit = {
      user,
      source,
      externalEventId,
      eventType: dto.eventType,
      businessAction: template.config.flow?.action ?? 'legacy',
      request: auditExternalEventRequest({
        source,
        eventType: dto.eventType,
        externalEventId,
        data: dto.data,
      }),
      requestMeta,
    }
    const claim = await this.claimInbox(user, source, externalEventId, requestHash, dto.eventType)
    if (claim.replayed) {
      await this.recordReplayed(audit, claim.row)
      return this.successResponse(claim.row, true)
    }

    try {
      if (template.config.flow)
        return await this.executeFlow(user, template, dto.data, claim.row.id, requestHash, audit)
      const { resolved, set, ownerId } = await this.templates.prepare(user, template, dto.data)
      if (resolved.kind === 'CUSTOMER') {
        const prepared =
          template.config.actions.updateCustomer && Object.keys(set).length
            ? await this.customers.prepareDynamicFieldUpdate(user, resolved.customerId, set)
            : null
        const inbox = await this.prisma.client.transaction(async (tx) => {
          if (prepared)
            await this.customers.applyPreparedDynamicFieldUpdateInTransaction(user, prepared, tx)
          return this.markSuccessInTransaction(tx, {
            inboxId: claim.row.id,
            requestHash,
            resolvedType: resolved.sourceLeadId ? 'LEAD' : 'CUSTOMER',
            resolvedId: resolved.sourceLeadId ?? resolved.customerId,
            customerId: resolved.customerId,
            audit: { ...audit, businessAction: prepared ? 'updateCustomer' : 'skip' },
          })
        })
        return this.successResponse(inbox, false)
      }

      if (!template.config.actions.convertLead) {
        const inbox = await this.prisma.client.transaction((tx) =>
          this.markSuccessInTransaction(tx, {
            inboxId: claim.row.id,
            requestHash,
            resolvedType: 'LEAD',
            resolvedId: resolved.leadId,
            customerId: null,
            audit: { ...audit, businessAction: 'skip' },
          }),
        )
        return this.successResponse(inbox, false)
      }

      if (!hasPermission(user.permissions, 'lead:convert')) {
        throw new ForbiddenException('外部事件调用账号缺少线索转化权限')
      }
      const customerSet = Object.keys(set).length
        ? await this.customers.normalizeWritableDynamicFields(user, set)
        : {}
      const prepared = await this.leads.prepareResolvedLeadConversion(
        user,
        resolved.leadId,
        customerSet,
        ownerId ?? undefined,
      )
      const result = await this.prisma.client.transaction(async (tx) => {
        const converted = await this.leads.convertResolvedLeadInTransaction(user, prepared, tx)
        const inbox = await this.markSuccessInTransaction(tx, {
          inboxId: claim.row.id,
          requestHash,
          resolvedType: 'LEAD',
          resolvedId: resolved.leadId,
          customerId: converted.customerId,
          audit: { ...audit, businessAction: 'convert' },
        })
        return { converted, inbox }
      })
      await this.leads
        .notifyResolvedLeadConversion(user, prepared, result.converted)
        .catch((error: unknown) =>
          this.logger.warn(`外部事件成功，但通知失败 inbox=${claim.row.id}: ${String(error)}`),
        )
      return this.successResponse(result.inbox, false)
    } catch (error) {
      await this.markFailed(audit, claim.row.id, requestHash, error).catch((markError: unknown) =>
        this.logger.error(`外部事件失败状态记录失败 inbox=${claim.row.id}: ${String(markError)}`),
      )
      throw error
    }
  }

  /** v2 flow dispatcher. Every write and SUCCESS transition must share a transaction. */
  private async executeFlow(
    user: AuthUser,
    template: ExternalEventTemplateVO,
    data: Record<string, unknown>,
    inboxId: string,
    requestHash: string,
    audit: ExternalEventAudit,
  ) {
    if (!this.templates) throw new BadRequestException('配置服务不可用')
    const plan = await this.templates.prepareFlow(user, template, data)
    const { flow, resolved, set, ownerId } = plan
    const commit = (
      tx: PrismaTransaction,
      type: 'LEAD' | 'CUSTOMER',
      id: string,
      customerId: string | null,
    ) =>
      this.markSuccessInTransaction(tx, {
        inboxId,
        requestHash,
        resolvedType: type,
        resolvedId: id,
        customerId,
        audit: { ...audit, businessAction: flow.action },
      })

    if (flow.action === 'update') {
      if (!resolved) throw new BadRequestException('未找到需要更新的资源')
      if (resolved.kind === 'CUSTOMER') {
        const prepared = await this.customers.prepareDynamicFieldUpdate(
          user,
          resolved.customerId,
          set,
        )
        const inbox = await this.prisma.client.transaction(async (tx) => {
          await this.customers.applyPreparedDynamicFieldUpdateInTransaction(user, prepared, tx)
          return commit(tx, 'CUSTOMER', resolved.customerId, resolved.customerId)
        })
        return this.successResponse(inbox, false)
      }
      const prepared = await this.leads.prepareExternalDynamicFieldUpdate(
        user,
        resolved.leadId,
        set,
      )
      const inbox = await this.prisma.client.transaction(async (tx) => {
        await this.leads.applyPreparedExternalDynamicFieldUpdateInTransaction(user, prepared, tx)
        return commit(tx, 'LEAD', resolved.leadId, null)
      })
      return this.successResponse(inbox, false)
    }

    if (flow.action === 'convert') {
      if (!resolved || resolved.kind !== 'LEAD') throw new BadRequestException('转换目标必须是线索')
      if (!hasPermission(user.permissions, 'lead:convert'))
        throw new ForbiddenException('外部事件调用账号缺少线索转化权限')
      const values = Object.keys(set).length
        ? await this.customers.normalizeWritableDynamicFields(user, set)
        : {}
      const prepared = await this.leads.prepareResolvedLeadConversion(
        user,
        resolved.leadId,
        values,
        ownerId ?? undefined,
      )
      const result = await this.prisma.client.transaction(async (tx) => {
        const converted = await this.leads.convertResolvedLeadInTransaction(user, prepared, tx)
        const inbox = await commit(tx, 'LEAD', resolved.leadId, converted.customerId)
        return { converted, inbox }
      })
      await this.leads
        .notifyResolvedLeadConversion(user, prepared, result.converted)
        .catch((error: unknown) =>
          this.logger.warn(`外部事件转换通知失败 inbox=${inboxId}: ${String(error)}`),
        )
      return this.successResponse(result.inbox, false)
    }

    if (flow.action === 'create') {
      if (!hasPermission(user.permissions, `${flow.target}:create`))
        throw new ForbiddenException('缺少创建目标模块的权限')
      if (flow.target === 'customer') {
        const dto = { name: plan.name!, ownerId: ownerId ?? undefined, customData: set }
        const prepared = await this.customers.prepareCreateForTransaction(user, dto)
        const result = await this.prisma.client.transaction(async (tx) => {
          const customer = await this.customers.createPreparedInTransaction(user, dto, prepared, tx)
          const inbox = await commit(tx, 'CUSTOMER', String(customer.id), String(customer.id))
          return { inbox, customer }
        })
        await this.customers
          .notifyCreatedCustomer(user, result.customer, prepared.owner.id)
          .catch((error: unknown) =>
            this.logger.warn(`外部事件客户通知失败 inbox=${inboxId}: ${String(error)}`),
          )
        return this.successResponse(result.inbox, false)
      }
      const prepared = await this.leads.prepareExternalLeadCreation(user, {
        name: plan.name!,
        ownerId: ownerId ?? undefined,
        customData: set,
      })
      const inbox = await this.prisma.client.transaction(async (tx) => {
        const lead = await this.leads.createPreparedExternalLeadInTransaction(user, prepared, tx)
        return commit(tx, 'LEAD', String(lead.id), null)
      })
      return this.successResponse(inbox, false)
    }

    if (flow.action === 'stage') {
      if (!resolved || resolved.kind !== 'LEAD')
        throw new BadRequestException('状态变更目标必须是线索')
      const prepared = await this.leads.prepareExternalStageUpdate(
        user,
        resolved.leadId,
        plan.stage!,
      )
      const inbox = await this.prisma.client.transaction(async (tx) => {
        await this.leads.applyPreparedExternalStageUpdateInTransaction(user, prepared, tx)
        return commit(tx, 'LEAD', resolved.leadId, null)
      })
      return this.successResponse(inbox, false)
    }

    throw new BadRequestException('不支持的外部事件业务动作')
  }

  private async claimInbox(
    user: AuthUser,
    source: string,
    externalEventId: string,
    requestHash: string,
    eventType?: string,
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
        eventType: eventType ?? null,
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

  private async claimExisting(existing: InboxClaimRow, userId: string, requestHash: string) {
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
      customerId: string | null
      audit: ExternalEventAudit
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
    // CRM write, inbox SUCCESS and operation audit are committed as one transaction.
    await this.writeAudit(tx, input.audit, {
      status: 'SUCCESS',
      inboxId: inbox.id,
      resolvedType: input.resolvedType,
      resolvedId: input.resolvedId,
      customerId: input.customerId,
    })
    return inbox
  }

  private async markFailed(
    audit: ExternalEventAudit,
    inboxId: string,
    requestHash: string,
    error: unknown,
  ) {
    const now = nowInstant()
    const detail = this.errorDetail(error)
    await this.prisma.client.transaction(async (tx) => {
      const inbox = await tx.orm.public.ExternalEventInbox.where({
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
      if (!inbox) return
      await this.writeAudit(tx, audit, {
        status: 'FAILED',
        inboxId: inbox.id,
        errorCode: detail.code,
      })
    })
  }

  private async recordReplayed(audit: ExternalEventAudit, inbox: InboxClaimRow) {
    await this.prisma.client.transaction(async (tx) => {
      await this.writeAudit(tx, audit, {
        status: 'REPLAYED',
        inboxId: inbox.id,
        resolvedType: inbox.resolvedType,
        resolvedId: inbox.resolvedId,
        customerId: inbox.customerId,
      })
    })
  }

  private async writeAudit(
    tx: PrismaTransaction,
    audit: ExternalEventAudit,
    result: {
      status: 'SUCCESS' | 'FAILED' | 'REPLAYED'
      inboxId: string
      resolvedType?: string | null
      resolvedId?: string | null
      customerId?: string | null
      errorCode?: string
    },
  ) {
    const { user, source, externalEventId, eventType, businessAction, request, requestMeta } = audit
    const log = await tx.orm.public.OperationLogs.create({
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      module: 'externalEvent',
      action:
        result.status === 'SUCCESS'
          ? 'execute'
          : result.status === 'FAILED'
            ? 'executeFailed'
            : 'executeReplay',
      targetId: result.resolvedId ?? result.inboxId,
      targetName: `${eventType} · ${source}`,
      ip: requestMeta?.ip ?? null,
    })
    // Record sanitized request parameters; never persist API credentials or authorization headers.
    await tx.orm.public.OperationLogBlobs.create({
      operationLogId: log.id,
      detail: jsonValue({
        status: result.status,
        source,
        eventType,
        externalEventId,
        businessAction,
        request,
        apiKeyUserId: user.id,
        accessKeySuffix: requestMeta?.accessKey?.slice(-6) ?? null,
        inboxId: result.inboxId,
        resolvedType: result.resolvedType ?? null,
        resolvedId: result.resolvedId ?? null,
        customerId: result.customerId ?? null,
        errorCode: result.errorCode ?? null,
      }),
    })
  }

  private errorDetail(error: unknown): { code: string; message: string } {
    if (error instanceof HttpException) {
      const response = error.getResponse()
      if (response && typeof response === 'object' && !Array.isArray(response)) {
        const body = response as { code?: unknown; message?: unknown }
        return {
          code:
            typeof body.code === 'string' && body.code ? body.code : `HTTP_${error.getStatus()}`,
          message: typeof body.message === 'string' && body.message ? body.message : error.message,
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
