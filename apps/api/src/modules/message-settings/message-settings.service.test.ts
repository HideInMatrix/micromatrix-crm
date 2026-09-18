import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { MessageTaskConfig } from '@micromatrix/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { MessageSettingsService } from './message-settings.service'

interface TestMessageTaskSetting {
  id: string
  tenantId: string
  module: string
  event: string
  systemEnabled: boolean
  emailEnabled: boolean
  weComEnabled: boolean
  dingTalkEnabled: boolean
  larkEnabled: boolean
  config: unknown
}

function createService() {
  const rows: TestMessageTaskSetting[] = []
  let activeProvider: 'WECOM' | 'DINGTALK' | 'LARK' = 'WECOM'
  let integration: { lastTestSucceeded: boolean; syncEnabled: boolean } | null = {
    lastTestSucceeded: true,
    syncEnabled: true,
  }
  const messageSettingsCollection = (criteria: Record<string, unknown> = {}) => ({
    where(next: Record<string, unknown> | ((row: unknown) => unknown)) {
      return typeof next === 'function'
        ? messageSettingsCollection(criteria)
        : messageSettingsCollection({ ...criteria, ...next })
    },
    select() {
      return messageSettingsCollection(criteria)
    },
    async all() {
      return rows.filter((row) =>
        Object.entries(criteria).every(
          ([key, value]) => row[key as keyof TestMessageTaskSetting] === value,
        ),
      )
    },
    async first() {
      return (
        rows.find((row) =>
          Object.entries(criteria).every(
            ([key, value]) => row[key as keyof TestMessageTaskSetting] === value,
          ),
        ) ?? null
      )
    },
    async update(data: Partial<TestMessageTaskSetting>) {
      const row = rows.find((candidate) =>
        Object.entries(criteria).every(
          ([key, value]) => candidate[key as keyof TestMessageTaskSetting] === value,
        ),
      )
      if (!row) return null
      Object.assign(row, data)
      return row
    },
    async create(data: Omit<TestMessageTaskSetting, 'id'>) {
      const row: TestMessageTaskSetting = { id: `setting-${rows.length + 1}`, ...data }
      rows.push(row)
      return row
    },
  })

  const orm = {
    public: {
      MessageTaskSettings: messageSettingsCollection(),
      EnterpriseIntegrations: {
        where: () => ({ first: async () => integration }),
      },
      Tenants: {
        where: () => ({
          select: () => ({ first: async () => ({ enterpriseSyncResource: activeProvider }) }),
        }),
      },
      UserRoles: {
        where: () => ({ where: () => ({ select: () => ({ all: async () => [] }) }) }),
      },
      Users: {
        where: () => ({
          where: () => ({ select: () => ({ all: async () => [] }) }),
          select: () => ({ first: async () => null }),
        }),
      },
      Departments: {
        where: () => ({ select: () => ({ first: async () => null }) }),
      },
      Roles: {
        where: () => ({ where: () => ({ select: () => ({ all: async () => [] }) }) }),
      },
    },
  }
  const prisma = {
    client: {
      orm,
      transaction: async (callback: (tx: { orm: typeof orm }) => Promise<unknown>) =>
        callback({ orm }),
    },
  } as unknown as PrismaService
  return {
    service: new MessageSettingsService(prisma),
    rows,
    setActiveProvider: (provider: 'WECOM' | 'DINGTALK' | 'LARK') => {
      activeProvider = provider
    },
    setIntegration: (value: typeof integration) => {
      integration = value
    },
  }
}

test('完整返回当前 Cordys 事件目录并合并默认开关', async () => {
  const { service } = createService()

  const groups = await service.list('tenant-a')

  assert.equal(groups.length, 5)
  const items = groups.flatMap((group) => group.items)
  assert.equal(items.length, 47)
  assert.ok(items.some((item) => item.event === 'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED'))
  assert.ok(items.some((item) => item.event === 'CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED'))
  assert.ok(items.some((item) => item.event === 'OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED'))
  assert.ok(items.some((item) => item.event === 'CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED'))
  assert.ok(items.some((item) => item.event === 'CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED'))
  assert.ok(items.some((item) => item.event === 'OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_ADDED'))
  assert.ok(items.every((item) => item.systemEnabled))
  assert.ok(items.every((item) => !item.emailEnabled))
  assert.ok(items.every((item) => !item.weComEnabled))
  assert.ok(items.every((item) => !item.dingTalkEnabled))
  assert.ok(items.every((item) => !item.larkEnabled))
})

