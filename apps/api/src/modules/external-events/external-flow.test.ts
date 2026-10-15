import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { ExternalEventTemplateInput, FieldVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma.service'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { MetadataService } from '../metadata/metadata.service'
import type { CustomersService } from '../../customers/customers.service'
import type { LeadsService } from '../leads/leads.service'
import { ExternalEventTemplatesService } from './external-event-templates.service'
import { ExternalEventsService } from './external-events.service'
import type { ExternalResourceResolverService } from './external-resource-resolver.service'

test(
  'v2 线索更新按目标模块定位、事务写入且重复事件不会重新执行',
  { skip: !process.env['DATABASE_URL'] },
  async () => {
    const db = await openPrismaTestDatabase(process.env['DATABASE_URL']!)
    const tenant = await createPrismaTestTenant(db.client, 'flow-test')
    const member = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const user: AuthUser = {
      id: member.id,
      tenantId: tenant.id,
      name: 'Admin',
      email: null,
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }
    const fields = [
      {
        id: 'lead-phone',
        key: 'phone',
        label: '手机号',
        type: 'phone',
        system: true,
        hidden: false,
      },
      {
        id: 'lead-note',
        key: 'cf_note',
        label: '备注',
        type: 'text',
        system: false,
        hidden: false,
      },
    ] as FieldVO[]
    const metadata = { listFields: async () => fields } as unknown as MetadataService
    let lookups = 0,
      writes = 0
    const resolver = {
      resolveTarget: async (_: AuthUser, target: string, where: Record<string, unknown>) => {
        assert.equal(target, 'lead')
        assert.deepEqual(where, { phone: '13800000000' })
        lookups++
        return { kind: 'LEAD', leadId: 'lead-1', ownerId: member.id }
      },
    } as unknown as ExternalResourceResolverService
    const customers = {} as CustomersService
    const leads = {
      prepareExternalDynamicFieldUpdate: async (
        _: AuthUser,
        id: string,
        set: Record<string, unknown>,
      ) => {
        assert.equal(id, 'lead-1')
        assert.deepEqual(set, { cf_note: '接待完成' })
        return { existing: { id }, values: set }
      },
      applyPreparedExternalDynamicFieldUpdateInTransaction: async () => {
        writes++
      },
    } as unknown as LeadsService
    const templates = new ExternalEventTemplatesService(
      { client: db.client } as PrismaService,
      metadata,
      resolver,
      customers,
      leads,
    )
    const events = new ExternalEventsService(
      { client: db.client } as PrismaService,
      resolver,
      customers,
      leads,
      templates,
    )
    const input: ExternalEventTemplateInput = {
      name: '线索同步',
      source: 'flow-test',
      eventType: 'FLOW_UPDATED',
      apiKeyUserId: member.id,
      enabled: true,
      config: {
        actions: { convertLead: false, updateCustomer: false },
        fields: [],
        owner: null,
        matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
        flow: {
          target: 'lead',
          action: 'update',
          owner: null,
          fields: [{ source: 'event', externalKey: 'note', fieldKey: 'cf_note' }],
        },
      },
    }
    try {
      const saved = await templates.create(user, input)
      const dto = {
        source: saved.source,
        eventType: saved.eventType,
        externalEventId: 'FLOW-1',
        data: { phone: '13800000000', note: '接待完成' },
      }
      assert.equal(
        (
          await events.executeConfigured(user, dto, {
            ip: '127.0.0.1',
            accessKey: 'ak_example_ABCDEF',
          })
        ).replayed,
        false,
      )
      assert.equal((await events.executeConfigured(user, dto)).replayed, true)
      const audits = await db.client.orm.public.OperationLogs.where({
        tenantId: tenant.id,
        module: 'externalEvent',
      }).all()
      assert.deepEqual(audits.map((log) => log.action).sort(), ['execute', 'executeReplay'])
      assert.ok(audits.every((log) => log.userId === member.id && log.userName === 'Admin'))
      const successLog = audits.find((log) => log.action === 'execute')!
      assert.equal(successLog.ip, '127.0.0.1')
      assert.equal(successLog.targetId, 'lead-1')
      const blob = await db.client.orm.public.OperationLogBlobs.where({
        operationLogId: successLog.id,
      }).first()
      const detail = blob?.detail as Record<string, unknown> | undefined
      assert.equal(detail?.status, 'SUCCESS')
      assert.equal(detail?.apiKeyUserId, member.id)
      assert.equal(detail?.accessKeySuffix, 'ABCDEF')
      assert.equal(detail?.businessAction, 'update')
      assert.equal(detail?.externalEventId, 'FLOW-1')
      assert.deepEqual(detail?.request, dto)
      assert.equal('attempts' in (detail ?? {}), false)
      assert.equal(JSON.stringify(detail).includes('接待完成'), true)
      assert.equal(lookups, 1)
      assert.equal(writes, 1)
      const invalid = {
        ...input,
        eventType: 'FLOW_INVALID',
        config: {
          ...input.config,
          flow: { ...input.config.flow!, target: 'customer' as const, action: 'convert' as const },
        },
      }
      await assert.rejects(() => templates.create(user, invalid), BadRequestException)
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({ organizationId: tenant.id }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: tenant.id,
        module: 'externalEvent',
      }).deleteAll()
      await db.client.orm.public.ExternalEventTemplates.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Tenants.where({ id: tenant.id }).delete()
      await db.close()
    }
  },
)
