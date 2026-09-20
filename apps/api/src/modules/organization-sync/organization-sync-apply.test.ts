import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { NotificationsService } from '../notifications/notifications.service'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'

const databaseUrl = process.env['DATABASE_URL']

async function deleteOrganizationSyncFixture(prisma: PrismaService['client'], tenantId: string) {
  await prisma.orm.public.OperationLogs.where({ tenantId }).deleteAll()
  await prisma.orm.public.ExternalUserMappings.where({ tenantId }).deleteAll()
  await prisma.orm.public.ExternalDepartmentMappings.where({ tenantId }).deleteAll()
  await prisma.orm.public.OrganizationSyncItems.where({ tenantId }).deleteAll()
  await prisma.orm.public.OrganizationSyncBatches.where({ tenantId }).deleteAll()
  await prisma.orm.public.UserRoles.where({ tenantId }).deleteAll()
  await prisma.orm.public.Users.where({ tenantId }).deleteAll()
  await prisma.orm.public.Departments.where({ tenantId }).deleteAll()
  await prisma.orm.public.EnterpriseIntegrations.where({ tenantId }).deleteAll()
  await prisma.orm.public.Roles.where({ tenantId }).deleteAll()
  await prisma.orm.public.Tenants.where({ id: tenantId }).deleteAll()
}

