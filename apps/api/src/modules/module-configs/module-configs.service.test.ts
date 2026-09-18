import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import type { PrismaService } from '../../prisma/prisma.service'
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
  const topNavigationConfigs = {
    where: (where: Partial<TopNavigationRow>) => {
      const matches = (row: TopNavigationRow) =>
        Object.entries(where).every(([key, value]) => row[key as keyof TopNavigationRow] === value)
      const query = {
        first: async () => rows.find(matches) ?? null,
        update: async (data: Partial<TopNavigationRow>) => {
          const row = rows.find(matches)
          if (!row) return null
          Object.assign(row, data)
          return row
        },
        orderBy: () => query,
        all: async () =>
          rows.filter(matches).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)),
      }
      return query
    },
    create: async (data: Omit<TopNavigationRow, 'id'>) => {
      const row = { ...data, id: `${data.tenantId}-${data.key}` }
      rows.push(row)
      return row
    },
  }
  const publicOrm = {
    ModuleConfigs: {
      where: () => ({ first: async () => null }),
      create: async () => null,
    },
    TopNavigationConfigs: topNavigationConfigs,
  }
  const prisma = {
    client: {
      orm: { public: publicOrm },
      transaction: async (
        callback: (tx: { orm: { public: typeof publicOrm } }) => Promise<unknown>,
      ) => callback({ orm: { public: publicOrm } }),
    },
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
