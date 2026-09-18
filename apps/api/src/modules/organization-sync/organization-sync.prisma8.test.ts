import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { jsonValue } from '../../prisma/json-value'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { WeComClient } from '../enterprise-integrations/wecom.client'
import { OrganizationSyncPlanner } from './organization-sync.planner'
import { OrganizationSyncService } from './organization-sync.service'

test('OrganizationSync 使用 Prisma 8 保持 preview、JSON 关键词与冲突级联语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-org-sync')
  const role = await prisma8Client.orm.public.Roles.select('id').create({
    tenantId: tenant.id,
    name: '同步默认角色',
    permissions: [],
    dataScope: 'SELF',
    updatedAt: prisma8Now(),
  })
  const target = await createPrismaTestDepartment(prisma8Client, {
    tenantId: tenant.id,
    name: '同步目标部门',
  })
  const integration = await prisma8Client.orm.public.EnterpriseIntegrations.select(
    'id',
    'corpId',
    'agentId',
  ).create({
    tenantId: tenant.id,
    provider: 'WECOM',
    corpId: `corp-${suffix}`,
    agentId: '1000001',
    secretCiphertext: 'ciphertext',
    secretIv: 'iv',
    secretAuthTag: 'tag',
    syncEnabled: true,
    syncDefaultRoleId: role.id,
    lastTestSucceeded: true,
    createdById: 'admin-a',
    updatedById: 'admin-a',
    updatedAt: prisma8Now(),
  })
  const integration8 = await prisma8.client.orm.public.EnterpriseIntegrations.where({
    id: integration.id,
  }).first()
  assert.ok(integration8)

  const integrations = {
    getWeComSyncContext: async () => ({
      integration: integration8,
      credentials: {
        corpId: integration.corpId,
        agentId: integration.agentId,
        appSecret: 'secret',
      },
    }),
  } as unknown as EnterpriseIntegrationsService
  const weCom = {
    getOrganizationSnapshot: async () => ({
      departments: [
        {
          id: 'remote-root',
          externalKey: 'remote-root',
          name: '远端企业根',
          parentId: '0',
          parentExternalKey: '0',
          order: 100,
          isRoot: true,
        },
        {
          id: 'remote-search',
          externalKey: 'remote-search',
          name: '关键搜索部门',
          parentId: 'remote-root',
          parentExternalKey: 'remote-root',
          order: 90,
          isRoot: false,
        },
      ],
      users: [],
    }),
  } as unknown as WeComClient
  const service = new OrganizationSyncService(
    prisma8,
    integrations,
    weCom,
    new OrganizationSyncPlanner(),
  )
  const actor = {
    id: 'admin-a',
    tenantId: tenant.id,
    email: null,
    name: '管理员',
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  } as AuthUser

  try {
    const preview = await service.createPreview(actor, { targetDepartmentId: target.id })
    assert.equal(preview.status, 'PREVIEW_READY')
    const persisted = await prisma8Client.orm.public.OrganizationSyncBatches.where({
      id: preview.id,
    }).first()
    assert.ok(persisted)
    assert.equal(persisted.status, 'PREVIEW_READY')

    const searched = await service.items(tenant.id, preview.id, {
      page: 1,
      pageSize: 10,
      keyword: '关键搜索',
    })
    assert.equal(searched.total, 1)
    assert.equal((searched.items[0]?.sourceData as Record<string, unknown>)['name'], '关键搜索部门')

    const conflict = await prisma8Client.orm.public.OrganizationSyncItems.select(
      'id',
      'externalKey',
    ).create({
      tenantId: tenant.id,
      batchId: preview.id,
      resourceType: 'DEPARTMENT',
      externalId: 'conflict-dept',
      externalKey: 'conflict-dept',
      parentExternalKey: 'remote-root',
      action: 'CONFLICT',
      sourceData: jsonValue({ name: '冲突部门' }),
      conflictType: 'NAME_CONFLICT',
      conflictMessage: '部门冲突',
      sort: 1000,
      updatedAt: prisma8Now(),
    })
    await prisma8Client.orm.public.OrganizationSyncItems.createAll([
      {
        tenantId: tenant.id,
        batchId: preview.id,
        resourceType: 'DEPARTMENT',
        externalId: 'conflict-child',
        externalKey: 'conflict-child',
        parentExternalKey: conflict.externalKey,
        action: 'CREATE',
        sourceData: jsonValue({ name: '冲突下级部门' }),
        sort: 1001,
        updatedAt: prisma8Now(),
      },
      {
        tenantId: tenant.id,
        batchId: preview.id,
        resourceType: 'USER',
        externalId: 'conflict-user',
        externalKey: 'conflict-user',
        parentExternalKey: 'conflict-child',
        action: 'CREATE',
        sourceData: jsonValue({ name: '冲突下级成员' }),
        sort: 1002,
        updatedAt: prisma8Now(),
      },
    ])

    await service.resolve(actor, preview.id, {
      items: [{ itemId: conflict.id, resolution: 'SKIP' }],
    })
    const cascaded = await prisma8Client.orm.public.OrganizationSyncItems.where({
      batchId: preview.id,
    })
      .where((row) => row.externalKey.in(['conflict-dept', 'conflict-child', 'conflict-user']))
      .orderBy((row) => row.sort.asc())
      .all()
    assert.deepEqual(
      cascaded.map((item) => item.action),
      ['SKIP', 'SKIP', 'SKIP'],
    )
    assert.deepEqual(
      cascaded.map((item) => item.result),
      ['RESOLVED', 'RESOLVED', 'RESOLVED'],
    )
    const resolvedBatch = await prisma8Client.orm.public.OrganizationSyncBatches.where({
      id: preview.id,
    }).first()
    assert.ok(resolvedBatch)
    assert.ok(Number((resolvedBatch.counts as Record<string, number>)['skip']) >= 3)
  } finally {
    await prisma8Client.orm.public.OrganizationSyncItems.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.OrganizationSyncBatches.where({
      tenantId: tenant.id,
    }).deleteAll()
    await prisma8Client.orm.public.EnterpriseIntegrations.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Departments.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Roles.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
