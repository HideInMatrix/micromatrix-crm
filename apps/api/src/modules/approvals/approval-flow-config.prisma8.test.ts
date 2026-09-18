import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { ModuleFormsService } from '../metadata/module-forms.service'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import type { CreateApprovalFlowDto, UpdateApprovalFlowDto } from './dto/approval.dto'

test('ApprovalFlowConfig 使用 Prisma 8 保持流程图版本、排序与编号计数语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-flow')
  const approver = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `approver-${suffix}@example.test`,
    passwordHash: 'test',
    name: '审批人',
  })
  const actor = {
    id: approver.id,
    tenantId: tenant.id,
    email: approver.email,
    name: approver.name,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  } as AuthUser
  const moduleForms = { listFields: async () => [] } as unknown as ModuleFormsService
  const service = new ApprovalFlowConfigService(prisma8, moduleForms)

  const createDto = (name: string): CreateApprovalFlowDto => ({
    formType: 'contract',
    name,
    description: 'Prisma8 流程',
    enabled: false,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    createNodes: [
      { clientId: 'start', nodeType: 'START', name: '开始' },
      {
        clientId: 'approve',
        nodeType: 'APPROVER',
        name: '审批',
        approverType: 'USER',
        approverIds: [approver.id],
        ccUserIds: [],
        mode: 'ANY',
      },
      { clientId: 'end', nodeType: 'END', name: '结束' },
    ],
    createLinks: [
      { fromNodeId: 'start', toNodeId: 'approve', sort: 0 },
      { fromNodeId: 'approve', toNodeId: 'end', sort: 0 },
    ],
  })

  try {
    const first = await service.create(actor, createDto('合同审批 Prisma8'))
    assert.equal(first.number, 'CTR-APV-00001')
    assert.equal(first.currentVersion, 1)
    assert.equal(first.createNodes.length, 3)
    assert.equal(first.createLinks.length, 2)

    const listed = await service.list(actor, {
      page: 1,
      pageSize: 10,
      keyword: 'Prisma8',
      sortBy: 'enabled',
      sortOrder: 'asc',
    })
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0]?.id, first.id)

    const startNode = first.createNodes.find((node) => node.nodeType === 'START')!
    const approverNode = first.createNodes.find((node) => node.nodeType === 'APPROVER')!
    const endNode = first.createNodes.find((node) => node.nodeType === 'END')!
    const updateDto: UpdateApprovalFlowDto = {
      name: '合同审批 Prisma8 v2',
      description: '版本二',
      enabled: false,
      createExecute: true,
      updateExecute: false,
      deleteExecute: false,
      submitterCanRevoke: true,
      allowBatchProcess: false,
      allowWithdraw: false,
      allowAddSign: false,
      duplicateApproverRule: 'FIRST_ONLY',
      requireComment: false,
      condition: null,
      createNodes: [
        { clientId: startNode.id, nodeType: 'START', name: startNode.name },
        {
          clientId: approverNode.id,
          nodeType: 'APPROVER',
          name: '审批节点 v2',
          approverType: 'USER',
          approverIds: [approver.id],
          ccUserIds: [],
          mode: 'ANY',
        },
        { clientId: endNode.id, nodeType: 'END', name: endNode.name },
      ],
      createLinks: first.createLinks.map((link) => ({
        fromNodeId: link.fromNodeId,
        toNodeId: link.toNodeId,
        sort: link.sort,
      })),
    }
    const updated = await service.update(actor, first.id, updateDto)
    assert.equal(updated.currentVersion, 2)
    assert.equal(updated.name, '合同审批 Prisma8 v2')

    await service.updateEnabled(actor, first.id, true)
    assert.equal((await service.detail(actor, first.id)).enabled, true)
    await service.updateEnabled(actor, first.id, false)
    await service.remove(actor, first.id)
    const deleted = await prisma8Client.orm.public.ApprovalFlows.where({ id: first.id })
      .select('deletedAt')
      .first()
    assert.ok(deleted?.deletedAt)

    const second = await service.create(actor, createDto('合同审批 Prisma8 第二条'))
    assert.equal(second.number, 'CTR-APV-00002')
    const counter = await prisma8Client.orm.public.ApprovalFlowNumberCounters.where({
      tenantId: tenant.id,
      formType: 'CONTRACT',
    }).first()
    assert.ok(counter)
    assert.equal(counter.nextValue, 3)
    const versions = await prisma8Client.orm.public.ApprovalFlowVersions.where({
      flowId: first.id,
    })
      .select('id')
      .all()
    assert.equal(versions.length, 2)
    const nodes = await prisma8Client.orm.public.ApprovalNodes
      .where((row) => row.flowVersionId.in(versions.map((item) => item.id)))
      .select('id')
      .all()
    assert.equal(nodes.length, 6)

    await service.remove(actor, second.id)
  } finally {
    const flows = await prisma8Client.orm.public.ApprovalFlows.where({ tenantId: tenant.id })
      .select('id')
      .all()
    const versions = flows.length
      ? await prisma8Client.orm.public.ApprovalFlowVersions
          .where((row) => row.flowId.in(flows.map((item) => item.id)))
          .select('id')
          .all()
      : []
    const nodes = versions.length
      ? await prisma8Client.orm.public.ApprovalNodes
          .where((row) => row.flowVersionId.in(versions.map((item) => item.id)))
          .select('id')
          .all()
      : []
    if (versions.length) {
      await prisma8Client.orm.public.ApprovalNodeLinks
        .where((row) => row.flowVersionId.in(versions.map((item) => item.id)))
        .deleteAll()
      await prisma8Client.orm.public.ApprovalNodeConditions
        .where((row) => row.flowVersionId.in(versions.map((item) => item.id)))
        .deleteAll()
    }
    if (nodes.length) {
      await prisma8Client.orm.public.ApprovalNodeApprovers
        .where((row) => row.nodeId.in(nodes.map((item) => item.id)))
        .deleteAll()
      await prisma8Client.orm.public.ApprovalNodes
        .where((row) => row.id.in(nodes.map((item) => item.id)))
        .deleteAll()
    }
    await prisma8Client.orm.public.ApprovalFlows.where({ tenantId: tenant.id }).update({
      currentVersionId: null,
    })
    if (versions.length) {
      await prisma8Client.orm.public.ApprovalFlowVersions
        .where((row) => row.id.in(versions.map((item) => item.id)))
        .deleteAll()
    }
    await prisma8Client.orm.public.ApprovalFlows.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.ApprovalFlowNumberCounters.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