test(
  '组织同步 apply 由 Prisma transaction 持有 advisory lock 与部门/成员/mapping/batch 收口',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const actorId = `actor-${suffix}`
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-org-sync-apply')
      tenantId = tenant.id
      await prismaClient.orm.public.Tenants.where({ id: tenant.id }).update({
        enterpriseSyncResource: 'WECOM',
        updatedAt: nowInstant(),
      })
      const targetDepartment = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '本地同步根部门',
        sort: 1,
      })
      const role = await prismaClient.orm.public.Roles.select('id').create({
        tenantId: tenant.id,
        name: `外部成员默认角色-${suffix}`,
        updatedAt: nowInstant(),
      })
      const integration = await prismaClient.orm.public.EnterpriseIntegrations.select(
        'id',
        'credentialVersion',
      ).create({
        tenantId: tenant.id,
        provider: 'WECOM',
        corpId: `corp-${suffix}`,
        agentId: '1000001',
        secretCiphertext: 'ciphertext',
        secretIv: 'iv',
        secretAuthTag: 'tag',
        credentialVersion: 7,
        syncEnabled: true,
        syncDefaultRoleId: role.id,
        lastTestSucceeded: true,
        createdById: actorId,
        updatedById: actorId,
        updatedAt: nowInstant(),
      })
      const batch = await prismaClient.orm.public.OrganizationSyncBatches.select('id').create({
        tenantId: tenant.id,
        integrationId: integration.id,
        provider: 'WECOM',
        status: 'PREVIEW_READY',
        targetDepartmentId: targetDepartment.id,
        credentialVersion: integration.credentialVersion,
        counts: jsonValue({ departments: 1, users: 1, conflicts: 0 }),
        createdById: actorId,
        previewedAt: nowInstant(),
        updatedAt: nowInstant(),
      })
      const departmentKey = `dept-key-${suffix}`
      const departmentItem = await prismaClient.orm.public.OrganizationSyncItems.select(
        'id',
      ).create({
        tenantId: tenant.id,
        batchId: batch.id,
        resourceType: 'DEPARTMENT',
        externalId: `dept-external-${suffix}`,
        externalKey: departmentKey,
        action: 'CREATE',
        sourceData: jsonValue({ name: '外部研发部', order: 88 }),
        sort: 10,
        updatedAt: nowInstant(),
      })
      const userItem = await prismaClient.orm.public.OrganizationSyncItems.select('id').create({
        tenantId: tenant.id,
        batchId: batch.id,
        resourceType: 'USER',
        externalId: `user-external-${suffix}`,
        externalKey: `user-key-${suffix}`,
        action: 'CREATE',
        parentExternalKey: departmentKey,
        sourceData: jsonValue({
          name: '外部研发负责人',
          proposedEmail: `org-sync-${suffix}@example.test`,
          position: '研发负责人',
          mobile: '13800000000',
          isLeader: true,
        }),
        sort: 20,
        updatedAt: nowInstant(),
      })

      const notifications: Array<{ tenantId: string; userId: string; title: string }> = []
      const service = new OrganizationSyncApplyService(
        { client: prismaClient } as PrismaService,
        {
          notify: async (notifyTenantId: string, userId: string, message: { title: string }) => {
            notifications.push({ tenantId: notifyTenantId, userId, title: message.title })
          },
        } as unknown as NotificationsService,
      )
      const user = {
        id: actorId,
        tenantId: tenant.id,
        name: '同步操作人',
      } as AuthUser

      await service.apply(user, batch.id, 'WECOM')

      const appliedBatch = await prismaClient.orm.public.OrganizationSyncBatches.where({
        id: batch.id,
      }).first()
      assert.ok(appliedBatch)
      assert.equal(appliedBatch.status, 'SUCCEEDED')
      assert.equal(appliedBatch.appliedById, actorId)
      assert.ok(appliedBatch.applyStartedAt)
      assert.ok(appliedBatch.finishedAt)
      assert.equal(appliedBatch.errorCode, null)
      assert.equal(appliedBatch.errorMessage, null)

      const persistedDepartmentItem = await prismaClient.orm.public.OrganizationSyncItems.where({
        id: departmentItem.id,
      }).first()
      const persistedUserItem = await prismaClient.orm.public.OrganizationSyncItems.where({
        id: userItem.id,
      }).first()
      assert.ok(persistedDepartmentItem)
      assert.ok(persistedUserItem)
      assert.equal(persistedDepartmentItem.result, 'APPLIED')
      assert.equal(persistedUserItem.result, 'APPLIED')
      assert.ok(persistedDepartmentItem.localId)
      assert.ok(persistedUserItem.localId)

      const syncedDepartment = await prismaClient.orm.public.Departments.where({
        id: persistedDepartmentItem.localId,
      }).first()
      const syncedUser = await prismaClient.orm.public.Users.where({
        id: persistedUserItem.localId,
      }).first()
      assert.ok(syncedDepartment)
      assert.ok(syncedUser)
      assert.equal(syncedDepartment.name, '外部研发部')
      assert.equal(syncedDepartment.parentId, targetDepartment.id)
      assert.equal(syncedDepartment.sort, 88)
      assert.equal(syncedDepartment.leaderId, syncedUser.id)
      assert.equal(syncedUser.name, '外部研发负责人')
      assert.equal(syncedUser.status, 'ACTIVE')
      assert.equal(syncedUser.deptId, syncedDepartment.id)
      assert.equal(syncedUser.passwordLoginEnabled, false)
      assert.equal(syncedUser.position, '研发负责人')
      assert.equal(syncedUser.phone, '13800000000')

      const userRole = await prismaClient.orm.public.UserRoles.where({
        tenantId: tenant.id,
        userId: syncedUser.id,
        roleId: role.id,
      }).first()
      assert.ok(userRole)
      assert.equal(userRole.roleId, role.id)

      const departmentMapping = await prismaClient.orm.public.ExternalDepartmentMappings.where({
        tenantId: tenant.id,
        provider: 'WECOM',
        externalKey: departmentKey,
      }).first()
      assert.ok(departmentMapping)
      assert.equal(departmentMapping.departmentId, syncedDepartment.id)
      assert.equal(departmentMapping.active, true)
      assert.equal(departmentMapping.lastSeenBatchId, batch.id)

      const userMapping = await prismaClient.orm.public.ExternalUserMappings.where({
        tenantId: tenant.id,
        provider: 'WECOM',
        externalKey: `user-key-${suffix}`,
      }).first()
      assert.ok(userMapping)
      assert.equal(userMapping.userId, syncedUser.id)
      assert.equal(userMapping.active, true)
      assert.equal(userMapping.lastSeenBatchId, batch.id)

      const persistedIntegration = await prismaClient.orm.public.EnterpriseIntegrations.where({
        id: integration.id,
      }).first()
      assert.ok(persistedIntegration)
      assert.equal(persistedIntegration.lastSyncStatus, 'SUCCEEDED')
      assert.match(persistedIntegration.lastSyncMessage ?? '', /同步成功/)
      assert.ok(persistedIntegration.lastSyncedAt)
      assert.equal(persistedIntegration.updatedById, actorId)

      const persistedTenant = await prismaClient.orm.public.Tenants.where({
        id: tenant.id,
      }).first()
      assert.ok(persistedTenant)
      assert.equal(persistedTenant.enterpriseSynced, true)
      assert.deepEqual(notifications, [
        {
          tenantId: tenant.id,
          userId: actorId,
          title: '企业微信组织架构同步完成',
        },
      ])
    } finally {
      if (tenantId) await deleteOrganizationSyncFixture(prismaClient, tenantId)
      await testDb.close()
    }
  },
)

