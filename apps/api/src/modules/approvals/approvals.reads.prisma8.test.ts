import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import type { ModuleFormsService } from '../metadata/module-forms.service'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import { ApprovalsService } from './approvals.service'
import type { CreateApprovalFlowDto } from './dto/approval.dto'

test('ApprovalsService Prisma 8 读路径保持分页、timeline 与流程图装配语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-approval-reads-${suffix}`, slug: `p8-approval-reads-${suffix}` },
  })
  const [submitter, approver, ccUser, signUser] = await Promise.all(
    ['提交人', '审批人', '抄送人', '加签人'].map((name, index) =>
      fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          email: `approval-read-${index}-${suffix}@example.test`,
          passwordHash: 'test',
          name,
        },
      }),
    ),
  )
  const submitterActor = {
    id: submitter.id,
    tenantId: tenant.id,
    email: submitter.email,
    name: submitter.name,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  } as AuthUser
  const approverActor = { ...submitterActor, id: approver.id, email: approver.email, name: approver.name }
  const ccActor = { ...submitterActor, id: ccUser.id, email: ccUser.email, name: ccUser.name }

  const moduleForms = { listFields: async () => [] } as unknown as ModuleFormsService
  const flowService = new ApprovalFlowConfigService(prisma8, moduleForms)
  const createDto: CreateApprovalFlowDto = {
    formType: 'contract',
    name: `Prisma8 read flow ${suffix}`,
    description: '审批读路径 Prisma8 真库 gate',
    enabled: false,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: true,
    allowAddSign: true,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: true,
    condition: null,
    createNodes: [
      { clientId: 'start', nodeType: 'START', name: '开始' },
      {
        clientId: 'high',
        nodeType: 'CONDITION',
        name: '高金额',
        conditionConfig: {
          searchMode: 'AND',
          conditions: [{ name: 'amount', operator: 'GE', value: 1000 }],
        },
      },
      { clientId: 'default', nodeType: 'DEFAULT', name: '默认分支' },
      {
        clientId: 'first',
        nodeType: 'APPROVER',
        name: '一级审批',
        approverType: 'USER',
        approverIds: [approver.id],
        ccUserIds: [],
        mode: 'ANY',
      },
      {
        clientId: 'second',
        nodeType: 'APPROVER',
        name: '二级审批',
        approverType: 'USER',
        approverIds: [approver.id],
        ccUserIds: [ccUser.id],
        mode: 'ANY',
      },
      { clientId: 'end', nodeType: 'END', name: '结束' },
    ],
    createLinks: [
      { fromNodeId: 'start', toNodeId: 'high', sort: 0 },
      { fromNodeId: 'start', toNodeId: 'default', sort: 1 },
      { fromNodeId: 'high', toNodeId: 'first', sort: 0 },
      { fromNodeId: 'default', toNodeId: 'second', sort: 0 },
      { fromNodeId: 'first', toNodeId: 'end', sort: 0 },
      { fromNodeId: 'second', toNodeId: 'end', sort: 0 },
    ],
  }

  try {
    const createdFlow = await flowService.create(submitterActor, createDto)
    await flowService.updateEnabled(submitterActor, createdFlow.id, true)
    const flowRow = await fixtureDb.approvalFlow.findUniqueOrThrow({ where: { id: createdFlow.id } })
    assert.ok(flowRow.currentVersionId)

    const firstNode = createdFlow.createNodes.find((node) => node.name === '一级审批')!
    const secondNode = createdFlow.createNodes.find((node) => node.name === '二级审批')!
    const instance = await fixtureDb.approvalInstance.create({
      data: {
        tenantId: tenant.id,
        flowId: createdFlow.id,
        flowVersionId: flowRow.currentVersionId,
        module: 'contract',
        targetId: `contract-${suffix}`,
        targetName: 'Prisma 8 读路径合同',
        currentNodeIndex: 1,
        nodesSnapshot: [
          {
            nodeId: firstNode.id,
            name: firstNode.name,
            approverType: 'USER',
            approverIds: [approver.id],
            ccUserIds: [],
            mode: 'ANY',
          },
          {
            nodeId: secondNode.id,
            name: secondNode.name,
            approverType: 'USER',
            approverIds: [approver.id],
            ccUserIds: [ccUser.id],
            mode: 'ANY',
          },
        ],
        submitterId: submitter.id,
        submitterName: submitter.name,
      },
    })
    const handledTask = await fixtureDb.approvalTask.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: firstNode.id,
        nodeIndex: 0,
        nodeRound: 1,
        nodeName: firstNode.name,
        approverId: approver.id,
        status: 'APPROVED',
        action: 'APPROVE',
        handledAt: new Date(),
      },
    })
    const pendingTask = await fixtureDb.approvalTask.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: secondNode.id,
        nodeIndex: 1,
        nodeRound: 1,
        nodeName: secondNode.name,
        approverId: approver.id,
      },
    })
    await fixtureDb.approvalTask.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: secondNode.id,
        nodeIndex: 1,
        nodeRound: 1,
        nodeName: secondNode.name,
        approverId: ccUser.id,
        taskType: 'CC',
      },
    })
    const signTask = await fixtureDb.approvalTask.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: secondNode.id,
        nodeIndex: 1,
        nodeRound: 1,
        nodeName: secondNode.name,
        approverId: signUser.id,
        taskType: 'SIGN',
      },
    })
    const record = await fixtureDb.approvalRecord.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: handledTask.id,
        nodeId: firstNode.id,
        nodeRound: 1,
        result: 'APPROVE',
        comment: '一级审批通过',
        createdById: approver.id,
      },
    })
    await fixtureDb.approvalAddSignTask.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: signTask.id,
        signTaskId: handledTask.id,
        type: 'BEFORE',
        rootTaskId: handledTask.id,
        sort: 100n,
        comment: '前置加签',
        createdById: approver.id,
      },
    })
    await fixtureDb.approvalReturnBackRecord.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: pendingTask.id,
        returnToNodeId: firstNode.id,
        returnReason: '需要补充信息',
        returnUserId: approver.id,
      },
    })
    const attachment = await fixtureDb.attachment.create({
      data: {
        tenantId: tenant.id,
        uploaderId: approver.id,
        name: 'approval-read.txt',
        path: `/tmp/${suffix}/approval-read.txt`,
        size: 16,
        mime: 'text/plain',
      },
    })
    await fixtureDb.approvalInstanceAttachment.create({
      data: {
        tenantId: tenant.id,
        instanceId: instance.id,
        elementId: record.id,
        attachmentId: attachment.id,
      },
    })

    const resources = { approvalFields: async () => [] }
    const service = new ApprovalsService(
      prisma8,
      {} as never,
      {} as never,
      resources as never,
      {} as never,
    )
    const internals = service as unknown as {
      enabledFlow(
        tenantId: string,
        module: string,
        timing: 'CREATE',
      ): Promise<{
        currentVersion: {
          nodes: Array<{ name: string; approver?: unknown; condition?: unknown }>
          links: unknown[]
        } | null
      } | null>
    }
    const runtimeFlow = await internals.enabledFlow(tenant.id, 'contract', 'CREATE')
    assert.ok(runtimeFlow?.currentVersion)
    assert.equal(runtimeFlow.currentVersion.nodes.length, 6)
    assert.equal(runtimeFlow.currentVersion.links.length, 6)
    assert.ok(runtimeFlow.currentVersion.nodes.find((node) => node.name === '高金额')?.condition)
    assert.ok(runtimeFlow.currentVersion.nodes.find((node) => node.name === '一级审批')?.approver)

    const pending = await service.myPending(approverActor, 1, 10)
    assert.equal(pending.total, 1)
    assert.equal(pending.items[0]?.id, instance.id)
    assert.equal(pending.items[0]?.requireComment, true)
    assert.equal(pending.items[0]?.canAddSign, true)
    assert.equal(pending.items[0]?.returnBackTargets[0]?.nodeId, firstNode.id)
    assert.equal(pending.items[0]?.records[0]?.comment, '一级审批通过')
    assert.equal(pending.items[0]?.addSignTasks[0]?.type, 'BEFORE')
    assert.equal(pending.items[0]?.returnBackRecords[0]?.returnReason, '需要补充信息')
    assert.equal(pending.items[0]?.approvalAttachments[0]?.attachment.id, attachment.id)
    assert.match(pending.items[0]?.createdAt ?? '', /Z$/)

    const handled = await service.myHandled(approverActor, 1, 10)
    assert.equal(handled.total, 1)
    assert.equal(handled.items[0]?.id, instance.id)

    const copied = await service.myCopied(ccActor, 1, 10)
    assert.equal(copied.total, 1)
    assert.equal(copied.items[0]?.id, instance.id)

    const applications = await service.myApplications(submitterActor, 1, 10)
    assert.equal(applications.total, 1)
    assert.equal(applications.items[0]?.id, instance.id)

    const detail = await service.instanceDetail(submitterActor, instance.id)
    assert.equal(detail.id, instance.id)
    assert.equal(detail.resourceFields.length, 0)
    assert.equal(detail.approvalAttachments[0]?.attachment.name, 'approval-read.txt')
  } finally {
    await fixtureDb.approvalInstance.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.attachment.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.approvalNodeLink.deleteMany({
      where: { flowVersion: { flow: { tenantId: tenant.id } } },
    })
    await fixtureDb.approvalNodeApprover.deleteMany({
      where: { node: { flowVersion: { flow: { tenantId: tenant.id } } } },
    })
    await fixtureDb.approvalNodeCondition.deleteMany({
      where: { flowVersion: { flow: { tenantId: tenant.id } } },
    })
    await fixtureDb.approvalNode.deleteMany({
      where: { flowVersion: { flow: { tenantId: tenant.id } } },
    })
    await fixtureDb.approvalFlow.updateMany({
      where: { tenantId: tenant.id },
      data: { currentVersionId: null },
    })
    await fixtureDb.approvalFlowVersion.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.approvalFlow.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.approvalFlowNumberCounter.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.deleteMany({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
