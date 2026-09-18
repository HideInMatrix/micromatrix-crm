import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { MessageTaskConfig } from '@micromatrix/shared'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { MessageSettingsService } from './message-settings.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'MessageSettings 使用 Prisma 8 持久化 JSON config、批量渠道设置与企业微信 gate',
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
        data: {
          name: `Prisma8 message settings ${suffix}`,
          slug: `p8-msg-${suffix}`,
          enterpriseSyncResource: 'WECOM',
        },
      })
      tenantId = tenant.id
      await fixtureDb.enterpriseIntegration.create({
        data: {
          tenantId: tenant.id,
          provider: 'WECOM',
          corpId: `corp-${suffix}`,
          agentId: `agent-${suffix}`,
          secretCiphertext: 'ciphertext',
          secretIv: 'iv',
          secretAuthTag: 'tag',
          syncEnabled: true,
          lastTestSucceeded: true,
          createdById: `creator-${suffix}`,
          updatedById: `creator-${suffix}`,
        },
      })

      const service = new MessageSettingsService({ client: prisma8Client } as Prisma8Service)
      const config: MessageTaskConfig = {
        timeList: [{ timeValue: 3, timeUnit: 'DAY' }],
        userIds: ['OWNER'],
        roleIds: [],
        ownerEnable: false,
        ownerLevel: 0,
        roleEnable: false,
      }

      const updated = await service.update(tenant.id, 'CONTRACT_EXPIRING', {
        module: 'CONTRACT',
        systemEnabled: false,
        config,
      })
      assert.equal(updated.systemEnabled, false)
      assert.deepEqual(updated.config, config)

      const stored = await fixtureDb.messageTaskSetting.findUniqueOrThrow({
        where: {
          tenantId_module_event: {
            tenantId: tenant.id,
            module: 'CONTRACT',
            event: 'CONTRACT_EXPIRING',
          },
        },
      })
      assert.equal(stored.systemEnabled, false)
      assert.deepEqual(stored.config, config)

      const gate = await service.getWeComChannelGate(tenant.id)
      assert.equal(gate.available, true)
      assert.equal(gate.enabled, true)

      const groups = await service.batchUpdate(tenant.id, { systemEnabled: true })
      assert.equal(groups.flatMap((group) => group.items).length, 47)
      assert.ok(groups.flatMap((group) => group.items).every((item) => item.systemEnabled))
      assert.equal(await fixtureDb.messageTaskSetting.count({ where: { tenantId: tenant.id } }), 47)
      assert.equal(
        await fixtureDb.messageTaskSetting.count({
          where: { tenantId: tenant.id, systemEnabled: true },
        }),
        47,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.messageTaskSetting.deleteMany({ where: { tenantId } })
        await fixtureDb.enterpriseIntegration.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