test(
  '组织同步 apply 失败时 Prisma 主事务回滚且失败审计独立持久化',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const actorId = `actor-fail-${suffix}`
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-org-sync-rollback')
      tenantId = tenant.id
      await prismaClient.orm.public.Tenants.where({ id: tenant.id }).update({
        enterpriseSyncResource: 'WECOM',
        updatedAt: nowInstant(),
      })
      const targetDepartment = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '本地根部门',
        sort: 1,
      })
      const role = await prismaClient.orm.public.Roles.select('id').create({
        tenantId: tenant.id,
        name: `失败测试默认角色-${suffix}`,
        updatedAt: nowInstant(),
      })
      const integration = await prismaClient.orm.public.EnterpriseIntegrations.select(
        'id',
        'credentialVersion',
      ).create({
        tenantId: tenant.id,
        provider: 'WECOM',
        corpId: `corp-fail-${suffix}`,
        agentId: '1000001',
        secretCiphertext: 'ciphertext',
        secretIv: 'iv',
        secretAuthTag: 'tag',
        credentialVersion: 3,
        syncEnabled: true,
        syncDefaultRoleId: role.id,
        lastTestSucceeded: true,
        createdById: actorId,
        updatedById: actorId,
        updatedAt: nowInstant(),
      })
      const batch = await prismaClient.orm.public.OrganizationSyncBatches.select('id').create({
        tenantId: tenant.id,
        integrationId: integration.id,
        provider: 'WECOM',
        status: 'PREVIEW_READY',
        targetDepartmentId: targetDepartment.id,
        credentialVersion: integration.credentialVersion,
        counts: jsonValue({ departments: 0, users: 1, conflicts: 0 }),
        createdById: actorId,
        previewedAt: instantFromDate(new Date()),
        updatedAt: nowInstant(),
      })
      const item = await prismaClient.orm.public.OrganizationSyncItems.select('id').create({
        tenantId: tenant.id,
        batchId: batch.id,
        resourceType: 'USER',
        externalId: `missing-dept-user-${suffix}`,
        externalKey: `missing-dept-user-key-${suffix}`,
        action: 'CREATE',
        parentExternalKey: `missing-department-${suffix}`,
        sourceData: jsonValue({
          name: '无法落库成员',
          proposedEmail: `rollback-${suffix}@example.test`,
        }),
        sort: 10,
        updatedAt: nowInstant(),
      })

      const service = new OrganizationSyncApplyService(
        { client: prismaClient } as PrismaService,
        { notify: async () => undefined } as unknown as NotificationsService,
      )
      const user = {
        id: actorId,
        tenantId: tenant.id,
        name: '失败测试操作人',
      } as AuthUser

      await assert.rejects(service.apply(user, batch.id, 'WECOM'), /同步成员的主部门不存在/)

      const failedBatch = await prismaClient.orm.public.OrganizationSyncBatches.where({
        id: batch.id,
      }).first()
      assert.ok(failedBatch)
      assert.equal(failedBatch.status, 'FAILED')
      assert.equal(failedBatch.errorCode, 'APPLY_FAILED')
      assert.match(failedBatch.errorMessage ?? '', /所有变更已回滚/)
      assert.ok(failedBatch.finishedAt)

      const rolledBackItem = await prismaClient.orm.public.OrganizationSyncItems.where({
        id: item.id,
      }).first()
      assert.ok(rolledBackItem)
      assert.equal(rolledBackItem.result, 'PENDING')
      assert.equal(rolledBackItem.localId, null)

      const failedIntegration = await prismaClient.orm.public.EnterpriseIntegrations.where({
        id: integration.id,
      }).first()
      assert.ok(failedIntegration)
      assert.equal(failedIntegration.lastSyncStatus, 'FAILED')
      assert.match(failedIntegration.lastSyncMessage ?? '', /所有变更已回滚/)

      const createdUser = await prismaClient.orm.public.Users.where({
        tenantId: tenant.id,
        email: `rollback-${suffix}@example.test`,
      }).first()
      assert.equal(createdUser, null)
      assert.equal(
        (
          await prismaClient.orm.public.ExternalUserMappings.where({ tenantId: tenant.id })
            .select('id')
            .all()
        ).length,
        0,
      )
      const persistedTenant = await prismaClient.orm.public.Tenants.where({
        id: tenant.id,
      }).first()
      assert.ok(persistedTenant)
      assert.equal(persistedTenant.enterpriseSynced, false)

      const log = await prismaClient.orm.public.OperationLogs.where({
        tenantId: tenant.id,
        module: 'organizationSync',
        action: 'applyWeComFailed',
        targetId: batch.id,
      }).first()
      assert.ok(log)
      const blob = await prismaClient.orm.public.OperationLogBlobs.where({
        operationLogId: log.id,
      }).first()
      assert.equal(log.userId, actorId)
      assert.deepEqual(blob?.detail, { errorCode: 'APPLY_FAILED' })
    } finally {
      if (tenantId) await deleteOrganizationSyncFixture(prismaClient, tenantId)
      await testDb.close()
    }
  },
)
