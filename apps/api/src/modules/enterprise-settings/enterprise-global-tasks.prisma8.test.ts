import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { EnterpriseGlobalTasksService } from './enterprise-global-tasks.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'EnterpriseGlobalTasks 使用 Prisma 8 保持任务 CRUD 与 execution JSON/Temporal 状态机',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 global task ${suffix}`, slug: `p8-task-${suffix}` },
      })
      tenantId = tenant.id
      const model = await fixtureDb.enterpriseAiModel.create({
        data: {
          tenantId: tenant.id,
          displayName: `模型-${suffix}`,
          modelName: 'gpt-test',
          provider: 'OPENAI_COMPATIBLE',
          apiUrl: 'https://example.com/v1',
          enable: true,
          createdById: `creator-${suffix}`,
          updatedById: `creator-${suffix}`,
        },
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

      const stored = await fixtureDb.enterpriseGlobalTaskExecution.findUniqueOrThrow({
        where: { id: execution.id },
      })
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
        await fixtureDb.enterpriseGlobalTaskExecution.deleteMany({ where: { tenantId } })
        await fixtureDb.enterpriseGlobalTask.deleteMany({ where: { tenantId } })
        await fixtureDb.enterpriseAiModel.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
