import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { CustomersService } from '../../customers/customers.service'
import type { PrismaService } from '../../prisma.service'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { LeadsService } from '../leads/leads.service'
import type { ApplyExternalCustomerEventDto } from './dto/external-event.dto'
import type { ExternalResourceResolverService } from './external-resource-resolver.service'
import { ExternalEventsService } from './external-events.service'

const databaseUrl = process.env['DATABASE_URL']
const user = {
  id: 'api-user-1',
  tenantId: 'tenant-external-1',
  email: null,
  name: 'External API',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: ['*'],
} satisfies AuthUser

function dto(
  externalEventId: string,
  overrides: Partial<ApplyExternalCustomerEventDto> = {},
): ApplyExternalCustomerEventDto {
  return {
    source: 'finance-system',
    externalEventId,
    where: { studentName: '张三', phone: '13800000000' },
    set: { status: '已缴费' },
    ...overrides,
  }
}

function customerServices(options: {
  resolver: ExternalResourceResolverService
  onApply?: () => void
}) {
  const customers = {
    prepareDynamicFieldUpdate: async (_user: AuthUser, customerId: string, set: unknown) => ({
      existing: { id: customerId, owner: 'owner-1', updateTime: 1n },
      values: set,
    }),
    applyPreparedDynamicFieldUpdateInTransaction: async (
      _user: AuthUser,
      prepared: { existing: { id: string } },
    ) => {
      options.onApply?.()
      return { id: prepared.existing.id }
    },
    normalizeWritableDynamicFields: async (_user: AuthUser, set: Record<string, unknown>) => set,
  } as unknown as CustomersService
  const leads = {
    prepareResolvedLeadConversion: async (
      _user: AuthUser,
      leadId: string,
      customerCustomData: Record<string, unknown>,
    ) => ({ lead: { id: leadId }, customerCustomData }),
    convertResolvedLeadInTransaction: async () => ({
      customerId: 'customer-from-lead',
      createdCustomer: { id: 'customer-from-lead' },
    }),
    notifyResolvedLeadConversion: async () => undefined,
  } as unknown as LeadsService
  return { customers, leads }
}

test(
  'External Event 相同 eventId + 相同 payload 成功重放，不重复执行资源更新',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    let resolverCalls = 0
    let applyCalls = 0
    try {
      const resolver = {
        resolve: async () => {
          resolverCalls++
          return { kind: 'CUSTOMER', customerId: 'customer-1' } as const
        },
      } as unknown as ExternalResourceResolverService
      const deps = customerServices({ resolver, onApply: () => applyCalls++ })
      const service = new ExternalEventsService(
        { client: db.client } as PrismaService,
        resolver,
        deps.customers,
        deps.leads,
      )

      const first = await service.applyCustomerEvent(user, dto('evt-replay-1'))
      const replay = await service.applyCustomerEvent(
        user,
        dto('evt-replay-1', {
          where: { phone: '13800000000', studentName: '张三' },
        }),
      )

      assert.equal(first.replayed, false)
      assert.equal(replay.replayed, true)
      assert.equal(replay.customerId, 'customer-1')
      assert.equal(resolverCalls, 1)
      assert.equal(applyCalls, 1)
      const row = await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
        source: 'finance-system',
        externalEventId: 'evt-replay-1',
      }).first()
      assert.equal(row?.status, 'SUCCESS')
      assert.equal(row?.attempts, 1)
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: user.tenantId,
        module: 'externalEvent',
      }).deleteAll()
      await db.close()
    }
  },
)

test('External Event 禁止同一幂等键复用不同 payload', { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl)
  const db = await openPrismaTestDatabase(databaseUrl)
  try {
    const resolver = {
      resolve: async () => ({ kind: 'CUSTOMER', customerId: 'customer-1' }) as const,
    } as unknown as ExternalResourceResolverService
    const deps = customerServices({ resolver })
    const service = new ExternalEventsService(
      { client: db.client } as PrismaService,
      resolver,
      deps.customers,
      deps.leads,
    )
    await service.applyCustomerEvent(user, dto('evt-reuse-1'))

    await assert.rejects(
      () => service.applyCustomerEvent(user, dto('evt-reuse-1', { set: { status: '已退款' } })),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException)
        assert.equal((error.getResponse() as { code?: string }).code, 'IDEMPOTENCY_KEY_REUSED')
        return true
      },
    )
  } finally {
    await db.client.orm.public.ExternalEventInbox.where({
      organizationId: user.tenantId,
    }).deleteAll()
    await db.client.orm.public.OperationLogs.where({
      tenantId: user.tenantId,
      module: 'externalEvent',
    }).deleteAll()
    await db.close()
  }
})

