import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { ModuleConfigsService } from './module-configs.service'

interface TopNavigationRow {
  id: string
  tenantId: string
  key: string
  enabled: boolean
  sort: number
}

function createService() {
  const rows: TopNavigationRow[] = []
  const topNavigationConfig = {
    createMany: async ({ data }: { data: Omit<TopNavigationRow, 'id'>[] }) => {
      let count = 0
      for (const item of data) {
        if (rows.some((row) => row.tenantId === item.tenantId && row.key === item.key)) continue
        rows.push({ ...item, id: `${item.tenantId}-${item.key}` })
        count += 1
      }
      return { count }
    },
    findMany: async ({ where }: { where: { tenantId: string } }) =>
      rows
        .filter((row) => row.tenantId === where.tenantId)
        .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)),
    update: async ({
      where,
      data,
    }: {
      where: { tenantId_key: { tenantId: string; key: string } }
      data: { sort: number }
    }) => {
      const row = rows.find(
        (item) =>
          item.tenantId === where.tenantId_key.tenantId && item.key === where.tenantId_key.key,
      )
      assert.ok(row)
      row.sort = data.sort
      return row
    },
  }
  const prisma = {
    topNavigationConfig,
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService
  return { service: new ModuleConfigsService(prisma), rows }
}

test('顶部导航默认补种幂等并保持 Cordys 最终顺序', async () => {
  const { service, rows } = createService()

  const first = await service.listTopNavigation('tenant-a')
  const second = await service.listTopNavigation('tenant-a')

  const expected = TOP_NAVIGATION_DEFINITIONS.map(({ key }) => key)
  assert.deepEqual(
    first.map(({ navigationKey }) => navigationKey),
    expected,
  )
  assert.deepEqual(second, first)
  assert.equal(rows.length, expected.length)
})

test('顶部导航完整排序在事务后持久化', async () => {
  const { service } = createService()
  const reversed = TOP_NAVIGATION_DEFINITIONS.map(({ key }) => key).reverse()

  const result = await service.reorderTopNavigation('tenant-a', reversed)

  assert.deepEqual(
    result.map(({ navigationKey }) => navigationKey),
    reversed,
  )
  assert.deepEqual(
    result.map(({ sort }) => sort),
    reversed.map((_, index) => index + 1),
  )
})

test('顶部导航排序拒绝缺项、重复和未知 key', async () => {
  const { service } = createService()
  const keys = TOP_NAVIGATION_DEFINITIONS.map(({ key }) => key)

  await assert.rejects(
    () => service.reorderTopNavigation('tenant-a', keys.slice(1)),
    BadRequestException,
  )
  await assert.rejects(
    () => service.reorderTopNavigation('tenant-a', [...keys.slice(1), keys[1]!]),
    BadRequestException,
  )
  await assert.rejects(
    () => service.reorderTopNavigation('tenant-a', [...keys.slice(1), 'unknown']),
    BadRequestException,
  )
})
