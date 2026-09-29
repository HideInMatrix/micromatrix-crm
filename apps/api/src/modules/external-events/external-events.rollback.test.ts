import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { CustomersService } from '../../customers/customers.service'
import type { PrismaClient } from '../../prisma/db.js'
import type { PrismaService } from '../../prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { LeadsService } from '../leads/leads.service'
import type { ApplyExternalCustomerEventDto } from './dto/external-event.dto'
import type { ExternalResourceResolverService } from './external-resource-resolver.service'
import { ExternalEventsService } from './external-events.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

const databaseUrl = process.env['DATABASE_URL']
const user = {
  id: 'api-user-rollback',
  tenantId: 'tenant-external-rollback',
  email: null,
  name: 'External API',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: ['*'],
} satisfies AuthUser

const input: ApplyExternalCustomerEventDto = {
  source: 'finance-system',
  externalEventId: 'evt-rollback-1',
  where: { phone: '13800000000' },
  set: { status: '已缴费' },
}

test(
  'External Event Lead 转换事务内后续失败时业务写入回滚且 Inbox 记录 FAILED',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    const sentinelEventId = 'evt-rollback-sentinel'
    try {
      const resolver = {
        resolve: async () =>
          ({ kind: 'LEAD', leadId: 'lead-rollback', ownerId: 'owner-1' }) as const,
      } as unknown as ExternalResourceResolverService
      const customers = {
        normalizeWritableDynamicFields: async (
          _user: AuthUser,
          set: Record<string, unknown>,
        ) => set,
      } as unknown as CustomersService
      const leads = {
        prepareResolvedLeadConversion: async () => ({ lead: { id: 'lead-rollback' } }),
        convertResolvedLeadInTransaction: async (
          _user: AuthUser,
          _prepared: unknown,
          tx: PrismaTransaction,
        ) => {
          await tx.orm.public.ExternalEventInbox.create({
            organizationId: user.tenantId,
            source: 'test-sentinel',
            externalEventId: sentinelEventId,
            requestHash: '0'.repeat(64),
            apiKeyUserId: user.id,
            status: 'PROCESSING',
            updatedAt: nowInstant(),
          })
          throw new BadRequestException({
            code: 'CUSTOMER_FIELD_WRITE_FAILED',
            message: '模拟 Customer 动态字段写入失败',
          })
        },
        notifyResolvedLeadConversion: async () => undefined,
      } as unknown as LeadsService
      const service = new ExternalEventsService(
        { client: db.client } as PrismaService,
        resolver,
        customers,
        leads,
      )

      await assert.rejects(() => service.applyCustomerEvent(user, input))

      const sentinel = await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
        source: 'test-sentinel',
        externalEventId: sentinelEventId,
      }).first()
      assert.equal(sentinel, null)
      const failed = await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
        externalEventId: input.externalEventId,
      }).first()
      assert.equal(failed?.status, 'FAILED')
      assert.equal(failed?.errorCode, 'CUSTOMER_FIELD_WRITE_FAILED')
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({
        organizationId: user.tenantId,
      }).deleteAll()
      await db.close()
    }
  },
)
