import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { NotificationsService } from '../notifications/notifications.service'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '组织同步 apply 由 Prisma 8 transaction 持有 advisory lock 与部门/成员/mapping/batch 收口',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const actorId = `actor-${suffix}`

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: {
          name: `Prisma8 organization sync ${suffix}`,
          slug: `p8-org-sync-${suffix}`,
          enterpriseSyncResource: 'WECOM',
        },
      })
      const targetDepartment = await fixtureDb.department.create({
        data: {
          tenantId: tenant.id,
          name: '本地同步根部门',
          sort: 1,
        },
      })
      const role = await fixtureDb.role.create({
        data: {
          tenantId: tenant.id,
          name: `外部成员默认角色-${suffix}`,
        },
      })
      const integration = await fixtureDb.enterpriseIntegration.create({
        data: {
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
        },
      })
      const batch = await fixtureDb.organizationSyncBatch.create({
        data: {
          tenantId: tenant.id,
          integrationId: integration.id,
          provider: 'WECOM',
          status: 'PREVIEW_READY',
          targetDepartmentId: targetDepartment.id,
          credentialVersion: integration.credentialVersion,
          counts: { departments: 1, users: 1, conflicts: 0 },
          createdById: actorId,
          previewedAt: new Date(),
        },
      })
      const departmentKey = `dept-key-${suffix}`
      const departmentItem = await fixtureDb.organizationSyncItem.create({
        data: {
          tenantId: tenant.id,
          batchId: batch.id,
          resourceType: 'DEPARTMENT',
          externalId: `dept-external-${suffix}`,
          externalKey: departmentKey,
          action: 'CREATE',
          sourceData: { name: '外部研发部', order: 88 },
          sort: 10,
        },
      })
      const userItem = await fixtureDb.organizationSyncItem.create({
        data: {
          tenantId: tenant.id,
          batchId: batch.id,
          resourceType: 'USER',
          externalId: `user-external-${suffix}`,
          externalKey: `user-key-${suffix}`,
          action: 'CREATE',
          parentExternalKey: departmentKey,
          sourceData: {
            name: '外部研发负责人',
            proposedEmail: `org-sync-${suffix}@example.test`,
            position: '研发负责人',
            mobile: '13800000000',
            isLeader: true,
          },
          sort: 20,
        },
      })

      const notifications: Array<{ tenantId: string; userId: string; title: string }> = []
      const service = new OrganizationSyncApplyService(
        { client: prisma8Client } as Prisma8Service,
        {
          notify: async (
            notifyTenantId: string,
            userId: string,
            message: { title: string },
          ) => {
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

      const appliedBatch = await fixtureDb.organizationSyncBatch.findUniqueOrThrow({
        where: { id: batch.id },
      })
      assert.equal(appliedBatch.status, 'SUCCEEDED')
      assert.equal(appliedBatch.appliedById, actorId)
      assert.ok(appliedBatch.applyStartedAt instanceof Date)
      assert.ok(appliedBatch.finishedAt instanceof Date)
      assert.equal(appliedBatch.errorCode, null)
      assert.equal(appliedBatch.errorMessage, null)

      const persistedDepartmentItem = await fixtureDb.organizationSyncItem.findUniqueOrThrow({
        where: { id: departmentItem.id },
      })
      const persistedUserItem = await fixtureDb.organizationSyncItem.findUniqueOrThrow({
        where: { id: userItem.id },
      })
      assert.equal(persistedDepartmentItem.result, 'APPLIED')
      assert.equal(persistedUserItem.result, 'APPLIED')
      assert.ok(persistedDepartmentItem.localId)
      assert.ok(persistedUserItem.localId)

      const syncedDepartment = await fixtureDb.department.findUniqueOrThrow({
        where: { id: persistedDepartmentItem.localId! },
      })
      const syncedUser = await fixtureDb.user.findUniqueOrThrow({
        where: { id: persistedUserItem.localId! },
      })
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

      const userRole = await fixtureDb.userRole.findFirstOrThrow({
        where: { tenantId: tenant.id, userId: syncedUser.id, roleId: role.id },
      })
      assert.equal(userRole.roleId, role.id)

      const departmentMapping = await fixtureDb.externalDepartmentMapping.findFirstOrThrow({
        where: { tenantId: tenant.id, provider: 'WECOM', externalKey: departmentKey },
      })
      assert.equal(departmentMapping.departmentId, syncedDepartment.id)
      assert.equal(departmentMapping.active, true)
      assert.equal(departmentMapping.lastSeenBatchId, batch.id)

      const userMapping = await fixtureDb.externalUserMapping.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          provider: 'WECOM',
          externalKey: `user-key-${suffix}`,
        },
      })
      assert.equal(userMapping.userId, syncedUser.id)
      assert.equal(userMapping.active, true)
      assert.equal(userMapping.lastSeenBatchId, batch.id)

      const persistedIntegration = await fixtureDb.enterpriseIntegration.findUniqueOrThrow({
        where: { id: integration.id },
      })
      assert.equal(persistedIntegration.lastSyncStatus, 'SUCCEEDED')
      assert.match(persistedIntegration.lastSyncMessage ?? '', /同步成功/)
      assert.ok(persistedIntegration.lastSyncedAt instanceof Date)
      assert.equal(persistedIntegration.updatedById, actorId)

      const persistedTenant = await fixtureDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } })
      assert.equal(persistedTenant.enterpriseSynced, true)
      assert.equal(notifications.length, 1)
      assert.deepEqual(notifications[0], {
        tenantId: tenant.id,
        userId: actorId,
        title: '企业微信组织架构同步完成',
      })
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-org-sync-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.externalUserMapping.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.externalDepartmentMapping.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.organizationSyncItem.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.organizationSyncBatch.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.userRole.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.department.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.enterpriseIntegration.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.role.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)

