import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
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

test('OrganizationSync 使用 Prisma 保持 preview、JSON 关键词与冲突级联语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-org-sync')
  const role = await prismaClient.orm.public.Roles.select('id').create({
    tenantId: tenant.id,
    name: '同步默认角色',
    permissions: [],
    dataScope: 'SELF',
    updatedAt: nowInstant(),
  })
  const target = await createPrismaTestDepartment(prismaClient, {
    tenantId: tenant.id,
    name: '同步目标部门',
  })
  const integration = await prismaClient.orm.public.EnterpriseIntegrations.select(
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
    updatedAt: nowInstant(),
  })
  const integration8 = await prisma.client.orm.public.EnterpriseIntegrations.where({
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
    prisma,
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
    const persisted = await prismaClient.orm.public.OrganizationSyncBatches.where({
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

    const conflict = await prismaClient.orm.public.OrganizationSyncItems.select(
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
      updatedAt: nowInstant(),
    })
    await prismaClient.orm.public.OrganizationSyncItems.createAll([
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
        updatedAt: nowInstant(),
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
        updatedAt: nowInstant(),
      },
    ])

    await service.resolve(actor, preview.id, {
      items: [{ itemId: conflict.id, resolution: 'SKIP' }],
    })
    const cascaded = await prismaClient.orm.public.OrganizationSyncItems.where({
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
    const resolvedBatch = await prismaClient.orm.public.OrganizationSyncBatches.where({
      id: preview.id,
    }).first()
    assert.ok(resolvedBatch)
    assert.ok(Number((resolvedBatch.counts as Record<string, number>)['skip']) >= 3)
  } finally {
    await prismaClient.orm.public.OrganizationSyncItems.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.OrganizationSyncBatches.where({
      tenantId: tenant.id,
    }).deleteAll()
    await prismaClient.orm.public.EnterpriseIntegrations.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Departments.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Roles.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