test(
  'External Event FAILED 可用相同 payload 重试并递增 attempts',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    let fail = true
    try {
      const resolver = {
        resolve: async () => {
          if (fail) {
            throw new BadRequestException({ code: 'TEMP_FAIL', message: 'temporary failure' })
          }
          return { kind: 'CUSTOMER', customerId: 'customer-1' } as const
        },
      } as unknown as ExternalResourceResolverService
      const deps = customerServices({ resolver })
      const service = new ExternalEventsService(
        { client: db.client } as PrismaService,
        resolver,
        deps.customers,
        deps.leads,
      )

      await assert.rejects(() => service.applyCustomerEvent(user, dto('evt-retry-1')))
      let row = await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
        externalEventId: 'evt-retry-1',
      }).first()
      assert.equal(row?.status, 'FAILED')
      assert.equal(row?.attempts, 1)
      assert.equal(row?.errorCode, 'TEMP_FAIL')
      const failedLogs = await db.client.orm.public.OperationLogs.where({
        tenantId: user.tenantId,
        module: 'externalEvent',
        action: 'executeFailed',
      }).all()
      assert.equal(failedLogs.length, 1)
      assert.equal(failedLogs[0]?.userId, user.id)
      const failedDetail = await db.client.orm.public.OperationLogBlobs.where({
        operationLogId: failedLogs[0]!.id,
      }).first()
      assert.equal((failedDetail?.detail as { status?: string })?.status, 'FAILED')
      const request = (failedDetail?.detail as { request?: unknown })?.request
      assert.deepEqual(request, dto('evt-retry-1'))
      assert.equal(JSON.stringify(failedDetail?.detail).includes('attempts'), false)

      fail = false
      const retried = await service.applyCustomerEvent(user, dto('evt-retry-1'))
      assert.equal(retried.replayed, false)
      assert.equal(retried.attempts, 2)
      row = await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
        externalEventId: 'evt-retry-1',
      }).first()
      assert.equal(row?.status, 'SUCCESS')
      assert.equal(row?.attempts, 2)
      assert.equal(
        (
          await db.client.orm.public.OperationLogs.where({
            tenantId: user.tenantId,
            module: 'externalEvent',
            action: 'execute',
          }).all()
        ).length,
        1,
      )
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: user.tenantId,
        module: 'externalEvent',
      }).deleteAll()
      await db.close()
    }
  },
)

test(
  'External Event 并发重复请求在首个请求 PROCESSING 时返回 EVENT_PROCESSING',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve
    })
    try {
      const resolver = {
        resolve: async () => {
          entered()
          await gate
          return { kind: 'CUSTOMER', customerId: 'customer-1' } as const
        },
      } as unknown as ExternalResourceResolverService
      const deps = customerServices({ resolver })
      const service = new ExternalEventsService(
        { client: db.client } as PrismaService,
        resolver,
        deps.customers,
        deps.leads,
      )

      const first = service.applyCustomerEvent(user, dto('evt-concurrent-1'))
      await enteredPromise
      await assert.rejects(
        () => service.applyCustomerEvent(user, dto('evt-concurrent-1')),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException)
          assert.equal((error.getResponse() as { code?: string }).code, 'EVENT_PROCESSING')
          return true
        },
      )
      release()
      assert.equal((await first).status, 'SUCCESS')
    } finally {
      release?.()
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: user.tenantId,
        module: 'externalEvent',
      }).deleteAll()
      await db.close()
    }
  },
)

