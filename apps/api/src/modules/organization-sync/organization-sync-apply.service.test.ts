import assert from 'node:assert/strict'
import test from 'node:test'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'

test('应用企微可见根时使用选中目标部门作为本地父级', async () => {
  let updateData: Record<string, unknown> | undefined
  const tx = {
    externalDepartmentMapping: {
      findMany: async () => [],
      upsert: async () => ({}),
    },
    department: {
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        updateData = data
        return { count: 1 }
      },
    },
    organizationSyncItem: {
      update: async () => ({}),
    },
  }
  const service = new OrganizationSyncApplyService({} as never, {} as never)
  const applyDepartments = (
    service as unknown as {
      applyDepartments: (
        client: typeof tx,
        tenantId: string,
        batchId: string,
        targetDepartmentId: string,
        items: Array<Record<string, unknown>>,
      ) => Promise<Map<string, string>>
    }
  ).applyDepartments.bind(service)

  const resolved = await applyDepartments(tx, 'tenant-a', 'batch-a', 'root', [
    {
      id: 'item-root',
      action: 'UPDATE',
      externalId: '13',
      externalKey: '13',
      parentExternalKey: null,
      localId: 'support',
      resolvedLocalId: null,
      sourceData: { name: '技术支持', order: 99_991_000, isRoot: true },
    },
  ])

  assert.deepEqual(updateData, { name: '技术支持', parentId: 'root', sort: 99_991_000 })
  assert.equal(resolved.get('13'), 'support')
})