test('单项与批量开关按租户持久化', async () => {
  const { service, setActiveProvider } = createService()

  await service.update('tenant-a', 'CUSTOMER_ADD', {
    module: 'CUSTOMER',
    systemEnabled: false,
  })
  assert.equal(await service.isSystemEnabled('tenant-a', 'CUSTOMER_ADD'), false)
  assert.equal(await service.isSystemEnabled('tenant-b', 'CUSTOMER_ADD'), true)

  await service.update('tenant-a', 'CUSTOMER_ADD', {
    module: 'CUSTOMER',
    weComEnabled: true,
  })
  assert.equal(await service.isWeComEnabled('tenant-a', 'CUSTOMER_ADD'), true)

  setActiveProvider('LARK')
  await service.update('tenant-a', 'CUSTOMER_ADD', {
    module: 'CUSTOMER',
    larkEnabled: true,
  })
  assert.equal(await service.isLarkEnabled('tenant-a', 'CUSTOMER_ADD'), true)

  const groups = await service.batchUpdate('tenant-a', { systemEnabled: true })
  assert.ok(groups.flatMap((group) => group.items).every((item) => item.systemEnabled))
})

test('企业微信开关由配置、连接测试和同步开关共同控制', async () => {
  const { service, setIntegration } = createService()
  setIntegration(null)

  assert.equal((await service.getWeComChannelGate('tenant-a')).reason, '请先配置企业微信')
  setIntegration({ lastTestSucceeded: false, syncEnabled: false })
  assert.equal((await service.getWeComChannelGate('tenant-a')).available, false)
  setIntegration({ lastTestSucceeded: true, syncEnabled: false })
  assert.equal((await service.getWeComChannelGate('tenant-a')).reason, '请先开启企业微信组织同步')
  setIntegration({ lastTestSucceeded: true, syncEnabled: true })
  assert.equal((await service.getWeComChannelGate('tenant-a')).available, true)
})

test('飞书开关由配置、连接测试和同步开关共同控制', async () => {
  const { service, setIntegration, setActiveProvider } = createService()
  setActiveProvider('LARK')
  setIntegration(null)

  assert.equal((await service.getLarkChannelGate('tenant-a')).reason, '请先配置飞书')
  setIntegration({ lastTestSucceeded: false, syncEnabled: false })
  assert.equal((await service.getLarkChannelGate('tenant-a')).available, false)
  setIntegration({ lastTestSucceeded: true, syncEnabled: false })
  assert.equal((await service.getLarkChannelGate('tenant-a')).reason, '请先开启飞书组织同步')
  setIntegration({ lastTestSucceeded: true, syncEnabled: true })
  assert.equal((await service.getLarkChannelGate('tenant-a')).available, true)
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
  let departmentReads = 0
  const orm = {
    public: {
      MessageTaskSettings: {
        where: () => ({
          first: async () => ({
            systemEnabled: true,
            emailEnabled: false,
            weComEnabled: false,
            dingTalkEnabled: false,
            larkEnabled: false,
            config,
          }),
        }),
      },
      UserRoles: {
        where: () => ({
          where: () => ({ select: () => ({ all: async () => [{ userId: 'role-member' }] }) }),
        }),
      },
      Users: {
        where: () => ({
          select: () => ({ first: async () => ({ deptId: 'dept-a' }) }),
          where: () => ({
            select: () => ({ all: async () => [...activeIds].map((id) => ({ id })) }),
          }),
        }),
      },
      Departments: {
        where: () => ({
          select: () => ({
            first: async () =>
              departmentReads++ === 0
                ? { leaderId: 'leader-a', parentId: 'dept-root' }
                : { leaderId: 'leader-root', parentId: null },
          }),
        }),
      },
    },
  }
  const service = new MessageSettingsService({ client: { orm } } as unknown as PrismaService)

  const recipients = await service.resolveRecipients('tenant-a', 'CONTRACT_EXPIRING', {
    ownerId: 'owner-a',
  })

  assert.deepEqual(new Set(recipients), activeIds)
})
