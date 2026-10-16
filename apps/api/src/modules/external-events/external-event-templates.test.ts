import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import type { ExternalEventTemplateInput, FieldVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { CustomersService } from '../../customers/customers.service'
import type { PrismaService } from '../../prisma.service'
import { nowInstant } from '../../prisma/temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { LeadsService } from '../leads/leads.service'
import type { MetadataService } from '../metadata/metadata.service'
import { ExternalEventTemplatesService } from './external-event-templates.service'
import type { ExternalResourceResolverService } from './external-resource-resolver.service'
import { ExternalEventsService } from './external-events.service'

const databaseUrl = process.env['DATABASE_URL']

function actor(tenantId: string, id: string): AuthUser {
  return {
    id,
    tenantId,
    email: null,
    name: 'Integration admin',
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  }
}

const leadFields = [
  { id: 'lead-phone', key: 'phone', label: '手机号', system: true, hidden: false, type: 'phone' },
  { id: 'lead-name', key: 'name', label: '学生姓名', system: true, hidden: false, type: 'text' },
] as FieldVO[]
const customerFields = [
  {
    id: 'customer-phone',
    key: 'phone',
    label: '手机号',
    system: false,
    hidden: false,
    type: 'phone',
  },
  {
    id: 'customer-inviter',
    key: 'inviter',
    label: '邀约人',
    system: false,
    hidden: false,
    type: 'member',
  },
  {
    id: 'customer-reception',
    key: 'receptionist',
    label: '接待人',
    system: false,
    hidden: false,
    type: 'member',
  },
  {
    id: 'customer-owner',
    key: 'owner',
    label: '客户负责人',
    system: true,
    hidden: false,
    type: 'member',
  },
] as FieldVO[]
const metadata = {
  listFields: async (_tenantId: string, module: string) =>
    module === 'customer' ? customerFields : leadFields,
} as MetadataService

function config(owner = true): ExternalEventTemplateInput['config'] {
  return {
    actions: { convertLead: true, updateCustomer: true },
    matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
    fields: [
      { source: 'leadOwner', externalKey: '', customerFieldKey: 'inviter' },
      { source: 'event', externalKey: 'receptionist', customerFieldKey: 'receptionist' },
    ],
    owner: owner ? { externalKey: 'receptionist', provider: 'CRM' } : null,
  }
}

function input(id: string): ExternalEventTemplateInput {
  return {
    name: '接待完成',
    eventType: 'RECEPTION_COMPLETED',
    source: 'reception-system',
    apiKeyUserId: id,
    enabled: false,
    config: config(),
  }
}

test(
  '管理员外部事件配置 CRUD、版本更新、禁用删除、API Key 所属账号绑定',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    const tenant = await createPrismaTestTenant(db.client, 'external-template')
    const member = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const other = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const user = actor(tenant.id, member.id)
    const resolver = {
      resolve: async () => ({ kind: 'LEAD', leadId: 'lead-1', ownerId: member.id }),
    } as unknown as ExternalResourceResolverService
    const customers = {
      normalizeWritableDynamicFields: async (_user: AuthUser, values: Record<string, unknown>) =>
        values,
    } as CustomersService
    const leads = {
      prepareResolvedLeadConversion: async () => ({}),
    } as unknown as LeadsService
    const service = new ExternalEventTemplatesService(
      { client: db.client } as PrismaService,
      metadata,
      resolver,
      customers,
      leads,
    )
    try {
      const saved = await service.create(user, input(member.id))
      assert.equal(saved.enabled, false)
      assert.equal(saved.version, 1)
      assert.equal(saved.config.owner?.provider, 'CRM')
      assert.equal((await service.list(user)).length, 1)
      assert.deepEqual(await service.get(user, saved.id), saved)
      await assert.rejects(
        () => service.findEnabled(user, saved.eventType, saved.source),
        NotFoundException,
      )
      assert.match(saved.eventType, /^EVENT_[A-F0-9]{32}$/)
      assert.match(saved.source, /^event-[a-f0-9]{32}$/)
      assert.notEqual(saved.eventType, input(member.id).eventType)
      const second = await service.create(user, {
        name: '自动创建的独立事件',
        apiKeyUserId: member.id,
        enabled: false,
        config: config(),
      })
      assert.notEqual(second.eventType, saved.eventType)
      await service.delete(user, second.id)
      await assert.rejects(
        () => service.update(user, saved.id, { eventType: 'NEW_NAME' }),
        BadRequestException,
      )
      const renamed = await service.update(user, saved.id, { name: '接待完成事件' })
      assert.equal(renamed.version, 1)
      const logicChanged = await service.update(user, saved.id, {
        config: { ...renamed.config, owner: { externalKey: 'receptionist', provider: 'WECOM' } },
      })
      assert.equal(logicChanged.version, 2)
      const enabled = await service.update(user, saved.id, { enabled: true })
      assert.equal(enabled.version, 2)
      await assert.rejects(() => service.delete(user, saved.id), BadRequestException)
      await assert.rejects(
        () => service.findEnabled(actor(tenant.id, other.id), saved.eventType, saved.source),
        ForbiddenException,
      )
      const accepted = await service.findEnabled(user, saved.eventType, saved.source)
      assert.equal(accepted.id, saved.id)
      const disabled = await service.update(user, saved.id, { enabled: false })
      assert.equal(disabled.version, 2)
      await service.delete(user, saved.id)
      assert.equal((await service.list(user)).length, 0)
    } finally {
      await db.client.orm.public.ExternalEventTemplates.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Tenants.where({ id: tenant.id }).delete()
      await db.close()
    }
  },
)

