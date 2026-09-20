import assert from 'node:assert/strict'
import test from 'node:test'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'

test('应用企微可见根时使用选中目标部门作为本地父级', async () => {
  let updateData: Record<string, unknown> | undefined
  const mappingCollection = {
    where: () => mappingCollection,
    select: () => mappingCollection,
    all: async () => [],
    first: async () => null,
    create: async () => ({}),
  }
  const departmentCollection = {
    where: () => departmentCollection,
    update: async (data: Record<string, unknown>) => {
      updateData = data
      return { id: 'support', ...data }
    },
  }
  const itemCollection = {
    where: () => itemCollection,
    update: async () => ({}),
  }
  const tx = {
    orm: {
      public: {
        ExternalDepartmentMappings: mappingCollection,
        Departments: departmentCollection,
        OrganizationSyncItems: itemCollection,
      },
    },
  }
  const service = new OrganizationSyncApplyService({} as never, {} as never, {} as never)
  const applyDepartments = (
    service as unknown as {
      applyDepartments: (
        client: unknown,
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
      resourceType: 'DEPARTMENT',
      action: 'UPDATE',
      externalId: '13',
      externalKey: '13',
      parentExternalKey: null,
      localId: 'support',
      resolvedLocalId: null,
      sourceData: { name: '技术支持', order: 99_991_000, isRoot: true },
    },
  ] as never)

  assert.equal(updateData?.['name'], '技术支持')
  assert.equal(updateData?.['parentId'], 'root')
  assert.equal(updateData?.['sort'], 99_991_000)
  assert.ok(updateData?.['updatedAt'])
  assert.equal(resolved.get('13'), 'support')
})
