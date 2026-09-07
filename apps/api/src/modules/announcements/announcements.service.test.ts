import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import type { NotificationsService } from '../notifications/notifications.service'
import { AnnouncementsService } from './announcements.service'

type Row = {
  id: string
  tenantId: string
  subject: string
  content: string
  startAt: Date
  endAt: Date
  url: string | null
  linkName: string | null
  departmentIds: string[]
  userIds: string[]
  receiverUserIds: string[]
  notice: boolean
  createUserId: string
  updateUserId: string
  createdAt: Date
  updatedAt: Date
}

type AnnouncementWhere = {
  id?: string
  tenantId?: string
  notice?: boolean
  startAt?: { lte?: Date }
  endAt?: { gte?: Date }
  subject?: { contains?: string }
}

type ScopedIdWhere = {
  tenantId?: string
  id?: { in?: string[] }
  status?: string
  deptId?: { in?: string[] }
}

const actor: AuthUser = {
  id: 'admin',
  tenantId: 'tenant-a',
  email: 'admin@example.com',
  name: '管理员',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: ['system:message', 'system:message:update'],
}

function createFixture() {
  const rows: Row[] = []
  const dispatches: Array<{ sourceId: string; userIds: string[]; title: string }> = []
  const removals: string[] = []
  let sequence = 0
  const departments = [
    { id: 'root', tenantId: 'tenant-a', name: '总部', parentId: null },
    { id: 'sales', tenantId: 'tenant-a', name: '销售部', parentId: 'root' },
    { id: 'other', tenantId: 'tenant-b', name: '其它租户', parentId: null },
  ]
  const users = [
    { id: 'admin', tenantId: 'tenant-a', name: '管理员', deptId: null, status: 'ACTIVE' },
    { id: 'sales-user', tenantId: 'tenant-a', name: '销售成员', deptId: 'sales', status: 'ACTIVE' },
    { id: 'direct-user', tenantId: 'tenant-a', name: '直属成员', deptId: null, status: 'ACTIVE' },
    {
      id: 'disabled-user',
      tenantId: 'tenant-a',
      name: '停用成员',
      deptId: 'sales',
      status: 'DISABLED',
    },
    {
      id: 'foreign-user',
      tenantId: 'tenant-b',
      name: '跨租户成员',
      deptId: 'other',
      status: 'ACTIVE',
    },
  ]

  const matches = (row: Row, where: AnnouncementWhere) => {
    if (where?.id && row.id !== where.id) return false
    if (where?.tenantId && row.tenantId !== where.tenantId) return false
    if (where?.notice !== undefined && row.notice !== where.notice) return false
    if (where?.startAt?.lte && row.startAt > where.startAt.lte) return false
    if (where?.endAt?.gte && row.endAt < where.endAt.gte) return false
    const contains = where?.subject?.contains
    if (contains && !row.subject.toLowerCase().includes(String(contains).toLowerCase()))
      return false
    return true
  }

  const prisma = {
    announcement: {
      create: async ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const row: Row = {
          ...data,
          id: `announcement-${++sequence}`,
          departmentIds: [...data.departmentIds],
          userIds: [...data.userIds],
          receiverUserIds: [...data.receiverUserIds],
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        rows.push(row)
        return { ...row }
      },
      findFirst: async ({ where }: { where: AnnouncementWhere }) =>
        rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({
        where,
        skip = 0,
        take = rows.length,
      }: {
        where: AnnouncementWhere
        skip?: number
        take?: number
      }) =>
        rows
          .filter((row) => matches(row, where))
          .slice(skip, skip + take)
          .map((row) => ({ ...row })),
      count: async ({ where }: { where: AnnouncementWhere }) =>
        rows.filter((row) => matches(row, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((item) => item.id === where.id)!
        Object.assign(row, data, { updatedAt: new Date() })
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: AnnouncementWhere; data: Partial<Row> }) => {
        const targets = rows.filter((row) => matches(row, where))
        targets.forEach((row) => Object.assign(row, data, { updatedAt: new Date() }))
        return { count: targets.length }
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((row) => row.id === where.id)
        return rows.splice(index, 1)[0]
      },
    },
    department: {
      findMany: async ({ where }: { where: ScopedIdWhere }) =>
        departments
          .filter(
            (item) =>
              item.tenantId === where.tenantId && (!where.id?.in || where.id.in.includes(item.id)),
          )
          .map(({ tenantId: _tenantId, ...item }) => item),
    },
    user: {
      findMany: async ({ where }: { where: ScopedIdWhere }) =>
        users
          .filter((item) => {
            if (item.tenantId !== where.tenantId) return false
            if (where.status && item.status !== where.status) return false
            if (where.id?.in && !where.id.in.includes(item.id)) return false
            if (where.deptId?.in && (!item.deptId || !where.deptId.in.includes(item.deptId)))
              return false
            return true
          })
          .map(({ tenantId: _tenantId, status: _status, ...item }) => item),
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService

  const notifications = {
    notifyManyFromSource: async (
      _tenantId: string,
      userIds: string[],
      _sourceType: string,
      sourceId: string,
      input: { title: string },
    ) => {
      dispatches.push({ sourceId, userIds: [...userIds], title: input.title })
      return userIds.length
    },
    removeBySource: async (_tenantId: string, _sourceType: string, sourceId: string) => {
      removals.push(sourceId)
      return 1
    },
  } as unknown as NotificationsService

  return {
    service: new AnnouncementsService(prisma, notifications),
    rows,
    dispatches,
    removals,
  }
}

function input(startAt: Date, endAt: Date, overrides: Record<string, unknown> = {}) {
  return {
    subject: '系统升级通知',
    content: '今晚进行系统升级，请提前保存工作。',
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    url: 'https://example.com/release-notes',
    linkName: '查看升级说明',
    departmentIds: ['root'],
    userIds: ['direct-user'],
    ...overrides,
  }
}

test('当前生效公告递归展开子部门并冻结接收成员，立即转 Notification', async () => {
  const { service, rows, dispatches } = createFixture()
  const now = Date.now()
  const result = await service.create(
    actor,
    input(new Date(now - 60_000), new Date(now + 60 * 60_000)),
  )

  assert.equal(result.notice, true)
  assert.deepEqual(new Set(rows[0]!.receiverUserIds), new Set(['sales-user', 'direct-user']))
  assert.equal(dispatches.length, 1)
  assert.deepEqual(new Set(dispatches[0]!.userIds), new Set(['sales-user', 'direct-user']))
})

test('未来公告先保持未转换，进入生效区间后由调度发布', async () => {
  const { service, rows, dispatches } = createFixture()
  const now = Date.now()
  const start = new Date(now + 10 * 60_000)
  const end = new Date(now + 60 * 60_000)
  const result = await service.create(actor, input(start, end))

  assert.equal(result.notice, false)
  assert.equal(dispatches.length, 0)
  assert.equal(await service.publishDueAnnouncements(new Date(now + 15 * 60_000)), 1)
  assert.equal(rows[0]!.notice, true)
  assert.equal(dispatches.length, 1)
})

test('编辑公告先删除旧 source 通知，再按新范围生成未读通知', async () => {
  const { service, dispatches, removals } = createFixture()
  const now = Date.now()
  const created = await service.create(
    actor,
    input(new Date(now - 60_000), new Date(now + 60 * 60_000)),
  )
  dispatches.length = 0

  const updated = await service.update(
    actor,
    created.id,
    input(new Date(now - 30_000), new Date(now + 2 * 60 * 60_000), {
      subject: '更新后的公告',
      departmentIds: [],
      userIds: ['direct-user'],
    }),
  )

  assert.equal(updated.subject, '更新后的公告')
  assert.deepEqual(removals, [created.id])
  assert.deepEqual(dispatches[0]!.userIds, ['direct-user'])
})

test('删除公告精确清理 source 通知且跨租户 ID fail-closed', async () => {
  const { service, rows, removals } = createFixture()
  const now = Date.now()
  const created = await service.create(
    actor,
    input(new Date(now + 10 * 60_000), new Date(now + 60 * 60_000)),
  )

  await assert.rejects(() => service.detail('tenant-b', created.id), /公告不存在/)
  await service.remove('tenant-a', created.id)
  assert.equal(rows.length, 0)
  assert.deepEqual(removals, [created.id])
})

test('无效/跨租户/停用接收对象被拒绝，公告链接拒绝非 http(s)', async () => {
  const { service } = createFixture()
  const now = Date.now()
  const start = new Date(now + 60_000)
  const end = new Date(now + 60 * 60_000)

  await assert.rejects(
    () => service.create(actor, input(start, end, { departmentIds: ['other'], userIds: [] })),
    /无效或跨租户部门/,
  )
  await assert.rejects(
    () =>
      service.create(actor, input(start, end, { departmentIds: [], userIds: ['disabled-user'] })),
    /无效、已禁用或跨租户成员/,
  )
  await assert.rejects(
    () => service.create(actor, input(start, end, { url: 'javascript:alert(1)' })),
    /仅支持 http\/https/,
  )
})