test(
  '事件字段校验拒绝改写 owner 系统字段、非成员类型邀请人和无效动作',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    const tenant = await createPrismaTestTenant(db.client, 'external-validator')
    const member = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const user = actor(tenant.id, member.id)
    const service = new ExternalEventTemplatesService(
      { client: db.client } as PrismaService,
      metadata,
      {
        resolve: async () => ({ kind: 'LEAD', leadId: '1', ownerId: member.id }),
      } as unknown as ExternalResourceResolverService,
      {} as CustomersService,
      {} as unknown as LeadsService,
    )
    try {
      const invalidOwner = input(member.id)
      invalidOwner.config.fields[0]!.customerFieldKey = 'owner'
      await assert.rejects(() => service.create(user, invalidOwner), BadRequestException)
      const invalidActions = input(member.id)
      invalidActions.config.actions = { convertLead: false, updateCustomer: false }
      await assert.rejects(() => service.create(user, invalidActions), BadRequestException)
      const invalidDuplicate = input(member.id)
      invalidDuplicate.config.matches.push({ externalKey: 'phone2', crmFieldKey: 'phone' })
      await assert.rejects(() => service.create(user, invalidDuplicate), BadRequestException)
    } finally {
      await db.client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Tenants.where({ id: tenant.id }).delete()
      await db.close()
    }
  },
)

