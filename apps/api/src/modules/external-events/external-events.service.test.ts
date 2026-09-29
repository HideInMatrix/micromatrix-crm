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
      contactIds: [],
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
      await db.close()
    }
  },
)

test(
  'External Event 禁止同一幂等键复用不同 payload',
  { skip: !databaseUrl },
  async () => {
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
        () =>
          service.applyCustomerEvent(
            user,
            dto('evt-reuse-1', { set: { status: '已退款' } }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException)
          assert.equal(
            (error.getResponse() as { code?: string }).code,
            'IDEMPOTENCY_KEY_REUSED',
          )
          return true
        },
      )
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.close()
    }
  },
)

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
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
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
        resolve: async () =>
          ({ kind: 'LEAD', leadId: 'lead-1', ownerId: 'owner-1' }) as const,
      } as unknown as ExternalResourceResolverService
      const customers = {
        normalizeWritableDynamicFields: async (
          _user: AuthUser,
          set: Record<string, unknown>,
        ) => {
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
          contactIds: [],
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
      await db.close()
    }
  },
)
