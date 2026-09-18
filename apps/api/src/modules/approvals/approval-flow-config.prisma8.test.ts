import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import type { ModuleFormsService } from '../metadata/module-forms.service'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import type { CreateApprovalFlowDto, UpdateApprovalFlowDto } from './dto/approval.dto'

test('ApprovalFlowConfig 使用 Prisma 8 保持流程图版本、排序与编号计数语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-flow-${suffix}`, slug: `p8-flow-${suffix}` },
  })
  const approver = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `approver-${suffix}@example.test`,
      passwordHash: 'test',
      name: '审批人',
    },
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
    assert.equal(await fixtureDb.approvalFlow.count({ where: { id: first.id, deletedAt: { not: null } } }), 1)

    const second = await service.create(actor, createDto('合同审批 Prisma8 第二条'))
    assert.equal(second.number, 'CTR-APV-00002')
    const counter = await fixtureDb.approvalFlowNumberCounter.findUniqueOrThrow({
      where: { tenantId_formType: { tenantId: tenant.id, formType: 'CONTRACT' } },
    })
    assert.equal(counter.nextValue, 3)
    assert.equal(await fixtureDb.approvalFlowVersion.count({ where: { flowId: first.id } }), 2)
    assert.equal(await fixtureDb.approvalNode.count({ where: { flowVersion: { flowId: first.id } } }), 6)

    await service.remove(actor, second.id)
  } finally {
    await fixtureDb.approvalNodeLink.deleteMany({ where: { flowVersion: { flow: { tenantId: tenant.id } } } })
    await fixtureDb.approvalNodeApprover.deleteMany({ where: { node: { flowVersion: { flow: { tenantId: tenant.id } } } } })
    await fixtureDb.approvalNodeCondition.deleteMany({ where: { flowVersion: { flow: { tenantId: tenant.id } } } })
    await fixtureDb.approvalNode.deleteMany({ where: { flowVersion: { flow: { tenantId: tenant.id } } } })
    await fixtureDb.approvalFlow.updateMany({ where: { tenantId: tenant.id }, data: { currentVersionId: null } })
    await fixtureDb.approvalFlowVersion.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.approvalFlow.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.approvalFlowNumberCounter.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.deleteMany({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