test(
  '组织同步 apply 失败时 Prisma 8 主事务回滚且失败审计独立持久化',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const actorId = `actor-fail-${suffix}`

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: {
          name: `Prisma8 organization sync rollback ${suffix}`,
          slug: `p8-org-sync-rollback-${suffix}`,
          enterpriseSyncResource: 'WECOM',
        },
      })
      const targetDepartment = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '本地根部门', sort: 1 },
      })
      const role = await fixtureDb.role.create({
        data: { tenantId: tenant.id, name: `失败测试默认角色-${suffix}` },
      })
      const integration = await fixtureDb.enterpriseIntegration.create({
        data: {
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
        },
      })
      const batch = await fixtureDb.organizationSyncBatch.create({
        data: {
          tenantId: tenant.id,
          integrationId: integration.id,
          provider: 'WECOM',
          status: 'PREVIEW_READY',
          targetDepartmentId: targetDepartment.id,
          credentialVersion: integration.credentialVersion,
          counts: { departments: 0, users: 1, conflicts: 0 },
          createdById: actorId,
          previewedAt: new Date(),
        },
      })
      const item = await fixtureDb.organizationSyncItem.create({
        data: {
          tenantId: tenant.id,
          batchId: batch.id,
          resourceType: 'USER',
          externalId: `missing-dept-user-${suffix}`,
          externalKey: `missing-dept-user-key-${suffix}`,
          action: 'CREATE',
          parentExternalKey: `missing-department-${suffix}`,
          sourceData: {
            name: '无法落库成员',
            proposedEmail: `rollback-${suffix}@example.test`,
          },
          sort: 10,
        },
      })

      const service = new OrganizationSyncApplyService(
        { client: prisma8Client } as Prisma8Service,
        { notify: async () => undefined } as unknown as NotificationsService,
      )
      const user = {
        id: actorId,
        tenantId: tenant.id,
        name: '失败测试操作人',
      } as AuthUser

      await assert.rejects(
        service.apply(user, batch.id, 'WECOM'),
        /同步成员的主部门不存在/,
      )

      const failedBatch = await fixtureDb.organizationSyncBatch.findUniqueOrThrow({
        where: { id: batch.id },
      })
      assert.equal(failedBatch.status, 'FAILED')
      assert.equal(failedBatch.errorCode, 'APPLY_FAILED')
      assert.match(failedBatch.errorMessage ?? '', /所有变更已回滚/)
      assert.ok(failedBatch.finishedAt instanceof Date)

      const rolledBackItem = await fixtureDb.organizationSyncItem.findUniqueOrThrow({
        where: { id: item.id },
      })
      assert.equal(rolledBackItem.result, 'PENDING')
      assert.equal(rolledBackItem.localId, null)

      const failedIntegration = await fixtureDb.enterpriseIntegration.findUniqueOrThrow({
        where: { id: integration.id },
      })
      assert.equal(failedIntegration.lastSyncStatus, 'FAILED')
      assert.match(failedIntegration.lastSyncMessage ?? '', /所有变更已回滚/)

      const createdUser = await fixtureDb.user.findFirst({
        where: { tenantId: tenant.id, email: `rollback-${suffix}@example.test` },
      })
      assert.equal(createdUser, null)
      assert.equal(
        await fixtureDb.externalUserMapping.count({ where: { tenantId: tenant.id } }),
        0,
      )
      const persistedTenant = await fixtureDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } })
      assert.equal(persistedTenant.enterpriseSynced, false)

      const log = await fixtureDb.operationLog.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          module: 'organizationSync',
          action: 'applyWeComFailed',
          targetId: batch.id,
        },
        include: { blob: true },
      })
      assert.equal(log.userId, actorId)
      assert.deepEqual(log.blob?.detail, { errorCode: 'APPLY_FAILED' })
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-org-sync-rollback-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.operationLog.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.externalUserMapping.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.externalDepartmentMapping.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.organizationSyncItem.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.organizationSyncBatch.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.userRole.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.department.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.enterpriseIntegration.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.role.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
