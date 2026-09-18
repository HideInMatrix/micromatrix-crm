import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type ApprovalConditionConfig,
  type ApprovalFilterCondition,
  ApprovalInstanceVO,
  ApprovalModule,
  ApprovalNodeConfig,
  type MessageTaskEvent,
  PaginatedResult,
} from '@micromatrix/shared'
import { and, not, or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Client } from '../../prisma/prisma8-client.js'
import {
  prisma8Now,
  prisma8TimestampFromDate,
  prisma8TimestampToDate,
  prisma8TimestampToISOString,
} from '../../prisma/prisma8-temporal.js'
import { prisma8JsonValue, prisma8Varchar } from '../../prisma/prisma8-values.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { NotificationsService } from '../notifications/notifications.service'
import { MODULE_TO_FORM_TYPE, toDbFormType } from './approval-flow-config.utils'
import { ApprovalResourceService } from './approval-resource.service'
import type {
  ApprovalInstanceRuntime,
  ApprovalJsonValue,
  ApprovalTaskRuntime,
} from './approval-runtime.types'
import { ApprovalWebhookService } from './approval-webhook.service'
import type { AddSignTaskDto, ReturnBackTaskDto } from './dto/approval.dto'

type ApprovalExecuteTimingValue = 'CREATE' | 'UPDATE' | 'DELETE'
type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]
type Prisma8ApprovalInstanceRow = NonNullable<
  Awaited<ReturnType<Prisma8Service['client']['orm']['public']['ApprovalInstances']['first']>>
>
type Prisma8ApprovalTaskRow = NonNullable<
  Awaited<ReturnType<Prisma8Service['client']['orm']['public']['ApprovalTasks']['first']>>
>
type ApprovalInstance = ApprovalInstanceRuntime
type ApprovalTask = ApprovalTaskRuntime

type WithdrawInstanceLike = {
  status: ApprovalInstance['status']
  currentNodeIndex: number
  nodesSnapshot: unknown
}
type WithdrawTaskLike = Pick<
  ApprovalTask,
  'id' | 'instanceId' | 'nodeId' | 'nodeIndex' | 'nodeRound' | 'taskType' | 'status' | 'action'
>

interface ApprovalSubmitContext {
  preUpdateSnapshot?: ApprovalJsonValue | null
  comment?: string | null
}

interface RuntimeFlowNode {
  id: string
  name: string
  nodeType: string
  approver: {
    approverType: ApprovalNodeConfig['approverType']
    approverIds: string[]
    ccUserIds: string[]
    mode: ApprovalNodeConfig['mode']
    emptyApproverAction: ApprovalNodeConfig['emptyApproverAction']
    fallbackApprover: string | null
    sameSubmitterAction: ApprovalNodeConfig['sameSubmitterAction']
    approverDirection: ApprovalNodeConfig['approverDirection']
    fieldPermissions: unknown
    passPostConfig: unknown
    rejectPostConfig: unknown
  } | null
  condition: {
    conditionConfig: unknown
  } | null
}