test(
  'External Event Lead 唯一命中时使用 resolved conversion 并把 set 传入 Customer',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    let normalizedSet: Record<string, unknown> | null = null
    let preparedSet: Record<string, unknown> | null = null
    let notified = 0
    try {
      const resolver = {
        resolve: async () => ({ kind: 'LEAD', leadId: 'lead-1', ownerId: 'owner-1' }) as const,
      } as unknown as ExternalResourceResolverService
      const customers = {
        normalizeWritableDynamicFields: async (_user: AuthUser, set: Record<string, unknown>) => {
          normalizedSet = { cf_status: set['status'] }
          return normalizedSet
        },
      } as unknown as CustomersService
      const leads = {
        prepareResolvedLeadConversion: async (
          _user: AuthUser,
          leadId: string,
          set: Record<string, unknown>,
        ) => {
          assert.equal(leadId, 'lead-1')
          preparedSet = set
          return { lead: { id: leadId } }
        },
        convertResolvedLeadInTransaction: async () => ({
          customerId: 'customer-from-lead',
          createdCustomer: { id: 'customer-from-lead' },
        }),
        notifyResolvedLeadConversion: async () => {
          notified++
        },
      } as unknown as LeadsService
      const service = new ExternalEventsService(
        { client: db.client } as PrismaService,
        resolver,
        customers,
        leads,
      )

      const result = await service.applyCustomerEvent(user, dto('evt-lead-1'))
      assert.deepEqual(normalizedSet, { cf_status: '已缴费' })
      assert.deepEqual(preparedSet, { cf_status: '已缴费' })
      assert.equal(result.customerId, 'customer-from-lead')
      assert.equal(result.resolvedType, 'LEAD')
      assert.equal(result.resolvedId, 'lead-1')
      assert.equal(notified, 1)
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: user.tenantId,
        module: 'externalEvent',
      }).deleteAll()
      await db.close()
    }
  },
)
test(
  'External Event 普通调用无需 externalEventId，服务端自动分配；显式编号仍支持幂等重放',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    let updates = 0
    try {
      const resolved = { kind: 'CUSTOMER' as const, customerId: 'customer-1' }
      const templates = {
        findEnabled: async () => ({
          source: 'reception-system',
          eventType: 'RECEPTION_COMPLETED',
          config: { flow: { action: 'update', target: 'customer' } },
        }),
        prepareFlow: async () => ({
          flow: { action: 'update', target: 'customer' },
          resolved,
          set: { cf_status: '已缴费' },
          ownerId: null,
        }),
      }
      const resolver = {} as ExternalResourceResolverService
      const deps = customerServices({ resolver, onApply: () => updates++ })
      const service = new ExternalEventsService(
        { client: db.client } as PrismaService,
        resolver,
        deps.customers,
        deps.leads,
        templates as never,
      )
      const request = {
        eventType: 'RECEPTION_COMPLETED',
        data: { phone: '13800000000' },
      }
      const first = await service.executeConfigured(user, request)
      const second = await service.executeConfigured(user, request)
      assert.match(first.externalEventId, /^auto-[0-9a-f-]{36}$/)
      assert.match(second.externalEventId, /^auto-[0-9a-f-]{36}$/)
      assert.notEqual(first.externalEventId, second.externalEventId)
      assert.equal(first.replayed, false)
      assert.equal(second.replayed, false)
      assert.equal(first.source, 'reception-system')
      assert.equal(updates, 2)

      const explicit = await service.executeConfigured(user, {
        ...request,
        externalEventId: 'source-business-event-1',
      })
      const replay = await service.executeConfigured(user, {
        ...request,
        source: 'legacy-client-source-is-ignored',
        externalEventId: 'source-business-event-1',
      })
      assert.equal(explicit.replayed, false)
      assert.equal(replay.replayed, true)
      assert.equal(updates, 3)
      assert.equal(replay.externalEventId, 'source-business-event-1')
      await assert.rejects(
        () =>
          service.executeConfigured(user, {
            ...request,
            data: { phone: '19999999999' },
            externalEventId: 'source-business-event-1',
          }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException)
          assert.equal((error.getResponse() as { code?: string }).code, 'IDEMPOTENCY_KEY_REUSED')
          return true
        },
      )
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: user.tenantId,
        module: 'externalEvent',
      }).deleteAll()
      await db.close()
    }
  },
)
