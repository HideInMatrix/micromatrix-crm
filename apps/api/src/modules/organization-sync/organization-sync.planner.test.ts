import assert from 'node:assert/strict'
import test from 'node:test'
import { OrganizationSyncPlanner } from './organization-sync.planner'

test('组织同步规划器优先使用映射并只禁用缺失的已映射成员', () => {
  const planner = new OrganizationSyncPlanner()
  const plan = planner.plan({
    tenantId: 'tenant-a',
    snapshot: {
      departments: [
        {
          id: '1',
          externalKey: '1',
          name: '示例企业',
          parentId: '0',
          parentExternalKey: '0',
          order: 100,
          isRoot: true,
        },
        {
          id: '2',
          externalKey: '2',
          name: '销售部',
          parentId: '1',
          parentExternalKey: '1',
          order: 80,
          isRoot: false,
        },
      ],
      users: [
        {
          userId: 'zhangsan',
          externalKey: 'zhangsan',
          name: '张三',
          email: 'zhangsan@example.com',
          mobile: '13800000000',
          position: '销售主管',
          mainDepartmentId: '2',
          mainDepartmentExternalKey: '2',
          isLeader: true,
        },
      ],
    },
    departments: [
      { id: 'root', name: '旧企业名', parentId: null, sort: 0 },
      { id: 'sales', name: '销售一部', parentId: 'root', sort: 0 },
    ],
    users: [
      {
        id: 'mapped-user',
        email: 'mapped@example.com',
        name: '旧姓名',
        status: 'ACTIVE',
        deptId: 'sales',
        position: null,
        phone: null,
      },
      {
        id: 'missing-user',
        email: 'missing@example.com',
        name: '已离职',
        status: 'ACTIVE',
        deptId: 'sales',
        position: null,
        phone: null,
      },
    ],
    departmentMappings: [
      { externalId: '1', externalKey: '1', departmentId: 'root', active: true },
      { externalId: '2', externalKey: '2', departmentId: 'sales', active: true },
    ],
    userMappings: [
      {
        externalId: 'zhangsan',
        externalKey: 'zhangsan',
        userId: 'mapped-user',
        active: true,
      },
      {
        externalId: 'left-user',
        externalKey: 'left-user',
        userId: 'missing-user',
        active: true,
      },
    ],
  })

  const mapped = plan.items.find((item) => item.externalKey === 'zhangsan')
  const missing = plan.items.find((item) => item.externalKey === 'left-user')
  assert.equal(mapped?.action, 'UPDATE')
  assert.equal(mapped?.localId, 'mapped-user')
  assert.equal(missing?.action, 'DISABLE')
  assert.equal(plan.counts.disable, 1)
})

test('无映射成员发生租户内邮箱碰撞时生成冲突，缺失邮箱时保持为空', () => {
  const planner = new OrganizationSyncPlanner()
  const base = {
    tenantId: 'tenant-a',
    departments: [{ id: 'root', name: '示例企业', parentId: null, sort: 100 }],
    departmentMappings: [{ externalId: '1', externalKey: '1', departmentId: 'root', active: true }],
    userMappings: [],
  }
  const department = {
    id: '1',
    externalKey: '1',
    name: '示例企业',
    parentId: '0',
    parentExternalKey: '0',
    order: 100,
    isRoot: true,
  }
  const user = {
    userId: 'new-user',
    externalKey: 'new-user',
    name: '新成员',
    email: 'same@example.com',
    mobile: null,
    position: null,
    mainDepartmentId: '1',
    mainDepartmentExternalKey: '1',
    isLeader: false,
  }

  const conflict = planner.plan({
    ...base,
    snapshot: { departments: [department], users: [user] },
    users: [
      {
        id: 'local-user',
        email: 'same@example.com',
        name: '本地成员',
        status: 'ACTIVE' as const,
        deptId: 'root',
        position: null,
        phone: null,
      },
    ],
  })
  assert.equal(conflict.items.find((item) => item.resourceType === 'USER')?.action, 'CONFLICT')

  const withoutEmail = planner.plan({
    ...base,
    snapshot: { departments: [department], users: [{ ...user, email: null }] },
    users: [],
  })
  const item = withoutEmail.items.find((candidate) => candidate.resourceType === 'USER')
  assert.equal(item?.action, 'CREATE')
  assert.equal(item?.sourceData['proposedEmail'], null)
})
