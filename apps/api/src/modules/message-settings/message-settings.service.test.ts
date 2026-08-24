import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { MessageTaskConfig } from '@micromatrix/shared'
import type { MessageTaskSetting } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { MessageSettingsService } from './message-settings.service'

function createService() {
  const rows: MessageTaskSetting[] = []
  const find = (tenantId: string, module: string, event: string) =>
    rows.find((row) => row.tenantId === tenantId && row.module === module && row.event === event)
  const messageTaskSetting = {
    findMany: async ({ where }: { where: { tenantId: string } }) =>
      rows.filter((row) => row.tenantId === where.tenantId),
    findFirst: async ({ where }: { where: { tenantId: string; module: string; event: string } }) =>
      find(where.tenantId, where.module, where.event) ?? null,
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { tenantId_module_event: { tenantId: string; module: string; event: string } }
      update: Partial<MessageTaskSetting>
      create: Omit<MessageTaskSetting, 'id' | 'createdAt' | 'updatedAt'>
    }) => {
      const key = where.tenantId_module_event
      const existing = find(key.tenantId, key.module, key.event)
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() })
        return existing
      }
      const row: MessageTaskSetting = {
        id: `setting-${rows.length + 1}`,
        tenantId: create.tenantId,
        module: create.module,
        event: create.event,
        systemEnabled: create.systemEnabled ?? true,
        emailEnabled: create.emailEnabled ?? false,
        config: create.config ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      rows.push(row)
      return row
    },
  }
  const prisma = {
    messageTaskSetting,
    user: { count: async () => 0 },
    role: { count: async () => 0 },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService
  return { service: new MessageSettingsService(prisma), rows }
}

test('完整返回 Cordys 五组 35 个事件并合并默认开关', async () => {
  const { service } = createService()

  const groups = await service.list('tenant-a')

  assert.equal(groups.length, 5)
  assert.equal(groups.flatMap((group) => group.items).length, 35)
  assert.ok(groups.flatMap((group) => group.items).every((item) => item.systemEnabled))
  assert.ok(groups.flatMap((group) => group.items).every((item) => !item.emailEnabled))
})

test('单项与批量开关按租户持久化', async () => {
  const { service } = createService()

  await service.update('tenant-a', 'CUSTOMER_ADD', {
    module: 'CUSTOMER',
    systemEnabled: false,
  })
  assert.equal(await service.isSystemEnabled('tenant-a', 'CUSTOMER_ADD'), false)
  assert.equal(await service.isSystemEnabled('tenant-b', 'CUSTOMER_ADD'), true)

  const groups = await service.batchUpdate('tenant-a', { systemEnabled: true })
  assert.ok(groups.flatMap((group) => group.items).every((item) => item.systemEnabled))
})

test('到期配置校验模块、时间重复和固定负责人', async () => {
  const { service } = createService()
  const config: MessageTaskConfig = {
    timeList: [{ timeValue: 3, timeUnit: 'DAY' }],
    userIds: ['OWNER'],
    roleIds: [],
    ownerEnable: false,
    ownerLevel: 0,
    roleEnable: false,
  }

  await service.update('tenant-a', 'CONTRACT_EXPIRING', { module: 'CONTRACT', config })
  assert.deepEqual(await service.getConfig('tenant-a', 'CONTRACT_EXPIRING'), config)

  await assert.rejects(
    () =>
      service.update('tenant-a', 'CONTRACT_EXPIRING', {
        module: 'CUSTOMER',
        config,
      }),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.update('tenant-a', 'CONTRACT_EXPIRING', {
        module: 'CONTRACT',
        config: {
          ...config,
          timeList: [
            { timeValue: 3, timeUnit: 'DAY' },
            { timeValue: 3, timeUnit: 'DAY' },
          ],
        },
      }),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.update('tenant-a', 'CONTRACT_EXPIRING', {
        module: 'CONTRACT',
        config: { ...config, userIds: [] },
      }),
    BadRequestException,
  )
})

test('配置接收范围合并负责人、成员、角色和部门负责人层级', async () => {
  const config: MessageTaskConfig = {
    timeList: [{ timeValue: 3, timeUnit: 'DAY' }],
    userIds: ['OWNER', 'member-a'],
    roleIds: ['role-a'],
    ownerEnable: true,
    ownerLevel: 2,
    roleEnable: true,
  }
  const activeIds = new Set(['owner-a', 'member-a', 'role-member', 'leader-a', 'leader-root'])
  const prisma = {
    messageTaskSetting: {
      findFirst: async () => ({
        systemEnabled: true,
        emailEnabled: false,
        config,
      }),
    },
    userRole: { findMany: async () => [{ userId: 'role-member' }] },
    user: {
      findFirst: async () => ({ deptId: 'dept-a' }),
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => activeIds.has(id)).map((id) => ({ id })),
    },
    department: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === 'dept-a'
          ? { leaderId: 'leader-a', parentId: 'dept-root' }
          : { leaderId: 'leader-root', parentId: null },
    },
  } as unknown as PrismaService
  const service = new MessageSettingsService(prisma)

  const recipients = await service.resolveRecipients('tenant-a', 'CONTRACT_EXPIRING', {
    ownerId: 'owner-a',
  })

  assert.deepEqual(new Set(recipients), activeIds)
})
