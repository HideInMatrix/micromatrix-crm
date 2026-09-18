import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { MessageTaskConfig } from '@micromatrix/shared'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { MessageSettingsService } from './message-settings.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'MessageSettings 使用 Prisma 8 持久化 JSON config、批量渠道设置与企业微信 gate',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-msg')
      tenantId = tenant.id
      await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).update({
        enterpriseSyncResource: 'WECOM',
        updatedAt: prisma8Now(),
      })
      await prisma8Client.orm.public.EnterpriseIntegrations.create({
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
        updatedAt: prisma8Now(),
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

      const stored = await prisma8Client.orm.public.MessageTaskSettings.where({
        tenantId: tenant.id,
        module: 'CONTRACT',
        event: 'CONTRACT_EXPIRING',
      })
        .select('systemEnabled', 'config')
        .first()
      assert.ok(stored)
      assert.equal(stored.systemEnabled, false)
      assert.deepEqual(stored.config, config)

      const gate = await service.getWeComChannelGate(tenant.id)
      assert.equal(gate.available, true)
      assert.equal(gate.enabled, true)

      const groups = await service.batchUpdate(tenant.id, { systemEnabled: true })
      assert.equal(groups.flatMap((group) => group.items).length, 47)
      assert.ok(groups.flatMap((group) => group.items).every((item) => item.systemEnabled))
      const allRows = await prisma8Client.orm.public.MessageTaskSettings.where({ tenantId: tenant.id })
        .select('systemEnabled')
        .all()
      assert.equal(allRows.length, 47)
      assert.equal(allRows.filter((item) => item.systemEnabled).length, 47)
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.MessageTaskSettings.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.EnterpriseIntegrations.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
