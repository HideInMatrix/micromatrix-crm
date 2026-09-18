import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { ModuleFormsService } from '../metadata/module-forms.service'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import { ApprovalsService } from './approvals.service'
import type { CreateApprovalFlowDto } from './dto/approval.dto'

test('ApprovalsService Prisma 读路径保持分页、timeline 与流程图装配语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = String(Date.now()) + '-' + Math.random().toString(16).slice(2)
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-approval-reads')
  const [submitter, approver, ccUser, signUser] = await Promise.all(
    [
      ['提交人', 0],
      ['审批人', 1],
      ['抄送人', 2],
      ['加签人', 3],
    ].map(([name, index]) =>
      createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        email: `approval-read-${index}-${suffix}@example.test`,
        passwordHash: 'test',
        name: String(name),
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
  const approverActor = {
    ...submitterActor,
    id: approver.id,
    email: approver.email,
    name: approver.name,
  }
  const ccActor = { ...submitterActor, id: ccUser.id, email: ccUser.email, name: ccUser.name }

  const moduleForms = { listFields: async () => [] } as unknown as ModuleFormsService
  const flowService = new ApprovalFlowConfigService(prisma, moduleForms)
  const createDto: CreateApprovalFlowDto = {
    formType: 'contract',
    name: `Prisma read flow ${suffix}`,
    description: '审批读路径 Prisma 真库 gate',
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
    const flowRow = await prismaClient.orm.public.ApprovalFlows.where({ id: createdFlow.id })
      .select('currentVersionId')
      .first()
    assert.ok(flowRow?.currentVersionId)

    const firstNode = createdFlow.createNodes.find((node) => node.name === '一级审批')!
    const secondNode = createdFlow.createNodes.find((node) => node.name === '二级审批')!
    const instance = await prismaClient.orm.public.ApprovalInstances.select('id').create({
      tenantId: tenant.id,
      flowId: createdFlow.id,
      flowVersionId: flowRow.currentVersionId,
      module: 'contract',
      targetId: `contract-${suffix}`,
      targetName: 'Prisma 读路径合同',
      currentNodeIndex: 1,
      nodesSnapshot: jsonValue([
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
      ]),
      submitterId: submitter.id,
      submitterName: submitter.name,
      updatedAt: nowInstant(),
    })
    const handledTask = await prismaClient.orm.public.ApprovalTasks.select('id').create({
      tenantId: tenant.id,
      instanceId: instance.id,
      nodeId: firstNode.id,
      nodeIndex: 0,
      nodeRound: 1,
      nodeName: firstNode.name,
      approverId: approver.id,
      status: 'APPROVED',
      action: 'APPROVE',
      handledAt: nowInstant(),
      updatedAt: nowInstant(),
    })
    const pendingTask = await prismaClient.orm.public.ApprovalTasks.select('id').create({
      tenantId: tenant.id,
      instanceId: instance.id,
      nodeId: secondNode.id,
      nodeIndex: 1,
      nodeRound: 1,
      nodeName: secondNode.name,
      approverId: approver.id,
      updatedAt: nowInstant(),
    })
    await prismaClient.orm.public.ApprovalTasks.create({
      tenantId: tenant.id,
      instanceId: instance.id,
      nodeId: secondNode.id,
      nodeIndex: 1,
      nodeRound: 1,
      nodeName: secondNode.name,
      approverId: ccUser.id,
      taskType: 'CC',
      updatedAt: nowInstant(),
    })
    const signTask = await prismaClient.orm.public.ApprovalTasks.select('id').create({
      tenantId: tenant.id,
      instanceId: instance.id,
      nodeId: secondNode.id,
      nodeIndex: 1,
      nodeRound: 1,
      nodeName: secondNode.name,
      approverId: signUser.id,
      taskType: 'SIGN',
      updatedAt: nowInstant(),
    })
    const record = await prismaClient.orm.public.ApprovalRecords.select('id').create({
      tenantId: tenant.id,
      instanceId: instance.id,
      taskId: handledTask.id,
      nodeId: firstNode.id,
      nodeRound: 1,
      result: 'APPROVE',
      comment: '一级审批通过',
      createdById: approver.id,
      updatedAt: nowInstant(),
    })
    await prismaClient.orm.public.ApprovalAddSignTasks.create({
      tenantId: tenant.id,
      instanceId: instance.id,
      taskId: signTask.id,
      signTaskId: handledTask.id,
      _type: 'BEFORE',
      rootTaskId: handledTask.id,
      sort: 100n,
      comment: '前置加签',
      createdById: approver.id,
      updatedAt: nowInstant(),
    })
    await prismaClient.orm.public.ApprovalReturnBackRecords.create({
      tenantId: tenant.id,
      instanceId: instance.id,
      taskId: pendingTask.id,
      returnToNodeId: firstNode.id,
      returnReason: '需要补充信息',
      returnUserId: approver.id,
      updatedAt: nowInstant(),
    })
    const attachment = await prismaClient.orm.public.Attachments.select('id').create({
      tenantId: tenant.id,
      uploaderId: approver.id,
      name: 'approval-read.txt',
      path: `/tmp/${suffix}/approval-read.txt`,
      size: 16,
      mime: 'text/plain',
    })
    await prismaClient.orm.public.ApprovalInstanceAttachments.create({
      tenantId: tenant.id,
      instanceId: instance.id,
      elementId: record.id,
      attachmentId: attachment.id,
    })

    const resources = { approvalFields: async () => [] }
    const service = new ApprovalsService(
      prisma,
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
    await prismaClient.orm.public.ApprovalInstances.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Attachments.where({ tenantId: tenant.id }).deleteAll()

    const flows = await prismaClient.orm.public.ApprovalFlows.where({ tenantId: tenant.id })
      .select('id')
      .all()
    const versions = flows.length
      ? await prismaClient.orm.public.ApprovalFlowVersions.where((row) =>
          row.flowId.in(flows.map((item) => item.id)),
        )
          .select('id')
          .all()
      : []
    const nodes = versions.length
      ? await prismaClient.orm.public.ApprovalNodes.where((row) =>
          row.flowVersionId.in(versions.map((item) => item.id)),
        )
          .select('id')
          .all()
      : []
    if (versions.length) {
      const versionIds = versions.map((item) => item.id)
      await prismaClient.orm.public.ApprovalNodeLinks.where((row) =>
        row.flowVersionId.in(versionIds),
      ).deleteAll()
      await prismaClient.orm.public.ApprovalNodeConditions.where((row) =>
        row.flowVersionId.in(versionIds),
      ).deleteAll()
    }
    if (nodes.length) {
      const nodeIds = nodes.map((item) => item.id)
      await prismaClient.orm.public.ApprovalNodeApprovers.where((row) =>
        row.nodeId.in(nodeIds),
      ).deleteAll()
      await prismaClient.orm.public.ApprovalNodes.where((row) => row.id.in(nodeIds)).deleteAll()
    }
    await prismaClient.orm.public.ApprovalFlows.where({ tenantId: tenant.id }).update({
      currentVersionId: null,
    })
    if (versions.length) {
      await prismaClient.orm.public.ApprovalFlowVersions.where((row) =>
        row.id.in(versions.map((item) => item.id)),
      ).deleteAll()
    }
    await prismaClient.orm.public.ApprovalFlows.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.ApprovalFlowNumberCounters.where({
      tenantId: tenant.id,
    }).deleteAll()
    await prismaClient.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