test(
  '配置驱动事件一次调用：原线索 A、接待人 B 归属、同事件幂等重放',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    const tenant = await createPrismaTestTenant(db.client, 'external-execute')
    const original = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const receptionist = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const user = actor(tenant.id, original.id)
    const template = {
      ...input(original.id),
      id: 'template-test',
      version: 1,
      enabled: true,
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    }
    let resolved = 0
    let created = 0
    const templates = {
      findEnabled: async (u: AuthUser) => {
        assert.equal(u.id, original.id)
        return template
      },
      prepare: async (_u: AuthUser, _t: unknown, data: Record<string, unknown>) => {
        resolved++
        return {
          resolved: { kind: 'LEAD' as const, leadId: 'lead-1', ownerId: original.id },
          set: { inviter: original.id, receptionist: data.receptionist },
          ownerId: data.receptionist as string,
        }
      },
    } as unknown as ExternalEventTemplatesService
    const customers = {
      normalizeWritableDynamicFields: async (_u: AuthUser, values: Record<string, unknown>) =>
        values,
    } as CustomersService
    const leads = {
      prepareResolvedLeadConversion: async (
        _u: AuthUser,
        leadId: string,
        values: Record<string, unknown>,
        ownerId?: string,
      ) => {
        assert.equal(leadId, 'lead-1')
        assert.deepEqual(values, { inviter: original.id, receptionist: receptionist.id })
        assert.equal(ownerId, receptionist.id)
        return { lead: { id: leadId } }
      },
      convertResolvedLeadInTransaction: async () => {
        created++
        return {
          customerId: 'customer-created',
          createdCustomer: { id: 'customer-created' },
          contactIds: [],
        }
      },
      notifyResolvedLeadConversion: async () => undefined,
    } as unknown as LeadsService
    const service = new ExternalEventsService(
      { client: db.client } as PrismaService,
      {} as unknown as ExternalResourceResolverService,
      customers,
      leads,
      templates,
    )
    const dto = {
      source: template.source,
      eventType: template.eventType,
      externalEventId: `RECEPTION-${tenant.id}`,
      data: { phone: '13800000000', receptionist: receptionist.id },
    }
    try {
      const first = await service.executeConfigured(user, dto)
      const replay = await service.executeConfigured(user, dto)
      assert.equal(first.customerId, 'customer-created')
      assert.equal(first.replayed, false)
      assert.equal(replay.replayed, true)
      assert.equal(created, 1)
      assert.equal(resolved, 1)
      await assert.rejects(
        () =>
          service.executeConfigured(user, { ...dto, data: { ...dto.data, phone: '13900000000' } }),
        ConflictException,
      )
      const logged = await db.client.orm.public.ExternalEventInbox.where({
        organizationId: tenant.id,
      }).first()
      assert.equal(logged?.eventType, template.eventType)
      assert.equal(logged?.status, 'SUCCESS')
    } finally {
      await db.client.orm.public.ExternalEventInbox.where({ organizationId: tenant.id }).deleteAll()
      await db.client.orm.public.OperationLogs.where({
        tenantId: tenant.id,
        module: 'externalEvent',
      }).deleteAll()
      await db.client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Tenants.where({ id: tenant.id }).delete()
      await db.close()
    }
  },
)

test(
  '事件模板真正将 A 线索负责人映射为邀约人、B 接待者映射为新客户 owner',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const db = await openPrismaTestDatabase(databaseUrl)
    const tenant = await createPrismaTestTenant(db.client, 'external-mapping')
    const inviter = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const receptionist = await createPrismaTestUser(db.client, { tenantId: tenant.id })
    const user = actor(tenant.id, inviter.id)
    let lookup = 0
    await db.client.orm.public.ExternalUserMappings.create({
      tenantId: tenant.id,
      provider: 'WECOM',
      externalId: 'wecom-teacher-b',
      externalKey: 'wecom-teacher-b-key',
      userId: receptionist.id,
      updatedAt: nowInstant(),
    })
    const service = new ExternalEventTemplatesService(
      { client: db.client } as PrismaService,
      metadata,
      {
        resolve: async (_user: AuthUser, where: Record<string, unknown>) => {
          lookup++
          assert.deepEqual(where, { phone: '13800000000' })
          return { kind: 'LEAD', leadId: 'lead-a', ownerId: inviter.id } as const
        },
      } as unknown as ExternalResourceResolverService,
      {} as CustomersService,
      {} as LeadsService,
    )
    try {
      const template = {
        ...input(inviter.id),
        config: { ...config(), owner: { externalKey: 'receptionist', provider: 'WECOM' as const } },
        id: 'test',
        version: 1,
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z',
      }
      const prepared = await service.prepare(user, template, {
        phone: '13800000000',
        receptionist: 'wecom-teacher-b',
      })
      assert.equal(lookup, 1)
      assert.equal(prepared.resolved.kind, 'LEAD')
      assert.equal(prepared.ownerId, receptionist.id)
      assert.deepEqual(prepared.set, { inviter: inviter.id, receptionist: receptionist.id })
      await assert.rejects(
        () => service.prepare(user, template, { phone: '13800000000', receptionist: 'unknown' }),
        BadRequestException,
      )
    } finally {
      await db.client.orm.public.ExternalUserMappings.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await db.client.orm.public.Tenants.where({ id: tenant.id }).delete()
      await db.close()
    }
  },
)
