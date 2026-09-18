import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { EnterpriseGlobalTasksService } from './enterprise-global-tasks.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'EnterpriseGlobalTasks 使用 Prisma 8 保持任务 CRUD 与 execution JSON/Temporal 状态机',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-task')
      tenantId = tenant.id
      const model = await prisma8Client.orm.public.EnterpriseAiModels
        .select('id', 'displayName', 'modelName', 'provider')
        .create({
          tenantId: tenant.id,
          displayName: `模型-${suffix}`,
          modelName: 'gpt-test',
          provider: 'OPENAI_COMPATIBLE',
          apiUrl: 'https://example.com/v1',
          enable: true,
          createdById: `creator-${suffix}`,
          updatedById: `creator-${suffix}`,
          updatedAt: prisma8Now(),
      })
      const user = {
        id: `user-${suffix}`,
        tenantId: tenant.id,
      } as AuthUser
      const service = new EnterpriseGlobalTasksService(
        { client: prisma8Client } as Prisma8Service,
        {
          complete: async () => ({
            text: '分析完成',
            modelId: model.id,
            modelName: model.modelName,
            displayName: model.displayName,
            provider: model.provider,
            latencyMs: 12,
          }),
        } as never,
      )

      const created = await service.create(user, {
        name: '每日商机巡检',
        triggerType: 'manual',
        executionCondition: '检查停滞商机',
        executionAction: '给出跟进建议',
        confirmationLevel: 'only_analysis',
        applicableModelId: model.id,
        enable: true,
      })
      assert.equal(created.applicableModelName, model.displayName)
      assert.equal((await service.list(tenant.id, '商机')).length, 1)

      const execution = await service.execute(user, created.id)
      assert.equal(execution.status, 'SUCCEEDED')
      assert.equal((execution.input as { taskName: string }).taskName, '每日商机巡检')
      assert.equal((execution.output as { analysis: string }).analysis, '分析完成')
      assert.ok(execution.startedAt)
      assert.ok(execution.finishedAt)

      const stored = await prisma8Client.orm.public.EnterpriseGlobalTaskExecutions.where({
        id: execution.id,
      }).first()
      assert.ok(stored)
      assert.equal(stored.status, 'SUCCEEDED')
      assert.equal((stored.input as { taskName: string }).taskName, '每日商机巡检')
      assert.equal((stored.output as { analysis: string }).analysis, '分析完成')
      assert.ok(stored.startedAt)
      assert.ok(stored.finishedAt)

      const history = await service.executions(tenant.id, created.id)
      assert.equal(history.length, 1)
      assert.equal(history[0]?.taskName, '每日商机巡检')
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.EnterpriseGlobalTaskExecutions.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.EnterpriseGlobalTasks.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.EnterpriseAiModels.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