interface RuntimeFlowVersion {
  id: string
  nodes: RuntimeFlowNode[]
  links: Array<{
    fromNodeId: string
    toNodeId: string
    sort: number
  }>
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly notifications: NotificationsService,
    private readonly businessNotifications: BusinessNotificationsService,
    private readonly resources: ApprovalResourceService,
    private readonly webhooks: ApprovalWebhookService,
  ) {}

  /** 该模块在指定金额/执行时机下是否命中启用审批流。 */
  async flowRequired(
    tenantId: string,
    module: string,
    amount: number,
    executeTiming: ApprovalExecuteTimingValue = 'CREATE',
  ): Promise<boolean> {
    const flow = await this.enabledFlow(tenantId, module, executeTiming)
    if (!flow?.currentVersion) return false
    const amountGte = (flow.condition as { amountGte?: number } | null)?.amountGte
    return amountGte === undefined || amountGte === null || amount >= amountGte
  }

  /** Cordys 的模块级审批开关语义；本项目以存在启用且已有生效版本的审批流等价实现。 */
  async moduleApprovalEnabled(tenantId: string, module: ApprovalModule): Promise<boolean> {
    const formType = MODULE_TO_FORM_TYPE[module]
    if (!formType) return false
    const aggregate = await this.prisma8.client.orm.public.ApprovalFlows.where({
      tenantId,
      formType: toDbFormType(formType),
      enabled: true,
      deletedAt: null,
    })
      .where((row) => row.currentVersionId.isNotNull())
      .aggregate((agg) => ({ count: agg.count() }))
    return aggregate.count > 0
  }

  /** Cordys UPDATE 审批命中前保存编辑前业务快照。 */
  async capturePreUpdateSnapshot(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
  ): Promise<ApprovalJsonValue | null> {
    return this.resources.capture(user, module, targetId)
  }

  // ===== 提交与审批 =====

  async submit(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    executeTiming: ApprovalExecuteTimingValue = 'CREATE',
    context?: ApprovalSubmitContext,
  ) {
    const target = await this.resources.targetInfo(user.tenantId, module, targetId)
    if (target.approvalStatus === 'PENDING') throw new BadRequestException('该单据已在审批中')
    if (executeTiming === 'CREATE' && target.approvalStatus === 'APPROVED') {
      throw new BadRequestException('该单据已审批通过')
    }

    const flow = await this.enabledFlow(user.tenantId, module, executeTiming)
    if (!flow?.currentVersion) throw new BadRequestException('该业务对象未配置启用的审批流')
    const amountGte = (flow.condition as { amountGte?: number } | null)?.amountGte
    if (amountGte !== undefined && amountGte !== null && target.amount < amountGte) {
      throw new BadRequestException('该单据金额未达到审批条件，无需审批')
    }

    const preUpdateSnapshot = context?.preUpdateSnapshot ?? null
    const updateFields =
      executeTiming === 'UPDATE' && preUpdateSnapshot
        ? await this.resources.deriveUpdateFields(user, module, targetId, preUpdateSnapshot)
        : []

    const snapshot = await this.resolveApprovalPath(
      user,
      module,
      targetId,
      flow.currentVersion,
      new Set(updateFields),
    )

    if (executeTiming === 'UPDATE' && preUpdateSnapshot) {
      await this.resources.savePreUpdateSnapshot(user, module, targetId, preUpdateSnapshot)
    }

    const instance = await this.prisma8.client.orm.public.ApprovalInstances.create({
      tenantId: user.tenantId,
      flowId: flow.id,
      flowVersionId: flow.currentVersion.id,
      executeTiming,
      module,
      targetId,
      targetName: target.name,
      summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
      nodesSnapshot: prisma8JsonValue(snapshot),
      comment: context?.comment?.trim() || null,
      updateFields: updateFields.length
        ? prisma8Varchar<2000>(JSON.stringify(updateFields))
        : null,
      currentNodeIndex: -1,
      submitterId: user.id,
      submitterName: user.name,
      updatedAt: prisma8Now(),
    })

    await this.resources.setBizStatus(user.tenantId, module, targetId, 'PENDING')
    await this.advance(instance.id, user.id)
    return { id: instance.id, name: target.name }
  }

  async approveTask(user: AuthUser, taskId: string, comment?: string, attachmentIds?: string[]) {
    const task = await this.ensurePendingTask(user, taskId)
    const handledAt = new Date()
    const normalizedComment = comment?.trim() || null
    const normalizedAttachmentIds = await this.ensureActionAttachmentIds(user, attachmentIds)
    if ((await this.requireCommentForInstance(user, task.instanceId)) && !normalizedComment) {
      throw new BadRequestException('当前审批流要求填写审批意见')
    }
    const updatedAt = prisma8Now()
    await this.prisma8.client.transaction(async (tx) => {
      const updated = await tx.orm.public.ApprovalTasks.where({ id: taskId }).update({
        status: 'APPROVED',
        action: 'APPROVE',
        handledAt: prisma8TimestampFromDate(handledAt),
        updatedAt,
      })
      if (!updated) throw new BadRequestException('审批任务状态已变化，请刷新后重试')
      await this.saveApprovalRecordPrisma8(
        tx,
        user,
        task,
        'APPROVE',
        normalizedComment,
        normalizedAttachmentIds,
        updatedAt,
      )
    })

    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: task.instanceId,
    }).first()
    if (!instanceRow) throw new NotFoundException('审批实例不存在')
    const instance = this.toLegacyInstance(instanceRow)
    if (task.taskType === 'SIGN') await this.continueAddSignChain(task, instance, user.id)
    else await this.completeApprovedNodeTask(task, instance, user.id)
    return { id: taskId, name: instance.targetName }
  }

  async updateTaskFields(
    user: AuthUser,
    taskId: string,
    fields: Array<{ fieldId: string; value?: unknown }>,
  ) {
    if (!fields.length) throw new BadRequestException('至少需要提交一个审批字段')
    const task = await this.ensurePendingTask(user, taskId)
    if (task.taskType !== 'APPROVAL') {
      throw new BadRequestException('加签/抄送任务只允许查看业务字段')
    }
    if (!task.nodeId) throw new BadRequestException('当前任务缺少稳定节点 ID')
    const normalized = fields.map((field) => ({
      fieldId: field.fieldId.trim(),
      value: field.value,
    }))
    if (normalized.some((field) => !field.fieldId))
      throw new BadRequestException('审批字段 ID 不能为空')
    if (new Set(normalized.map((field) => field.fieldId)).size !== normalized.length) {
      throw new BadRequestException('审批字段不能重复提交')
    }

    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: task.instanceId,
      tenantId: user.tenantId,
      status: 'PENDING',
    }).first()
    const instance = instanceRow ? this.toLegacyInstance(instanceRow) : null
    if (!instance || instance.currentNodeIndex !== task.nodeIndex) {
      throw new BadRequestException('仅当前审批节点允许修改业务字段')
    }
    const frozenNodes = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const node = frozenNodes[task.nodeIndex]
    if (!node || node.nodeId !== task.nodeId) {
      throw new BadRequestException('当前任务与冻结审批节点不一致')
    }
    const editableFieldIds = new Set(
      (node.fieldPermissions ?? [])
        .filter((permission) => permission.permissionType === 'EDIT')
        .map((permission) => permission.fieldId),
    )
    if (normalized.some((field) => !editableFieldIds.has(field.fieldId))) {
      throw new BadRequestException('存在当前审批节点无编辑权限的字段')
    }

    await this.resources.updateApprovalFields(
      user,
      instance.module as ApprovalModule,
      instance.targetId,
      normalized,
      editableFieldIds,
    )
    const target = await this.resources.targetInfo(
      user.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
    )
    await this.prisma8.client.orm.public.ApprovalInstances.where({ id: instance.id }).update({
      targetName: target.name,
      summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
      updatedAt: prisma8Now(),
    })
    return { id: taskId, count: normalized.length }
  }

  async signTask(user: AuthUser, taskId: string, dto: AddSignTaskDto) {
    const sourceTask = await this.ensurePendingTask(user, taskId)
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: sourceTask.instanceId,
      tenantId: user.tenantId,
      status: 'PENDING',
    }).first()
    const instance = instanceRow ? this.toLegacyInstance(instanceRow) : null
    if (!instance) throw new BadRequestException('仅审批中的实例允许加签')
    if (!instance.flowId) throw new BadRequestException('审批实例缺少流程引用，不能加签')

    const flow = await this.prisma8.client.orm.public.ApprovalFlows.where({
      id: instance.flowId,
      tenantId: user.tenantId,
      deletedAt: null,
    })
      .select('allowAddSign')
      .first()
    if (!flow?.allowAddSign) throw new BadRequestException('当前审批流未开启加签')

    const signApprover = await this.prisma8.client.orm.public.Users.where({
      id: dto.signApprover,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!signApprover) throw new BadRequestException('加签审批人不存在或已停用')

    const sourceRelation = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({
      taskId: sourceTask.id,
    }).first()
    const rootTaskId = sourceRelation?.rootTaskId ?? sourceTask.id
    const sort = await this.nextAddSignSort(rootTaskId, sourceRelation, dto.type)
    const normalizedComment = dto.comment?.trim() || null
    const normalizedAttachmentIds = await this.ensureActionAttachmentIds(user, dto.attachmentIds)
    const handledAt = new Date()
    const signTaskId = randomUUID()
    const addSignRelationId = randomUUID()
    const updatedAt = prisma8Now()

    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.ApprovalTasks.where({ id: sourceTask.id }).update(
        dto.type === 'BEFORE'
          ? { action: 'SIGN', updatedAt }
          : {
              status: 'APPROVED',
              action: 'APPROVE',
              handledAt: prisma8TimestampFromDate(handledAt),
              updatedAt,
            },
      )
      await tx.orm.public.ApprovalTasks.create({
        id: signTaskId,
        tenantId: user.tenantId,
        instanceId: sourceTask.instanceId,
        nodeId: sourceTask.nodeId,
        nodeIndex: sourceTask.nodeIndex,
        nodeRound: sourceTask.nodeRound,
        nodeName: sourceTask.nodeName,
        approverId: signApprover.id,
        taskType: 'SIGN',
        updatedAt,
      })
      await tx.orm.public.ApprovalAddSignTasks.create({
        id: addSignRelationId,
        tenantId: user.tenantId,
        instanceId: sourceTask.instanceId,
        taskId: signTaskId,
        signTaskId: sourceTask.id,
        _type: dto.type,
        rootTaskId,
        sort,
        comment: normalizedComment,
        createdById: user.id,
        updatedAt,
      })
      if (dto.type === 'AFTER') {
        await this.saveApprovalRecordPrisma8(
          tx,
          user,
          sourceTask,
          'APPROVE',
          normalizedComment,
          normalizedAttachmentIds,
          updatedAt,
        )
      }
      await this.saveActionAttachmentRelationsPrisma8(
        tx,
        user.tenantId,
        sourceTask.instanceId,
        addSignRelationId,
        normalizedAttachmentIds,
      )
    })
    await this.notifications.notifyMany(user.tenantId, [signApprover.id], {
      type: 'approval',
      title: '有新的加签审批待处理',
      content: `${user.name} 为「${instance.targetName}」添加了${dto.type === 'BEFORE' ? '前置' : '后置'}加签`,
      link: '/approvals',
    })
    return { id: signTaskId, name: instance.targetName }
  }

  async returnBackTask(user: AuthUser, taskId: string, dto: ReturnBackTaskDto) {
    const sourceTask = await this.ensurePendingTask(user, taskId)
    if (sourceTask.taskType !== 'APPROVAL') {
      throw new BadRequestException('加签任务不能直接执行节点退回')
    }
    if (!sourceTask.nodeId)
      throw new BadRequestException('当前任务缺少稳定节点 ID，不能执行节点退回')

    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: sourceTask.instanceId,
      tenantId: user.tenantId,
      status: 'PENDING',
    }).first()
    const instance = instanceRow ? this.toLegacyInstance(instanceRow) : null
    if (!instance) throw new BadRequestException('仅审批中的实例允许节点退回')
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const targetIndex = snapshot.findIndex((node) => node.nodeId === dto.returnToNodeId)
    if (targetIndex < 0) throw new BadRequestException('退回目标不属于当前审批实例的冻结流程版本')
    if (targetIndex >= sourceTask.nodeIndex)
      throw new BadRequestException('只能退回到当前节点之前的历史审批节点')
    const targetNode = snapshot[targetIndex]
    if (!targetNode?.nodeId) throw new BadRequestException('退回目标缺少稳定节点 ID')
    const targetNodeId = targetNode.nodeId

    const historicalRecord = await this.prisma8.client.orm.public.ApprovalRecords.where({
      tenantId: user.tenantId,
      instanceId: instance.id,
      nodeId: targetNodeId,
    })
      .select('id')
      .first()
    if (!historicalRecord) throw new BadRequestException('只能退回到已经执行过的历史审批节点')

    const submitter = await this.prisma8.client.orm.public.Users.where({
      id: instance.submitterId,
    })
      .select('deptId', 'leaderId')
      .first()
    const approvers = await this.resolveApprovers(
      instance.tenantId,
      targetNode,
      instance.submitterId,
      submitter?.deptId ?? null,
      submitter?.leaderId ?? null,
    )
    if (!approvers.length) throw new BadRequestException('退回目标节点当前没有可用审批人')
    const ccUserIds = [...new Set(targetNode.ccUserIds ?? [])].filter(
      (id) => id !== instance.submitterId,
    )
    const [taskRound, recordRound] = await Promise.all([
      this.prisma8.client.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
        nodeId: targetNodeId,
      })
        .select('nodeRound')
        .orderBy((row) => row.nodeRound.desc())
        .first(),
      this.prisma8.client.orm.public.ApprovalRecords.where({
        instanceId: instance.id,
        nodeId: targetNodeId,
      })
        .select('nodeRound')
        .orderBy((row) => row.nodeRound.desc())
        .first(),
    ])
    const nextRound = Math.max(taskRound?.nodeRound ?? 0, recordRound?.nodeRound ?? 0) + 1
    const normalizedComment = dto.comment?.trim() || null
    const normalizedAttachmentIds = await this.ensureActionAttachmentIds(user, dto.attachmentIds)
    const backRecordId = randomUUID()
    const updatedAt = prisma8Now()

    await this.prisma8.client.transaction(async (tx) => {
      const liveInstance = await tx.orm.public.ApprovalInstances.where({
        id: instance.id,
        tenantId: user.tenantId,
        status: 'PENDING',
      })
        .select('id')
        .first()
      const stillPending = await tx.orm.public.ApprovalTasks.where({
        id: sourceTask.id,
        tenantId: user.tenantId,
        approverId: user.id,
        status: 'PENDING',
        action: null,
      })
        .select('id')
        .first()
      if (!liveInstance || !stillPending) throw new BadRequestException('待办任务不存在或已处理')

      await tx.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
        status: 'PENDING',
      })
        .where((task) => task.nodeIndex.gt(targetIndex))
        .where((task) => task.nodeIndex.lte(sourceTask.nodeIndex))
        .updateAll({ status: 'SKIPPED', updatedAt })
      const returnedSource = await tx.orm.public.ApprovalTasks.where({ id: sourceTask.id }).update({
        status: 'PENDING',
        action: 'BACK',
        handledAt: updatedAt,
        updatedAt,
      })
      if (!returnedSource) throw new BadRequestException('待办任务不存在或已处理')

      await tx.orm.public.ApprovalTasks.createAll(
        approvers.map((approverId) => ({
          tenantId: instance.tenantId,
          instanceId: instance.id,
          nodeId: targetNodeId,
          nodeIndex: targetIndex,
          nodeRound: nextRound,
          nodeName: targetNode.name,
          approverId,
          taskType: 'APPROVAL' as const,
          updatedAt,
        })),
      )
      if (ccUserIds.length) {
        await tx.orm.public.ApprovalTasks.createAll(
          ccUserIds.map((approverId) => ({
            tenantId: instance.tenantId,
            instanceId: instance.id,
            nodeId: targetNodeId,
            nodeIndex: targetIndex,
            nodeRound: nextRound,
            nodeName: targetNode.name,
            approverId,
            taskType: 'CC' as const,
            updatedAt,
          })),
        )
      }
      const previousBackRecords = await tx.orm.public.ApprovalReturnBackRecords.where({
        tenantId: user.tenantId,
        instanceId: instance.id,
        returnToNodeId: targetNodeId,
      })
        .select('id')
        .all()
      if (previousBackRecords.length) {
        const previousIds = previousBackRecords.map((record) => record.id)
        await tx.orm.public.ApprovalInstanceAttachments.where({
          tenantId: user.tenantId,
          instanceId: instance.id,
        })
          .where((relation) => relation.elementId.in(previousIds))
          .deleteAll()
      }
      await tx.orm.public.ApprovalReturnBackRecords.where({
        tenantId: user.tenantId,
        instanceId: instance.id,
        returnToNodeId: targetNodeId,
      }).deleteAll()
      await tx.orm.public.ApprovalReturnBackRecords.create({
        id: backRecordId,
        tenantId: user.tenantId,
        instanceId: instance.id,
        taskId: sourceTask.id,
        returnToNodeId: targetNodeId,
        returnReason: normalizedComment,
        returnUserId: user.id,
        updatedAt,
      })
      await this.saveActionAttachmentRelationsPrisma8(
        tx,
        user.tenantId,
        instance.id,
        backRecordId,
        normalizedAttachmentIds,
      )
      const moved = await tx.orm.public.ApprovalInstances.where({ id: instance.id }).update({
        currentNodeIndex: targetIndex,
        updatedAt,
      })
      if (!moved) throw new BadRequestException('审批实例状态已变化，请刷新后重试')
    })

    await this.notifications.notifyMany(instance.tenantId, approvers, {
      type: 'approval',
      title: '审批已退回到你的节点',
      content: `${user.name} 将「${instance.targetName}」退回到「${targetNode.name}」重新审批`,
      link: '/approvals',
    })
    if (ccUserIds.length) {
      await this.notifications.notifyMany(instance.tenantId, ccUserIds, {
        type: 'approval',
        title: '审批退回节点抄送',
        content: `「${instance.targetName}」已退回到「${targetNode.name}」`,
        link: '/approvals?tab=copied',
      })
    }
    return {
      id: sourceTask.id,
      name: instance.targetName,
      returnToNodeId: targetNodeId,
      nodeRound: nextRound,
    }
  }

  async revokeTask(user: AuthUser, taskId: string) {
    const updatedAt = prisma8Now()
    return this.prisma8.client.transaction(async (tx) => {
      const sourceTask = await tx.orm.public.ApprovalTasks.where({
        id: taskId,
        tenantId: user.tenantId,
        approverId: user.id,
        taskType: 'APPROVAL',
        status: 'APPROVED',
        action: 'APPROVE',
      }).first()
      if (!sourceTask) throw new NotFoundException('可撤回的已办任务不存在')

      const instance = await tx.orm.public.ApprovalInstances.where({
        id: sourceTask.instanceId,
        tenantId: user.tenantId,
        status: 'PENDING',
      }).first()
      if (!instance) throw new BadRequestException('仅审批中的实例允许撤回审批任务')
      if (!instance.flowId) throw new BadRequestException('审批实例缺少流程引用，不能撤回审批任务')
      const tasks = await tx.orm.public.ApprovalTasks.where({ instanceId: instance.id }).all()

      const flow = await tx.orm.public.ApprovalFlows.where({
        id: instance.flowId,
        tenantId: user.tenantId,
        deletedAt: null,
      })
        .select('allowWithdraw')
        .first()
      if (!flow?.allowWithdraw) throw new BadRequestException('当前审批流未开启审批人撤回')
      if (!this.isTaskWithdrawable(instance, tasks, sourceTask, true)) {
        throw new BadRequestException('当前审批任务已无法撤回')
      }

      // Cordys clearExpiredNode 会让下游当前轮次失效；MicroMatrix 保留历史 round，
      // 仅把仍活动的待办置为 SKIPPED，下一次 advance 以新 nodeRound 重建。
      if (instance.currentNodeIndex > sourceTask.nodeIndex) {
        await tx.orm.public.ApprovalTasks.where({
          instanceId: instance.id,
          tenantId: user.tenantId,
          status: 'PENDING',
        })
          .where((task) => task.nodeIndex.gt(sourceTask.nodeIndex))
          .where((task) => task.nodeIndex.lte(instance.currentNodeIndex))
          .updateAll({ status: 'SKIPPED', updatedAt })
      }

      const reopened = await tx.orm.public.ApprovalTasks.where({
        id: sourceTask.id,
        tenantId: user.tenantId,
        approverId: user.id,
        taskType: 'APPROVAL',
        status: 'APPROVED',
        action: 'APPROVE',
      }).update({ status: 'PENDING', action: null, handledAt: null, updatedAt })
      if (!reopened) throw new BadRequestException('审批任务状态已变化，请刷新后重试')

      const moved = await tx.orm.public.ApprovalInstances.where({ id: instance.id }).update({
        currentNodeIndex: sourceTask.nodeIndex,
        updatedAt,
      })
      if (!moved) throw new BadRequestException('审批实例状态已变化，请刷新后重试')

      return {
        id: sourceTask.id,
        name: instance.targetName,
        nodeId: sourceTask.nodeId,
        nodeRound: sourceTask.nodeRound,
      }
    })
  }

  async rejectTask(user: AuthUser, taskId: string, comment?: string, attachmentIds?: string[]) {
    const task = await this.ensurePendingTask(user, taskId)
    const normalizedComment = comment?.trim() || null
    const normalizedAttachmentIds = await this.ensureActionAttachmentIds(user, attachmentIds)
    if ((await this.requireCommentForInstance(user, task.instanceId)) && !normalizedComment) {
      throw new BadRequestException('当前审批流要求填写审批意见')
    }
    const handledAt = new Date()

    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: task.instanceId,
    }).first()
    if (!instanceRow) throw new NotFoundException('审批实例不存在')
    const instance = this.toLegacyInstance(instanceRow)
    const updatedAt = prisma8Now()
    await this.prisma8.client.transaction(async (tx) => {
      const updated = await tx.orm.public.ApprovalTasks.where({ id: taskId }).update({
        status: 'REJECTED',
        action: 'REJECT',
        handledAt: prisma8TimestampFromDate(handledAt),
        updatedAt,
      })
      if (!updated) throw new BadRequestException('审批任务状态已变化，请刷新后重试')
      await this.saveApprovalRecordPrisma8(
        tx,
        user,
        task,
        'REJECT',
        normalizedComment,
        normalizedAttachmentIds,
        updatedAt,
      )
      await tx.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
        status: 'PENDING',
      }).updateAll({ status: 'SKIPPED', updatedAt })
      const rejected = await tx.orm.public.ApprovalInstances.where({ id: instance.id }).update({
        status: 'REJECTED',
        finishedAt: updatedAt,
        updatedAt,
      })
      if (!rejected) throw new BadRequestException('审批实例状态已变化，请刷新后重试')
    })
    await this.resources.setBizStatus(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      'REJECTED',
    )
    await this.restorePreUpdateSnapshot(instance, user.id)
    await this.applyNodePostFieldUpdates(instance, task.nodeIndex, 'REJECT', user.id)
    await this.sendApprovalResult(instance, user.id, 'UNAPPROVED', {
      title: '审批被驳回',
      content: `「${instance.targetName}」被 ${user.name} 驳回：${normalizedComment}`,
    })
    return { id: taskId, name: instance.targetName }
  }

  async cancel(user: AuthUser, instanceId: string) {
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: instanceId,
      tenantId: user.tenantId,
    }).first()
    const instance = instanceRow ? this.toLegacyInstance(instanceRow) : null
    if (!instance) throw new NotFoundException('审批不存在')
    if (instance.submitterId !== user.id) throw new BadRequestException('仅发起人可撤回')
    if (instance.status !== 'PENDING') throw new BadRequestException('仅审批中的申请可撤回')

    const finishedAt = prisma8Now()
    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.ApprovalTasks.where({ instanceId, status: 'PENDING' }).updateAll({
        status: 'SKIPPED',
        updatedAt: finishedAt,
      })
      const updated = await tx.orm.public.ApprovalInstances.where({ id: instanceId }).update({
        status: 'CANCELED',
        finishedAt,
        updatedAt: finishedAt,
      })
      if (!updated) throw new NotFoundException('审批不存在')
    })
    await this.resources.setBizStatus(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      instance.module === 'quote' ||
        instance.module === 'contract' ||
        instance.module === 'invoice' ||
        instance.module === 'order'
        ? 'REVOKED'
        : 'NONE',
    )
    await this.restorePreUpdateSnapshot(instance, user.id)
    return { id: instanceId, name: instance.targetName }
  }

  async handleTargetApproval(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    status: string,
    comment?: string,
  ) {
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      tenantId: user.tenantId,
      module,
      targetId,
      status: 'PENDING',
    })
      .orderBy((row) => row.createdAt.desc())
      .first()
    const instance = instanceRow ? this.toLegacyInstance(instanceRow) : null
    if (!instance) throw new BadRequestException('该业务单据当前没有审批中的申请')

    const taskRow = await this.prisma8.client.orm.public.ApprovalTasks.where({
      instanceId: instance.id,
      approverId: user.id,
      taskType: 'APPROVAL',
      status: 'PENDING',
    })
      .orderBy((row) => row.createdAt.asc())
      .first()
    const task = taskRow ? this.toLegacyTask(taskRow) : null
    if (!task) throw new BadRequestException('当前用户没有该单据的待审批任务')

    if (status === 'APPROVED') return this.approveTask(user, task.id, comment)
    if (status === 'UNAPPROVED' || status === 'REJECTED') {
      return this.rejectTask(user, task.id, comment?.trim() || '审批未通过')
    }
    throw new BadRequestException('不支持的审批状态')
  }

  async cancelTarget(user: AuthUser, module: ApprovalModule, targetId: string) {
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      tenantId: user.tenantId,
      module,
      targetId,
      submitterId: user.id,
      status: 'PENDING',
    })
      .orderBy((row) => row.createdAt.desc())
      .first()
    const instance = instanceRow ? this.toLegacyInstance(instanceRow) : null
    if (!instance) throw new BadRequestException('该业务单据当前没有可撤回的审批申请')
    return this.cancel(user, instance.id)
  }

  // ===== 查询 =====

  async myPending(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const query = this.prisma8.client.orm.public.ApprovalTasks.where({
      tenantId: user.tenantId,
      approverId: user.id,
      status: 'PENDING',
    })
      .where((task) => task.taskType.in(['APPROVAL', 'SIGN']))
      .where((task) => or(task.action.isNull(), not(task.action.in(['SIGN', 'BACK']))))
    const [taskRows, aggregate] = await Promise.all([
      query
        .orderBy((task) => task.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((agg) => ({ count: agg.count() })),
    ])
    const hydrated = await this.hydrateTaskInstances(taskRows)
    const items = await Promise.all(
      taskRows.flatMap((task) => {
        const context = hydrated.get(task.instanceId)
        return context ? [this.toInstanceVO(context.instance, context.tasks, user)] : []
      }),
    )
    const total = aggregate.count
    return { items, total, page, pageSize }
  }

  async myApplications(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const query = this.prisma8.client.orm.public.ApprovalInstances.where({
      tenantId: user.tenantId,
      submitterId: user.id,
    })
    const [instanceRows, aggregate] = await Promise.all([
      query
        .orderBy((instance) => instance.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((agg) => ({ count: agg.count() })),
    ])
    const tasksByInstance = await this.tasksByInstance(instanceRows.map((instance) => instance.id))
    const items = await Promise.all(
      instanceRows.map((instance) =>
        this.toInstanceVO(
          this.toLegacyInstance(instance),
          tasksByInstance.get(instance.id) ?? [],
          user,
        ),
      ),
    )
    const total = aggregate.count
    return { items, total, page, pageSize }
  }

  /** 已办：我处理过的 */
  async myHandled(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const query = this.prisma8.client.orm.public.ApprovalTasks.where({
      tenantId: user.tenantId,
      approverId: user.id,
    })
      .where((task) => task.taskType.in(['APPROVAL', 'SIGN']))
      .where((task) =>
        or(
          task.status.in(['APPROVED', 'REJECTED']),
          and(task.status.eq('PENDING'), task.action.eq('BACK')),
        ),
      )
    const [taskRows, aggregate] = await Promise.all([
      query
        .orderBy((task) => task.handledAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((agg) => ({ count: agg.count() })),
    ])
    const hydrated = await this.hydrateTaskInstances(taskRows)
    const items = await Promise.all(
      taskRows.flatMap((task) => {
        const context = hydrated.get(task.instanceId)
        return context ? [this.toInstanceVO(context.instance, context.tasks, user)] : []
      }),
    )
    const total = aggregate.count
    return { items, total, page, pageSize }
  }

  /** Cordys approval_task.type=cc：抄送记录与审批待办共用 approval_task 数据源。 */
  async myCopied(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const query = this.prisma8.client.orm.public.ApprovalTasks.where({
      tenantId: user.tenantId,
      approverId: user.id,
      taskType: 'CC',
    })
    const [taskRows, aggregate] = await Promise.all([
      query
        .orderBy((task) => task.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((agg) => ({ count: agg.count() })),
    ])
    const hydrated = await this.hydrateTaskInstances(taskRows)
    const items = await Promise.all(
      taskRows.flatMap((task) => {
        const context = hydrated.get(task.instanceId)
        return context ? [this.toInstanceVO(context.instance, context.tasks, user)] : []
      }),
    )
    const total = aggregate.count
    return { items, total, page, pageSize }
  }

  /** 某业务对象的最新审批实例（详情时间线） */
  async instanceForTarget(
    user: AuthUser,
    module: string,
    targetId: string,
  ): Promise<ApprovalInstanceVO | null> {
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      tenantId: user.tenantId,
      module,
      targetId,
    })
      .orderBy((instance) => instance.createdAt.desc())
      .first()
    if (!instanceRow) return null
    const tasks = (await this.prisma8.client.orm.public.ApprovalTasks.where({
      instanceId: instanceRow.id,
    }).all()).map((task) => this.toLegacyTask(task))
    return this.toInstanceVO(this.toLegacyInstance(instanceRow), tasks, user)
  }

  async instanceDetail(user: AuthUser, instanceId: string): Promise<ApprovalInstanceVO> {
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: instanceId,
      tenantId: user.tenantId,
    }).first()
    if (!instanceRow) throw new NotFoundException('审批实例不存在')
    const taskRows = await this.prisma8.client.orm.public.ApprovalTasks.where({
      instanceId,
      tenantId: user.tenantId,
    }).all()
    const accessible =
      instanceRow.submitterId === user.id || taskRows.some((task) => task.approverId === user.id)
    if (!accessible) throw new NotFoundException('审批实例不存在')
    return this.toInstanceVO(
      this.toLegacyInstance(instanceRow),
      taskRows.map((task) => this.toLegacyTask(task)),
      user,
      true,
    )
  }

  // ===== 引擎内部 =====

  /** 推进到下一个有审批人的节点；全部走完则通过 */
  private async advance(instanceId: string, operatorId?: string) {
    const instanceRow = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: instanceId,
    }).first()
    if (!instanceRow) throw new NotFoundException('审批实例不存在')
    const instance = this.toLegacyInstance(instanceRow)
    if (instance.status !== 'PENDING') return
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const submitter = await this.prisma8.client.orm.public.Users.where({
      id: instance.submitterId,
    })
      .select('deptId', 'leaderId')
      .first()
    if (!instance.flowId) throw new BadRequestException('审批实例缺少流程引用')
    const flowPolicy = await this.prisma8.client.orm.public.ApprovalFlows.where({
      id: instance.flowId,
      tenantId: instance.tenantId,
      deletedAt: null,
    })
      .select('duplicateApproverRule')
      .first()
    if (!flowPolicy) throw new BadRequestException('审批实例关联流程不存在')
    const duplicateApproverRule = flowPolicy.duplicateApproverRule

    let nodeIndex = instance.currentNodeIndex
    for (;;) {
      nodeIndex += 1
      if (nodeIndex >= snapshot.length) {
        await this.finalizeApproved(instance, operatorId)
        return
      }
      const node = snapshot[nodeIndex]
      let approvers = await this.resolveApprovers(
        instance.tenantId,
        node,
        instance.submitterId,
        submitter?.deptId ?? null,
        submitter?.leaderId ?? null,
      )
      const skippedApprovers = new Map<string, string>()
      let autoPassNode = false
      let nodeAutoPassReason: string | null = null

      if (approvers.length === 0) {
        if ((node.emptyApproverAction ?? 'AUTO_PASS') === 'AUTO_PASS') {
          autoPassNode = true
          nodeAutoPassReason = '审批人为空，自动通过'
        } else {
          const fallback = node.fallbackApprover?.trim()
          const activeFallback = fallback
            ? await this.prisma8.client.orm.public.Users.where({
                id: fallback,
                tenantId: instance.tenantId,
                status: 'ACTIVE',
              })
                .select('id')
                .first()
            : null
          if (!activeFallback) {
            throw new BadRequestException(`审批节点「${node.name}」的兜底审批人不存在或已停用`)
          }
          approvers = [activeFallback.id]
        }
      }

      if (!autoPassNode && approvers.includes(instance.submitterId)) {
        const sameAction = node.sameSubmitterAction ?? 'ALLOW'
        if (sameAction === 'ASSIGN_SUPERIOR') {
          const superior = submitter?.leaderId
            ? await this.prisma8.client.orm.public.Users.where({
                id: submitter.leaderId,
                tenantId: instance.tenantId,
                status: 'ACTIVE',
              })
                .select('id')
                .first()
            : null
          if (!superior) {
            skippedApprovers.set(
              instance.submitterId,
              '审批人与提交人为同一人时，直属上级为空，自动通过',
            )
            autoPassNode = true
          } else {
            approvers = [
              ...new Set(
                approvers.map((approverId) =>
                  approverId === instance.submitterId ? superior.id : approverId,
                ),
              ),
            ]
          }
        } else if (sameAction === 'SKIP') {
          skippedApprovers.set(instance.submitterId, '审批人与提交人为同一人，自动通过')
          if (approvers.length === 1 || node.mode === 'ANY') {
            autoPassNode = true
          } else {
            approvers = approvers.filter((approverId) => approverId !== instance.submitterId)
          }
        }
      }

      if (!autoPassNode && approvers.length) {
        const duplicates = await this.duplicateApproversToSkip(
          instance,
          nodeIndex,
          node.nodeId ?? null,
          duplicateApproverRule,
          approvers,
        )
        if (duplicates.size) {
          for (const id of duplicates) {
            if (!skippedApprovers.has(id)) {
              skippedApprovers.set(id, '审批人重复出现，后续节点自动通过')
            }
          }
          if (approvers.length === 1 || node.mode === 'ANY') {
            autoPassNode = true
          } else {
            approvers = approvers.filter((approverId) => !duplicates.has(approverId))
          }
        }
      }

      const ccUserIds = [...new Set(node.ccUserIds ?? [])].filter(
        (userId) => userId !== instance.submitterId,
      )
      const nodeRound = await this.nextApprovalNodeRound(instance.id, node.nodeId ?? null)
      const handledAt = prisma8Now()
      const skippedFacts = [...skippedApprovers.entries()].map(([approverId, comment]) => ({
        taskId: randomUUID(),
        approverId,
        comment,
      }))
      const autoTaskRows = skippedFacts.map((fact) => ({
        id: fact.taskId,
        tenantId: instance.tenantId,
        instanceId,
        nodeId: node.nodeId ?? null,
        nodeIndex,
        nodeRound,
        nodeName: node.name,
        approverId: fact.approverId,
        taskType: 'APPROVAL' as const,
        status: 'SKIPPED' as const,
        action: 'APPROVE' as const,
        handledAt,
      }))
      const autoRecordRows: Array<{
        tenantId: string
        instanceId: string
        taskId: string | null
        nodeId: string | null
        nodeRound: number
        result: 'APPROVE'
        comment: string | null
        createdById: string
      }> = skippedFacts.map((fact) => ({
        tenantId: instance.tenantId,
        instanceId,
        taskId: fact.taskId,
        nodeId: node.nodeId ?? null,
        nodeRound,
        result: 'APPROVE' as const,
        comment: fact.comment,
        createdById: 'SYSTEM',
      }))
      if (autoPassNode && skippedFacts.length === 0) {
        autoRecordRows.push({
          tenantId: instance.tenantId,
          instanceId,
          taskId: null,
          nodeId: node.nodeId ?? null,
          nodeRound,
          result: 'APPROVE',
          comment: nodeAutoPassReason ?? '审批节点自动通过',
          createdById: 'SYSTEM',
        })
      }

      if (autoPassNode || approvers.length === 0) {
        await this.prisma8.client.transaction(async (tx) => {
          const moved = await tx.orm.public.ApprovalInstances.where({ id: instanceId }).update({
            currentNodeIndex: nodeIndex,
            updatedAt: handledAt,
          })
          if (!moved) throw new BadRequestException('审批实例状态已变化，请刷新后重试')
          if (autoTaskRows.length) {
            await tx.orm.public.ApprovalTasks.createAll(
              autoTaskRows.map((row) => ({ ...row, updatedAt: handledAt })),
            )
          }
          if (autoRecordRows.length) {
            await tx.orm.public.ApprovalRecords.createAll(
              autoRecordRows.map((row) => ({ ...row, updatedAt: handledAt })),
            )
          }
          if (ccUserIds.length) {
            await tx.orm.public.ApprovalTasks.createAll(
              ccUserIds.map((approverId) => ({
                tenantId: instance.tenantId,
                instanceId,
                nodeId: node.nodeId ?? null,
                nodeIndex,
                nodeRound,
                nodeName: node.name,
                approverId,
                taskType: 'CC' as const,
                updatedAt: handledAt,
              })),
            )
          }
        })
        if (ccUserIds.length) {
          await this.notifications.notifyMany(instance.tenantId, ccUserIds, {
            type: 'approval',
            title: '有新的审批抄送给你',
            content: `${instance.submitterName} 提交的「${instance.targetName}」已抄送给你`,
            link: '/approvals?tab=copied',
          })
        }
        await this.applyNodePostFieldUpdates(
          instance,
          nodeIndex,
          'APPROVE',
          operatorId ?? instance.submitterId,
        )
        continue
      }

      await this.prisma8.client.transaction(async (tx) => {
        const moved = await tx.orm.public.ApprovalInstances.where({ id: instanceId }).update({
          currentNodeIndex: nodeIndex,
          updatedAt: handledAt,
        })
        if (!moved) throw new BadRequestException('审批实例状态已变化，请刷新后重试')
        await tx.orm.public.ApprovalTasks.createAll(
          approvers.map((approverId) => ({
            tenantId: instance.tenantId,
            instanceId,
            nodeId: node.nodeId ?? null,
            nodeIndex,
            nodeRound,
            nodeName: node.name,
            approverId,
            taskType: 'APPROVAL' as const,
            updatedAt: handledAt,
          })),
        )
        if (autoTaskRows.length) {
          await tx.orm.public.ApprovalTasks.createAll(
            autoTaskRows.map((row) => ({ ...row, updatedAt: handledAt })),
          )
        }
        if (autoRecordRows.length) {
          await tx.orm.public.ApprovalRecords.createAll(
            autoRecordRows.map((row) => ({ ...row, updatedAt: handledAt })),
          )
        }
        if (ccUserIds.length) {
          await tx.orm.public.ApprovalTasks.createAll(
            ccUserIds.map((approverId) => ({
              tenantId: instance.tenantId,
              instanceId,
              nodeId: node.nodeId ?? null,
              nodeIndex,
              nodeRound,
              nodeName: node.name,
              approverId,
              taskType: 'CC' as const,
              updatedAt: handledAt,
            })),
          )
        }
      })
      await this.notifications.notifyMany(instance.tenantId, approvers, {
        type: 'approval',
        title: '有新的审批待处理',
        content: `${instance.submitterName} 提交的「${instance.targetName}」等待你审批`,
        link: '/approvals',
      })
      if (ccUserIds.length) {
        await this.notifications.notifyMany(instance.tenantId, ccUserIds, {
          type: 'approval',
          title: '有新的审批抄送给你',
          content: `${instance.submitterName} 提交的「${instance.targetName}」已抄送给你`,
          link: '/approvals?tab=copied',
        })
      }
      return
    }
  }

  private async finalizeApproved(instance: ApprovalInstance, operatorId?: string) {
    const finishedAt = prisma8Now()
    await this.prisma8.client.orm.public.ApprovalInstances.where({ id: instance.id }).update({
      status: 'APPROVED',
      finishedAt,
      updatedAt: finishedAt,
    })
    await this.resources.setBizStatus(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      'APPROVED',
    )
    await this.resources.effectApproved(instance)
    await this.sendApprovalResult(instance, operatorId, 'APPROVED', {
      title: '审批已通过',
      content: `「${instance.targetName}」已审批通过`,
    })
  }

  private approvalResultEvent(module: string): MessageTaskEvent | undefined {
    if (module === 'quote') return 'BUSINESS_QUOTATION_APPROVAL'
    if (module === 'contract') return 'CONTRACT_APPROVAL'
    if (module === 'order') return 'ORDER_APPROVAL'
    if (module === 'invoice') return 'INVOICE_APPROVAL'
    return undefined
  }

  private async sendApprovalResult(
    instance: ApprovalInstance,
    operatorId: string | undefined,
    state: 'APPROVED' | 'UNAPPROVED',
    message: { title: string; content: string },
  ) {
    const event = this.approvalResultEvent(instance.module)
    if (event) {
      await this.businessNotifications.send({
        tenantId: instance.tenantId,
        event,
        operatorId,
        recipientIds: [instance.submitterId],
        excludeSelf: true,
        type: 'approval',
        templateContext: {
          type: instance.module === 'quote' ? 'quotation' : instance.module,
          name: instance.targetName,
          state,
        },
        link: '/approvals',
      })
      return
    }
    await this.notifications.notify(instance.tenantId, instance.submitterId, {
      type: 'approval',
      ...message,
      link: '/approvals',
    })
  }

  private async resolveApprovers(
    tenantId: string,
    node: ApprovalNodeConfig,
    submitterId: string,
    submitterDeptId: string | null,
    submitterLeaderId: string | null,
  ): Promise<string[]> {
    let ids: string[] = []
    switch (node.approverType) {
      case 'USER':
        ids = node.approverIds
        break
      case 'ROLE': {
        const roleRows = node.approverIds.length
          ? await this.prisma8.client.orm.public.UserRoles.where({ tenantId })
              .where((row) => row.roleId.in(node.approverIds))
              .select('userId')
              .all()
          : []
        ids = [...new Set(roleRows.map((row) => row.userId))]
        break
      }
      case 'DEPT_LEADER': {
        const chain = await this.departmentLeaderChain(tenantId, submitterDeptId)
        ids = this.selectHierarchyApprovers(
          chain,
          this.approverLevel(node),
          node.approverDirection,
          false,
        )
        break
      }
      case 'MULTIPLE_DEPT_LEADER': {
        const chain = await this.departmentLeaderChain(tenantId, submitterDeptId)
        ids = this.selectHierarchyApprovers(
          chain,
          this.approverLevel(node),
          node.approverDirection,
          true,
        )
        break
      }
      case 'DIRECT_LEADER': {
        const chain = await this.directLeaderChain(tenantId, submitterId, submitterLeaderId)
        ids = this.selectHierarchyApprovers(
          chain,
          this.approverLevel(node),
          node.approverDirection,
          false,
        )
        break
      }
      case 'MULTIPLE_DIRECT_LEADER': {
        const chain = await this.directLeaderChain(tenantId, submitterId, submitterLeaderId)
        ids = this.selectHierarchyApprovers(
          chain,
          this.approverLevel(node),
          node.approverDirection,
          true,
        )
        break
      }
    }
    if (ids.length === 0) return []
    const uniqueIds = [...new Set(ids)]
    const active = await this.prisma8.client.orm.public.Users.where({
      tenantId,
      status: 'ACTIVE',
    })
      .where((user) => user.id.in(uniqueIds))
      .select('id')
      .all()
    const activeIds = new Set(active.map((user) => user.id))
    return uniqueIds.filter((id) => activeIds.has(id))
  }

  private approverLevel(node: ApprovalNodeConfig) {
    const raw = node.approverIds?.[0]
    if (!raw) return 1
    const level = Number(raw)
    return Number.isInteger(level) && level >= 1 && level <= 10 ? level : 0
  }

  private async directLeaderChain(
    tenantId: string,
    submitterId: string,
    firstLeaderId: string | null,
  ): Promise<Array<string | null>> {
    const chain: Array<string | null> = []
    const visited = new Set<string>([submitterId])
    let currentLeaderId = firstLeaderId
    while (currentLeaderId && chain.length < 50 && !visited.has(currentLeaderId)) {
      chain.push(currentLeaderId)
      visited.add(currentLeaderId)
      const leader = await this.prisma8.client.orm.public.Users.where({
        id: currentLeaderId,
        tenantId,
      })
        .select('leaderId')
        .first()
      if (!leader) break
      currentLeaderId = leader.leaderId
    }
    return chain
  }

  private async departmentLeaderChain(
    tenantId: string,
    submitterDeptId: string | null,
  ): Promise<Array<string | null>> {
    const chain: Array<string | null> = []
    const visited = new Set<string>()
    let deptId = submitterDeptId
    while (deptId && chain.length < 50 && !visited.has(deptId)) {
      visited.add(deptId)
      const dept = await this.prisma8.client.orm.public.Departments.where({ id: deptId, tenantId })
        .select('leaderId', 'parentId')
        .first()
      if (!dept) break
      chain.push(dept.leaderId)
      deptId = dept.parentId
    }
    return chain
  }

  private selectHierarchyApprovers(
    bottomUpIds: Array<string | null>,
    level: number,
    direction: ApprovalNodeConfig['approverDirection'],
    multiple: boolean,
  ): string[] {
    if (level <= 0 || level > bottomUpIds.length) return []
    if (!multiple) {
      const index = direction === 'TOP_DOWN' ? bottomUpIds.length - level : level - 1
      const id = bottomUpIds[index]
      return id ? [id] : []
    }
    const ordered = direction === 'TOP_DOWN' ? [...bottomUpIds].reverse() : bottomUpIds
    return ordered.slice(0, level).filter((id): id is string => Boolean(id))
  }

  private async duplicateApproversToSkip(
    instance: ApprovalInstance,
    nodeIndex: number,
    nodeId: string | null,
    rule: 'FIRST_ONLY' | 'SEQUENTIAL_ALL' | 'EACH',
    approvers: string[],
  ): Promise<Set<string>> {
    if (rule === 'EACH' || approvers.length === 0) return new Set()
    let previousApproverIds: string[] = []
    if (rule === 'FIRST_ONLY') {
      let query = this.prisma8.client.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
        status: 'APPROVED',
      }).where((task) => task.taskType.in(['APPROVAL', 'SIGN']))
      query = nodeId
        ? query.where((task) => or(task.nodeId.isNull(), task.nodeId.neq(nodeId)))
        : query.where((task) => task.nodeIndex.neq(nodeIndex))
      const approved = await query.select('approverId').all()
      previousApproverIds = approved.map((task) => task.approverId)
    } else if (nodeIndex > 0) {
      const maxRound = await this.prisma8.client.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
        nodeIndex: nodeIndex - 1,
      })
        .select('nodeRound')
        .orderBy((task) => task.nodeRound.desc())
        .first()
      if (maxRound) {
        const approved = await this.prisma8.client.orm.public.ApprovalTasks.where({
          instanceId: instance.id,
          nodeIndex: nodeIndex - 1,
          nodeRound: maxRound.nodeRound,
          status: 'APPROVED',
        })
          .where((task) => task.taskType.in(['APPROVAL', 'SIGN']))
          .select('approverId')
          .all()
        previousApproverIds = approved.map((task) => task.approverId)
      }
    }
    const previous = new Set(previousApproverIds)
    return new Set(approvers.filter((approverId) => previous.has(approverId)))
  }

  private async resolveApprovalPath(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    version: RuntimeFlowVersion,
    updateFields: Set<string>,
  ): Promise<ApprovalNodeConfig[]> {
    const hasConditionGraph = version.nodes.some(
      (node) => node.nodeType === 'CONDITION' || node.nodeType === 'DEFAULT',
    )
    if (!hasConditionGraph) {
      return version.nodes
        .filter((node) => node.nodeType === 'APPROVER' && node.approver)
        .map((node) => this.toFrozenApproverNode(node))
    }

    const fieldValues = await this.resources.conditionFieldValues(user, module, targetId)
    const nodeMap = new Map(version.nodes.map((node) => [node.id, node]))
    const outgoing = new Map<string, typeof version.links>()
    for (const link of version.links) {
      const list = outgoing.get(link.fromNodeId) ?? []
      list.push(link)
      outgoing.set(link.fromNodeId, list)
    }
    for (const links of outgoing.values()) links.sort((a, b) => a.sort - b.sort)

    const start = version.nodes.find((node) => node.nodeType === 'START')
    if (!start) throw new BadRequestException('审批流程版本缺少 START 节点')
    const path: ApprovalNodeConfig[] = []
    let current = start
    let guard = 0
    while (current.nodeType !== 'END') {
      guard += 1
      if (guard > Math.max(version.nodes.length * 2, 10)) {
        throw new BadRequestException('审批流程条件图存在循环或无法收敛')
      }
      const links = outgoing.get(current.id) ?? []
      if (!links.length) throw new BadRequestException(`审批节点「${current.name}」缺少后继节点`)
      const targets = links
        .map((link) => nodeMap.get(link.toNodeId))
        .filter((node): node is RuntimeFlowVersion['nodes'][number] => Boolean(node))
      if (!targets.length) throw new BadRequestException('审批流程存在无效节点连接')

      let next: RuntimeFlowVersion['nodes'][number] | undefined
      if (targets.some((node) => node.nodeType === 'CONDITION')) {
        let defaultNode: RuntimeFlowVersion['nodes'][number] | undefined
        for (const target of targets) {
          if (target.nodeType === 'DEFAULT') {
            defaultNode = target
            continue
          }
          if (target.nodeType !== 'CONDITION') continue
          const config = target.condition
            ?.conditionConfig as unknown as ApprovalConditionConfig | null
          if (this.matchCondition(config, fieldValues, updateFields)) {
            next = target
            break
          }
        }
        next ??= defaultNode
        if (!next) throw new BadRequestException('审批流程条件未匹配且缺少 DEFAULT 分支')
      } else {
        next = targets[0]
      }

      current = next
      if (current.nodeType === 'APPROVER') {
        if (!current.approver)
          throw new BadRequestException(`审批节点「${current.name}」缺少审批人配置`)
        path.push(this.toFrozenApproverNode(current))
      }
    }
    return path
  }

  private toFrozenApproverNode(node: RuntimeFlowVersion['nodes'][number]): ApprovalNodeConfig {
    if (!node.approver) throw new BadRequestException(`审批节点「${node.name}」缺少审批人配置`)
    return {
      nodeId: node.id,
      name: node.name,
      approverType: node.approver.approverType,
      approverIds: node.approver.approverIds,
      ccUserIds: node.approver.ccUserIds,
      mode: node.approver.mode,
      emptyApproverAction: node.approver.emptyApproverAction,
      fallbackApprover: node.approver.fallbackApprover,
      sameSubmitterAction: node.approver.sameSubmitterAction,
      approverDirection: node.approver.approverDirection,
      fieldPermissions:
        (node.approver.fieldPermissions as unknown as ApprovalNodeConfig['fieldPermissions']) ?? [],
      passPostConfig:
        (node.approver.passPostConfig as unknown as ApprovalNodeConfig['passPostConfig']) ??
        undefined,
      rejectPostConfig:
        (node.approver.rejectPostConfig as unknown as ApprovalNodeConfig['rejectPostConfig']) ??
        undefined,
    }
  }

  private matchCondition(
    config: ApprovalConditionConfig | null | undefined,
    fieldValues: Record<string, unknown>,
    updateFields: Set<string>,
  ) {
    const conditions =
      config?.conditions?.filter((condition) => this.validCondition(condition)) ?? []
    if (!conditions.length) return false
    if ((config?.searchMode ?? 'AND') === 'AND') {
      return conditions.every((condition) =>
        this.matchSingleCondition(condition, fieldValues, updateFields),
      )
    }
    return conditions.some((condition) =>
      this.matchSingleCondition(condition, fieldValues, updateFields),
    )
  }

  private validCondition(condition: ApprovalFilterCondition) {
    if (!condition?.name?.trim() || !condition.operator) return false
    if (['EMPTY', 'NOT_EMPTY', 'NOT_EQUAL_ORIGINAL'].includes(condition.operator)) return true
    const value = condition.value
    return !(
      value === undefined ||
      value === null ||
      (typeof value === 'string' && !value.trim()) ||
      (Array.isArray(value) && value.length === 0)
    )
  }

  private matchSingleCondition(
    condition: ApprovalFilterCondition,
    fieldValues: Record<string, unknown>,
    updateFields: Set<string>,
  ) {
    const fieldName = condition.name
    if (condition.operator === 'NOT_EQUAL_ORIGINAL') {
      const fieldId = fieldName.includes('.') ? (fieldName.split('.')[1] ?? fieldName) : fieldName
      return updateFields.has(fieldId)
    }

    const actualValue = fieldValues[fieldName]
    const { operator, value: expectedValue } = this.resolveDynamicCondition(condition)
    if (fieldName.includes('.') && Array.isArray(actualValue)) {
      return actualValue.some((cell) => this.matchFieldValue(cell, expectedValue, operator))
    }
    return this.matchFieldValue(actualValue, expectedValue, operator)
  }

  private matchFieldValue(
    actualValue: unknown,
    expectedValue: unknown,
    operator: ApprovalFilterCondition['operator'],
  ) {
    if (operator === 'EMPTY') return actualValue === null || actualValue === undefined
    if (operator === 'NOT_EMPTY') return actualValue !== null && actualValue !== undefined
    if (actualValue === null || actualValue === undefined) return false
    try {
      switch (operator) {
        case 'EQUALS':
          return this.conditionEquals(actualValue, expectedValue)
        case 'NOT_EQUALS':
          return !this.conditionEquals(actualValue, expectedValue)
        case 'CONTAINS':
          return String(actualValue).includes(String(expectedValue))
        case 'NOT_CONTAINS':
          return !String(actualValue).includes(String(expectedValue))
        case 'IN':
          return this.conditionIn(actualValue, expectedValue)
        case 'NOT_IN':
          return !this.conditionIn(actualValue, expectedValue)
        case 'GT':
          return this.conditionCompare(actualValue, expectedValue) > 0
        case 'LT':
          return this.conditionCompare(actualValue, expectedValue) < 0
        case 'GE':
          return this.conditionCompare(actualValue, expectedValue) >= 0
        case 'LE':
          return this.conditionCompare(actualValue, expectedValue) <= 0
        case 'BETWEEN':
          return (
            Array.isArray(expectedValue) &&
            expectedValue.length === 2 &&
            this.conditionCompare(actualValue, expectedValue[0]) >= 0 &&
            this.conditionCompare(actualValue, expectedValue[1]) <= 0
          )
        default:
          // Cordys 当前 matchFieldValue 对 COUNT_* 等未实现 operator 同样返回 false。
          return false
      }
    } catch {
      return false
    }
  }

  private conditionEquals(actualValue: unknown, expectedValue: unknown) {
    if (Array.isArray(actualValue) && Array.isArray(expectedValue)) {
      return JSON.stringify(actualValue) === JSON.stringify(expectedValue)
    }
    // Cordys matchEquals 使用 Objects.equals：EQUALS/IN 不做数字字符串隐式转换。
    return Object.is(actualValue, expectedValue)
  }

  private conditionIn(actualValue: unknown, expectedValue: unknown) {
    if (!Array.isArray(expectedValue)) return false
    if (Array.isArray(actualValue)) {
      return actualValue.some((item) =>
        expectedValue.some((expected) => this.conditionEquals(item, expected)),
      )
    }
    return expectedValue.some((expected) => this.conditionEquals(actualValue, expected))
  }

  private conditionCompare(actualValue: unknown, expectedValue: unknown) {
    const actualNumber = this.asFiniteNumber(actualValue)
    const expectedNumber = this.asFiniteNumber(expectedValue)
    if (actualNumber !== null && expectedNumber !== null) return actualNumber - expectedNumber
    return String(actualValue).localeCompare(String(expectedValue))
  }

  private asFiniteNumber(value: unknown) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value !== 'string' || !value.trim()) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private resolveDynamicCondition(condition: ApprovalFilterCondition): {
    operator: ApprovalFilterCondition['operator']
    value: unknown
  } {
    if (condition.operator !== 'DYNAMICS' || typeof condition.value !== 'string') {
      return { operator: condition.operator, value: condition.value }
    }
    const parts = condition.value.split(',')
    if (parts.length > 1) {
      const amount = Number(parts[1])
      const unit = parts[2]
      if (!Number.isFinite(amount) || !unit) return { operator: 'DYNAMICS', value: condition.value }
      const target = new Date()
      if (unit === 'BEFORE_DAY') target.setDate(target.getDate() - amount)
      else if (unit === 'AFTER_DAY') target.setDate(target.getDate() + amount)
      else if (unit === 'BEFORE_WEEK') target.setDate(target.getDate() - amount * 7)
      else if (unit === 'AFTER_WEEK') target.setDate(target.getDate() + amount * 7)
      else if (unit === 'BEFORE_MONTH') target.setMonth(target.getMonth() - amount)
      else if (unit === 'AFTER_MONTH') target.setMonth(target.getMonth() + amount)
      else return { operator: 'DYNAMICS', value: condition.value }
      return {
        operator: unit.startsWith('BEFORE_') ? 'LT' : 'GT',
        value: target.getTime(),
      }
    }
    const range = this.dynamicDateRange(parts[0])
    return range
      ? { operator: 'BETWEEN', value: range }
      : { operator: 'DYNAMICS', value: condition.value }
  }

  private dynamicDateRange(key: string): [number, number] | null {
    const now = new Date()
    const startOfDay = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const endOfDay = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime()
    const daysRange = (from: number, to: number): [number, number] => {
      const start = new Date(now)
      start.setDate(start.getDate() + from)
      const end = new Date(now)
      end.setDate(end.getDate() + to)
      return [startOfDay(start), endOfDay(end)]
    }
    if (key === 'TODAY') return daysRange(0, 0)
    if (key === 'YESTERDAY') return daysRange(-1, -1)
    if (key === 'TOMORROW') return daysRange(1, 1)
    if (key === 'LAST_SEVEN') return [daysRange(-7, 0)[0], startOfDay(now)]
    if (key === 'SEVEN') return daysRange(0, 6)
    if (key === 'LAST_THIRTY') return [daysRange(-30, 0)[0], startOfDay(now)]
    if (key === 'THIRTY') return daysRange(0, 29)
    if (key === 'LAST_SIXTY') return [daysRange(-60, 0)[0], startOfDay(now)]
    if (key === 'SIXTY') return daysRange(0, 59)

    const day = now.getDay() || 7
    if (['WEEK', 'LAST_WEEK', 'NEXT_WEEK'].includes(key)) {
      const offset = key === 'LAST_WEEK' ? -7 : key === 'NEXT_WEEK' ? 7 : 0
      const monday = new Date(now)
      monday.setDate(now.getDate() - day + 1 + offset)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return [startOfDay(monday), endOfDay(sunday)]
    }
    if (['MONTH', 'LAST_MONTH', 'NEXT_MONTH'].includes(key)) {
      const monthOffset = key === 'LAST_MONTH' ? -1 : key === 'NEXT_MONTH' ? 1 : 0
      const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
      const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
      return [startOfDay(start), endOfDay(end)]
    }
    if (['QUARTER', 'LAST_QUARTER', 'NEXT_QUARTER'].includes(key)) {
      const currentQuarterStart = Math.floor(now.getMonth() / 3) * 3
      const offset = key === 'LAST_QUARTER' ? -3 : key === 'NEXT_QUARTER' ? 3 : 0
      const start = new Date(now.getFullYear(), currentQuarterStart + offset, 1)
      const end = new Date(start.getFullYear(), start.getMonth() + 3, 0)
      return [startOfDay(start), endOfDay(end)]
    }
    if (['YEAR', 'LAST_YEAR', 'NEXT_YEAR'].includes(key)) {
      const yearOffset = key === 'LAST_YEAR' ? -1 : key === 'NEXT_YEAR' ? 1 : 0
      const year = now.getFullYear() + yearOffset
      return [startOfDay(new Date(year, 0, 1)), endOfDay(new Date(year, 11, 31))]
    }
    return null
  }

  private async enabledFlow(
    tenantId: string,
    module: string,
    executeTiming: ApprovalExecuteTimingValue = 'CREATE',
  ) {
    const formType = MODULE_TO_FORM_TYPE[module as ApprovalModule]
    if (!formType) return null
    let query = this.prisma8.client.orm.public.ApprovalFlows.where({
      tenantId,
      formType: toDbFormType(formType),
      enabled: true,
      deletedAt: null,
    })
    query =
      executeTiming === 'CREATE'
        ? query.where({ createExecute: true })
        : executeTiming === 'UPDATE'
          ? query.where({ updateExecute: true })
          : query.where({ deleteExecute: true })
    const flow = await query.first()
    if (!flow) return null
    if (!flow.currentVersionId) return { ...flow, currentVersion: null }

    const version = await this.prisma8.client.orm.public.ApprovalFlowVersions.where({
      id: flow.currentVersionId,
      flowId: flow.id,
      tenantId,
    }).first()
    if (!version) return { ...flow, currentVersion: null }

    const [nodes, links] = await Promise.all([
      this.prisma8.client.orm.public.ApprovalNodes.where({ flowVersionId: version.id })
        .orderBy((node) => node.sort.asc())
        .all(),
      this.prisma8.client.orm.public.ApprovalNodeLinks.where({ flowVersionId: version.id })
        .orderBy((link) => link.sort.asc())
        .all(),
    ])
    const nodeIds = nodes.map((node) => node.id)
    const [approvers, conditions] = nodeIds.length
      ? await Promise.all([
          this.prisma8.client.orm.public.ApprovalNodeApprovers.where((row) =>
            row.nodeId.in(nodeIds),
          ).all(),
          this.prisma8.client.orm.public.ApprovalNodeConditions.where((row) =>
            row.id.in(nodeIds),
          ).all(),
        ])
      : [[], []]
    const approverMap = new Map(approvers.map((row) => [row.nodeId, row]))
    const conditionMap = new Map(conditions.map((row) => [row.id, row]))
    const currentVersion = {
      ...version,
      nodes: nodes.map((node) => ({
        ...node,
        approver: approverMap.get(node.id) ?? null,
        condition: conditionMap.get(node.id) ?? null,
      })),
      links,
    } as unknown as RuntimeFlowVersion
    return { ...flow, currentVersion }
  }

  /** Cordys UPDATE 审批驳回/撤回：恢复编辑前业务数据，但保留当前审批状态与 approved 历史事实。 */
  private async restorePreUpdateSnapshot(instance: ApprovalInstance, operatorId: string) {
    await this.resources.restore(instance, operatorId)
  }

  private async nextAddSignSort(
    rootTaskId: string,
    sourceRelation: { rootTaskId: string; sort: bigint } | null,
    type: 'BEFORE' | 'AFTER',
  ): Promise<bigint> {
    if (!sourceRelation) {
      const tail = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({ rootTaskId })
        .select('sort')
        .orderBy((row) => row.sort.desc())
        .first()
      return (tail?.sort ?? 0n) + 100n
    }
    if (type === 'BEFORE') return sourceRelation.sort - 100n

    const next = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({ rootTaskId })
      .where((row) => row.sort.gt(sourceRelation.sort))
      .select('sort')
      .orderBy((row) => row.sort.asc())
      .first()
    if (!next) return sourceRelation.sort + 100n
    const midpoint = (sourceRelation.sort + next.sort) / 2n
    if (midpoint === sourceRelation.sort || midpoint === next.sort) {
      throw new BadRequestException('当前加签链排序空间不足，请完成已有加签后再操作')
    }
    return midpoint
  }

  private async continueAddSignChain(
    completedTask: ApprovalTask,
    instance: ApprovalInstance,
    operatorId: string,
  ) {
    const relation = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({
      taskId: completedTask.id,
    }).first()
    if (!relation) throw new BadRequestException('加签任务缺少链路关系')

    const laterRelations = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({
      rootTaskId: relation.rootTaskId,
    })
      .where((row) => row.sort.gt(relation.sort))
      .orderBy((row) => row.sort.asc())
      .all()
    let nextTask: ApprovalTask | null = null
    if (laterRelations.length) {
      const candidateIds = laterRelations.map((row) => row.taskId)
      const pendingRows = await this.prisma8.client.orm.public.ApprovalTasks.where({
        status: 'PENDING',
      })
        .where((task) => task.id.in(candidateIds))
        .all()
      const pendingMap = new Map(pendingRows.map((task) => [task.id, task]))
      const nextRelation = laterRelations.find((row) => pendingMap.has(row.taskId))
      if (nextRelation) nextTask = this.toLegacyTask(pendingMap.get(nextRelation.taskId)!)
    }
    if (nextTask) {
      if (nextTask.action === 'SIGN') {
        await this.prisma8.client.orm.public.ApprovalTasks.where({ id: nextTask.id }).update({
          action: null,
          updatedAt: prisma8Now(),
        })
      }
      return
    }

    const rootTaskRow = await this.prisma8.client.orm.public.ApprovalTasks.where({
      id: relation.rootTaskId,
    }).first()
    if (!rootTaskRow) throw new BadRequestException('加签根任务不存在')
    const rootTask = this.toLegacyTask(rootTaskRow)
    if (rootTask.status === 'PENDING') {
      if (rootTask.action === 'SIGN') {
        await this.prisma8.client.orm.public.ApprovalTasks.where({ id: rootTask.id }).update({
          action: null,
          updatedAt: prisma8Now(),
        })
      }
      return
    }
    if (rootTask.status === 'APPROVED') {
      await this.completeApprovedNodeTask(rootTask, instance, operatorId)
    }
  }

  private async completeApprovedNodeTask(
    task: ApprovalTask,
    instance: ApprovalInstance,
    operatorId: string,
  ) {
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const mode = snapshot[task.nodeIndex]?.mode ?? 'ANY'
    const pending = await this.prisma8.client.orm.public.ApprovalTasks.where({
      instanceId: instance.id,
      nodeIndex: task.nodeIndex,
      nodeRound: task.nodeRound,
      status: 'PENDING',
    })
      .where((candidate) => candidate.taskType.in(['APPROVAL', 'SIGN']))
      .where((candidate) => or(candidate.action.isNull(), candidate.action.neq('BACK')))
      .select('id')
      .all()
    if (mode === 'ANY') {
      if (pending.length) {
        const updatedAt = prisma8Now()
        await this.prisma8.client.orm.public.ApprovalTasks.where({
          instanceId: instance.id,
          nodeIndex: task.nodeIndex,
          nodeRound: task.nodeRound,
          status: 'PENDING',
        })
          .where((candidate) => candidate.taskType.in(['APPROVAL', 'SIGN']))
          .where((candidate) => or(candidate.action.isNull(), candidate.action.neq('BACK')))
          .updateAll({ status: 'SKIPPED', updatedAt })
      }
      await this.applyNodePostFieldUpdates(instance, task.nodeIndex, 'APPROVE', operatorId)
      await this.advance(instance.id, operatorId)
    } else if (pending.length === 0) {
      await this.applyNodePostFieldUpdates(instance, task.nodeIndex, 'APPROVE', operatorId)
      await this.advance(instance.id, operatorId)
    }
  }

  private async applyNodePostFieldUpdates(
    instance: ApprovalInstance,
    nodeIndex: number,
    action: 'APPROVE' | 'REJECT',
    operatorId: string,
  ) {
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const node = snapshot[nodeIndex]
    if (!node) throw new BadRequestException('审批实例缺少冻结节点配置')
    const config = action === 'APPROVE' ? node.passPostConfig : node.rejectPostConfig
    const updates = (config?.fieldUpdateConfigs ?? [])
      .filter((item) => item.enable && item.fieldValue !== undefined && item.fieldValue !== null)
      .map((item) => ({ fieldId: item.fieldId, value: item.fieldValue }))
    if (updates.length) {
      await this.resources.updateApprovalPostFields(
        instance.tenantId,
        operatorId,
        instance.module as ApprovalModule,
        instance.targetId,
        updates,
      )
      const target = await this.resources.targetInfo(
        instance.tenantId,
        instance.module as ApprovalModule,
        instance.targetId,
      )
      await this.prisma8.client.orm.public.ApprovalInstances.where({ id: instance.id }).update({
        targetName: target.name,
        summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
        updatedAt: prisma8Now(),
      })
      instance.targetName = target.name
      instance.summary = target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null
    }
    await this.webhooks.enqueueRuntime(instance, nodeIndex, action, operatorId)
  }

  private async ensurePendingTask(user: AuthUser, taskId: string): Promise<ApprovalTask> {
    const taskRow = await this.prisma8.client.orm.public.ApprovalTasks.where({
      id: taskId,
      tenantId: user.tenantId,
      approverId: user.id,
      status: 'PENDING',
    })
      .where((task) => task.taskType.in(['APPROVAL', 'SIGN']))
      .first()
    if (!taskRow) throw new NotFoundException('待办任务不存在或已处理')
    const instance = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: taskRow.instanceId,
      status: 'PENDING',
    })
      .select('id')
      .first()
    if (!instance) throw new NotFoundException('待办任务不存在或已处理')
    const task = this.toLegacyTask(taskRow)
    if (task.action === 'SIGN') throw new BadRequestException('当前任务正在等待前置加签完成')
    if (task.action === 'BACK') throw new BadRequestException('当前任务已经执行节点退回')
    if (task.taskType === 'SIGN') {
      const relation = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({
        taskId: task.id,
      }).first()
      if (!relation) throw new BadRequestException('加签任务缺少链路关系')
      const earlierRelations = await this.prisma8.client.orm.public.ApprovalAddSignTasks.where({
        rootTaskId: relation.rootTaskId,
      })
        .where((row) => row.sort.lt(relation.sort))
        .select('taskId')
        .all()
      if (earlierRelations.length) {
        const earlierTaskIds = earlierRelations.map((row) => row.taskId)
        const earlier = await this.prisma8.client.orm.public.ApprovalTasks.where({
          status: 'PENDING',
        })
          .where((candidate) => candidate.id.in(earlierTaskIds))
          .select('id')
          .first()
        if (earlier) throw new BadRequestException('当前加签任务尚未轮到处理')
      }
    }
    return task
  }

  private async nextApprovalNodeRound(instanceId: string, nodeId: string | null): Promise<number> {
    if (!nodeId) return 1
    const [taskRound, recordRound] = await Promise.all([
      this.prisma8.client.orm.public.ApprovalTasks.where({ instanceId, nodeId })
        .select('nodeRound')
        .orderBy((row) => row.nodeRound.desc())
        .first(),
      this.prisma8.client.orm.public.ApprovalRecords.where({ instanceId, nodeId })
        .select('nodeRound')
        .orderBy((row) => row.nodeRound.desc())
        .first(),
    ])
    return Math.max(taskRound?.nodeRound ?? 0, recordRound?.nodeRound ?? 0) + 1
  }

  private async requireCommentForInstance(user: AuthUser, instanceId: string): Promise<boolean> {
    const instance = await this.prisma8.client.orm.public.ApprovalInstances.where({
      id: instanceId,
      tenantId: user.tenantId,
    })
      .select('flowId')
      .first()
    if (!instance?.flowId) return false
    const flow = await this.prisma8.client.orm.public.ApprovalFlows.where({
      id: instance.flowId,
      tenantId: user.tenantId,
      deletedAt: null,
    })
      .select('requireComment')
      .first()
    return Boolean(flow?.requireComment)
  }

  private async ensureActionAttachmentIds(
    user: AuthUser,
    attachmentIds?: string[],
  ): Promise<string[]> {
    const ids = [...new Set((attachmentIds ?? []).map((id) => id.trim()).filter(Boolean))]
    if (!ids.length) return []
    if (ids.length > 20) throw new BadRequestException('单次审批最多上传 20 个附件')
    const attachments = await this.prisma8.client.orm.public.Attachments.where({
      tenantId: user.tenantId,
      uploaderId: user.id,
      targetType: null,
      targetId: null,
    })
      .where((attachment) => attachment.id.in(ids))
      .select('id')
      .all()
    if (attachments.length !== ids.length) {
      throw new BadRequestException('审批附件不存在、已挂载、已删除或不属于当前操作人')
    }
    const bound = await this.prisma8.client.orm.public.ApprovalInstanceAttachments.where({
      tenantId: user.tenantId,
    })
      .where((relation) => relation.attachmentId.in(ids))
      .select('attachmentId')
      .all()
    if (bound.length) throw new BadRequestException('已归档的审批附件不能重复绑定')
    return ids
  }

  private async saveActionAttachmentRelationsPrisma8(
    tx: Prisma8Transaction,
    tenantId: string,
    instanceId: string,
    elementId: string,
    attachmentIds: string[],
  ) {
    for (const attachmentId of attachmentIds) {
      try {
        await tx.orm.public.ApprovalInstanceAttachments.create({
          tenantId,
          instanceId,
          elementId,
          attachmentId,
        })
      } catch (error) {
        if ((error as { sqlState?: string }).sqlState !== '23505') throw error
      }
    }
  }

  private async saveApprovalRecordPrisma8(
    tx: Prisma8Transaction,
    user: AuthUser,
    task: ApprovalTask,
    result: 'APPROVE' | 'REJECT',
    comment: string | null,
    attachmentIds: string[],
    updatedAt: ReturnType<typeof prisma8Now>,
  ) {
    const where = {
      tenantId: user.tenantId,
      instanceId: task.instanceId,
      taskId: task.id,
      nodeId: task.nodeId,
      nodeRound: task.nodeRound,
    }
    const existing = await tx.orm.public.ApprovalRecords.where(where)
      .select('id', 'result')
      .orderBy((record) => record.createdAt.desc())
      .first()
    if (
      existing?.result === 'APPROVE' &&
      result === 'APPROVE' &&
      !comment &&
      attachmentIds.length === 0
    ) {
      return existing
    }
    if (existing) {
      await tx.orm.public.ApprovalInstanceAttachments.where({
        tenantId: user.tenantId,
        instanceId: task.instanceId,
        elementId: existing.id,
      }).deleteAll()
      await tx.orm.public.ApprovalRecords.where(where).deleteAll()
    }
    const record = await tx.orm.public.ApprovalRecords.create({
      tenantId: user.tenantId,
      instanceId: task.instanceId,
      taskId: task.id,
      nodeId: task.nodeId,
      nodeRound: task.nodeRound,
      result,
      comment,
      createdById: user.id,
      updatedAt,
    })
    await this.saveActionAttachmentRelationsPrisma8(
      tx,
      user.tenantId,
      task.instanceId,
      record.id,
      attachmentIds,
    )
    return record
  }

  private toLegacyInstance(row: Prisma8ApprovalInstanceRow): ApprovalInstance {
    return {
      ...row,
      finishedAt: row.finishedAt ? prisma8TimestampToDate(row.finishedAt) : null,
      createdAt: prisma8TimestampToDate(row.createdAt),
      updatedAt: prisma8TimestampToDate(row.updatedAt),
    } as unknown as ApprovalInstance
  }

  private toLegacyTask(row: Prisma8ApprovalTaskRow): ApprovalTask {
    return {
      ...row,
      handledAt: row.handledAt ? prisma8TimestampToDate(row.handledAt) : null,
      createdAt: prisma8TimestampToDate(row.createdAt),
      updatedAt: prisma8TimestampToDate(row.updatedAt),
    } as unknown as ApprovalTask
  }

  private async tasksByInstance(instanceIds: string[]): Promise<Map<string, ApprovalTask[]>> {
    const grouped = new Map<string, ApprovalTask[]>()
    if (!instanceIds.length) return grouped
    const rows = await this.prisma8.client.orm.public.ApprovalTasks.where((task) =>
      task.instanceId.in(instanceIds),
    ).all()
    for (const row of rows) {
      const task = this.toLegacyTask(row)
      const bucket = grouped.get(task.instanceId) ?? []
      bucket.push(task)
      grouped.set(task.instanceId, bucket)
    }
    return grouped
  }

  private async hydrateTaskInstances(taskRows: Prisma8ApprovalTaskRow[]) {
    const instanceIds = [...new Set(taskRows.map((task) => task.instanceId))]
    const result = new Map<string, { instance: ApprovalInstance; tasks: ApprovalTask[] }>()
    if (!instanceIds.length) return result
    const [instanceRows, tasksByInstance] = await Promise.all([
      this.prisma8.client.orm.public.ApprovalInstances.where((instance) =>
        instance.id.in(instanceIds),
      ).all(),
      this.tasksByInstance(instanceIds),
    ])
    for (const row of instanceRows) {
      result.set(row.id, {
        instance: this.toLegacyInstance(row),
        tasks: tasksByInstance.get(row.id) ?? [],
      })
    }
    return result
  }

  private isTaskWithdrawable(
    instance: WithdrawInstanceLike,
    tasks: WithdrawTaskLike[],
    task: WithdrawTaskLike,
    allowWithdraw: boolean,
  ): boolean {
    if (!allowWithdraw || instance.status !== 'PENDING') return false
    if (
      task.taskType !== 'APPROVAL' ||
      task.status !== 'APPROVED' ||
      task.action !== 'APPROVE' ||
      !task.nodeId
    ) {
      return false
    }

    const frozenNodes = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const sourceNode = frozenNodes[task.nodeIndex]
    if (!sourceNode || sourceNode.nodeId !== task.nodeId) return false
    const isActiveApprovalTask = (candidate: WithdrawTaskLike) =>
      candidate.status === 'PENDING' &&
      (candidate.taskType === 'APPROVAL' || candidate.taskType === 'SIGN') &&
      candidate.action !== 'BACK'

    if (sourceNode.mode === 'ALL') {
      return (
        instance.currentNodeIndex === task.nodeIndex &&
        tasks.some(
          (candidate) =>
            candidate.nodeIndex === task.nodeIndex &&
            candidate.nodeRound === task.nodeRound &&
            isActiveApprovalTask(candidate),
        )
      )
    }

    if (instance.currentNodeIndex <= task.nodeIndex) return false
    const completedIntermediateTask = tasks.some(
      (candidate) =>
        candidate.nodeIndex > task.nodeIndex &&
        candidate.nodeIndex < instance.currentNodeIndex &&
        (candidate.taskType === 'APPROVAL' || candidate.taskType === 'SIGN') &&
        (candidate.status === 'APPROVED' || candidate.status === 'REJECTED'),
    )
    if (completedIntermediateTask) return false
    return tasks.some(
      (candidate) =>
        candidate.nodeIndex === instance.currentNodeIndex && isActiveApprovalTask(candidate),
    )
  }

  private async toInstanceVO(
    instance: ApprovalInstance,
    tasks: ApprovalTask[],
    currentUser: AuthUser,
    includeResourceFields = false,
  ): Promise<ApprovalInstanceVO> {
    const approverIds = [...new Set(tasks.map((task) => task.approverId))]
    const users = approverIds.length
      ? await this.prisma8.client.orm.public.Users.where((user) => user.id.in(approverIds))
          .select('id', 'name')
          .all()
      : []
    const nameMap = new Map<string, string>(users.map((user) => [user.id, user.name]))
    const [records, addSignTasks, returnBackRecords, attachmentRelations, flowCapability] =
      await Promise.all([
        this.prisma8.client.orm.public.ApprovalRecords.where({
          tenantId: instance.tenantId,
          instanceId: instance.id,
        })
          .orderBy((record) => record.createdAt.asc())
          .all(),
        this.prisma8.client.orm.public.ApprovalAddSignTasks.where({
          tenantId: instance.tenantId,
          instanceId: instance.id,
        })
          .orderBy([
            (row) => row.rootTaskId.asc(),
            (row) => row.sort.asc(),
            (row) => row.createdAt.asc(),
          ])
          .all(),
        this.prisma8.client.orm.public.ApprovalReturnBackRecords.where({
          tenantId: instance.tenantId,
          instanceId: instance.id,
        })
          .orderBy((record) => record.createdAt.asc())
          .all(),
        this.prisma8.client.orm.public.ApprovalInstanceAttachments.where({
          tenantId: instance.tenantId,
          instanceId: instance.id,
        })
          .orderBy((relation) => relation.createdAt.asc())
          .all(),
        instance.flowId
          ? this.prisma8.client.orm.public.ApprovalFlows.where({
              id: instance.flowId,
              tenantId: instance.tenantId,
              deletedAt: null,
            })
              .select('allowAddSign', 'allowWithdraw', 'requireComment')
              .first()
          : Promise.resolve(null),
      ])
    const attachmentIds = [
      ...new Set(attachmentRelations.map((relation) => relation.attachmentId)),
    ]
    const attachmentRows = attachmentIds.length
      ? await this.prisma8.client.orm.public.Attachments.where({ tenantId: instance.tenantId })
          .where((attachment) => attachment.id.in(attachmentIds))
          .all()
      : []
    const attachmentMap = new Map(
      attachmentRows.map((attachment) => [attachment.id, attachment] as const),
    )
    const latestRecordByTaskId = new Map(
      records.flatMap((record) => (record.taskId ? [[record.taskId, record] as const] : [])),
    )
    const approvalTasks = tasks.filter(
      (task) => task.taskType === 'APPROVAL' || task.taskType === 'SIGN',
    )
    const myPending = approvalTasks.find(
      (task) =>
        task.approverId === currentUser.id &&
        task.status === 'PENDING' &&
        task.action !== 'SIGN' &&
        task.action !== 'BACK',
    )
    const latestMyApproved = approvalTasks
      .filter(
        (task) =>
          task.approverId === currentUser.id &&
          task.taskType === 'APPROVAL' &&
          task.status === 'APPROVED' &&
          task.action === 'APPROVE',
      )
      .sort(
        (a, b) =>
          (b.handledAt?.getTime() ?? b.updatedAt.getTime()) -
          (a.handledAt?.getTime() ?? a.updatedAt.getTime()),
      )[0]
    const myWithdrawTask =
      latestMyApproved &&
      this.isTaskWithdrawable(
        instance,
        tasks,
        latestMyApproved,
        Boolean(flowCapability?.allowWithdraw),
      )
        ? latestMyApproved
        : null
    const frozenNodes = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const currentFrozenNode = myPending ? frozenNodes[myPending.nodeIndex] : null
    const currentNodeFieldPermissions = myPending
      ? myPending.taskType === 'SIGN'
        ? (currentFrozenNode?.fieldPermissions ?? []).map((permission) => ({
            ...permission,
            permissionType: 'VIEW' as const,
          }))
        : (currentFrozenNode?.fieldPermissions ?? [])
      : []
    const resourceFields = includeResourceFields
      ? await this.resources.approvalFields(
          currentUser,
          instance.module as ApprovalModule,
          instance.targetId,
          currentNodeFieldPermissions,
          myPending?.taskType === 'SIGN',
        )
      : []
    const returnBackTargets =
      myPending?.taskType === 'APPROVAL'
        ? [
            ...new Set(
              records
                .map((record) => record.nodeId)
                .filter((nodeId): nodeId is string => Boolean(nodeId)),
            ),
          ]
            .map((nodeId) => ({
              nodeId,
              nodeIndex: frozenNodes.findIndex((node) => node.nodeId === nodeId),
            }))
            .filter(({ nodeIndex }) => nodeIndex >= 0 && nodeIndex < myPending.nodeIndex)
            .map(({ nodeId, nodeIndex }) => {
              const maxTaskRound = tasks
                .filter((task) => task.nodeId === nodeId)
                .reduce((max, task) => Math.max(max, task.nodeRound), 0)
              const maxRecordRound = records
                .filter((record) => record.nodeId === nodeId)
                .reduce((max, record) => Math.max(max, record.nodeRound), 0)
              return {
                nodeId,
                nodeIndex,
                nodeName: frozenNodes[nodeIndex]?.name ?? '历史审批节点',
                nextRound: Math.max(maxTaskRound, maxRecordRound) + 1,
              }
            })
            .sort((a, b) => a.nodeIndex - b.nodeIndex)
        : []

    return {
      id: instance.id,
      module: instance.module as ApprovalModule,
      targetId: instance.targetId,
      targetName: instance.targetName,
      summary: instance.summary,
      status: instance.status,
      currentNodeIndex: instance.currentNodeIndex,
      nodesSnapshot: instance.nodesSnapshot as unknown as ApprovalNodeConfig[],
      submitterId: instance.submitterId,
      submitterName: instance.submitterName,
      finishedAt: instance.finishedAt?.toISOString() ?? null,
      createdAt: instance.createdAt.toISOString(),
      tasks: approvalTasks
        .sort(
          (a, b) =>
            a.nodeIndex - b.nodeIndex ||
            a.nodeRound - b.nodeRound ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map((t) => ({
          id: t.id,
          instanceId: t.instanceId,
          nodeId: t.nodeId,
          nodeIndex: t.nodeIndex,
          nodeRound: t.nodeRound,
          nodeName: t.nodeName,
          approverId: t.approverId,
          approverName: nameMap.get(t.approverId),
          taskType: t.taskType,
          status: t.status,
          action: t.action,
          comment: latestRecordByTaskId.get(t.id)?.comment ?? null,
          handledAt: t.handledAt?.toISOString() ?? null,
        })),
      records: records.map((record) => ({
        id: record.id,
        taskId: record.taskId,
        nodeId: record.nodeId,
        nodeRound: record.nodeRound,
        result: record.result,
        comment: record.comment,
        createdById: record.createdById,
        createdAt: prisma8TimestampToISOString(record.createdAt),
      })),
      addSignTasks: addSignTasks.map((relation) => ({
        id: relation.id,
        taskId: relation.taskId,
        signTaskId: relation.signTaskId,
        type: relation._type,
        rootTaskId: relation.rootTaskId,
        sort: relation.sort.toString(),
        comment: relation.comment,
        createdById: relation.createdById,
        createdAt: prisma8TimestampToISOString(relation.createdAt),
      })),
      returnBackRecords: returnBackRecords.map((record) => ({
        id: record.id,
        taskId: record.taskId,
        returnToNodeId: record.returnToNodeId,
        returnReason: record.returnReason,
        returnUserId: record.returnUserId,
        createdAt: prisma8TimestampToISOString(record.createdAt),
      })),
      returnBackTargets,
      approvalAttachments: attachmentRelations.flatMap((relation) => {
        const attachment = attachmentMap.get(relation.attachmentId)
        if (!attachment) return []
        return [
          {
            id: relation.id,
            elementId: relation.elementId,
            attachment: {
              id: attachment.id,
              name: attachment.name,
              size: attachment.size,
              mime: attachment.mime,
              targetType: attachment.targetType,
              targetId: attachment.targetId,
              uploaderId: attachment.uploaderId,
              createdAt: prisma8TimestampToISOString(attachment.createdAt),
            },
          },
        ]
      }),
      currentNodeFieldPermissions,
      resourceFields,
      requireComment: Boolean(flowCapability?.requireComment),
      canAddSign: Boolean(myPending && flowCapability?.allowAddSign),
      canReturnBack: Boolean(myPending?.taskType === 'APPROVAL' && returnBackTargets.length),
      canWithdraw: Boolean(myWithdrawTask),
      myPendingTaskId: myPending?.id ?? null,
      myWithdrawTaskId: myWithdrawTask?.id ?? null,
    }
  }
}
