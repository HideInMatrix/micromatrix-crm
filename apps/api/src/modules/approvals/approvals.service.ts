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
import type { AuthUser } from '../../common/auth-user'
import { ApprovalInstance, ApprovalTask, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { NotificationsService } from '../notifications/notifications.service'
import { MODULE_TO_FORM_TYPE, toDbFormType } from './approval-flow-config.utils'
import { ApprovalResourceService } from './approval-resource.service'
import { ApprovalWebhookService } from './approval-webhook.service'
import type { AddSignTaskDto, ReturnBackTaskDto } from './dto/approval.dto'

type ApprovalExecuteTimingValue = 'CREATE' | 'UPDATE' | 'DELETE'

interface ApprovalSubmitContext {
  preUpdateSnapshot?: Prisma.InputJsonValue | null
  comment?: string | null
}

type RuntimeFlowVersion = Prisma.ApprovalFlowVersionGetPayload<{
  include: {
    nodes: { include: { approver: true; condition: true } }
    links: true
  }
}>

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
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
    return (await this.prisma.approvalFlow.count({
      where: {
        tenantId,
        formType: toDbFormType(formType),
        enabled: true,
        deletedAt: null,
        currentVersionId: { not: null },
      },
    })) > 0
  }

  /** Cordys UPDATE 审批命中前保存编辑前业务快照。 */
  async capturePreUpdateSnapshot(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
  ): Promise<Prisma.InputJsonValue | null> {
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

    const instance = await this.prisma.approvalInstance.create({
      data: {
        tenantId: user.tenantId,
        flowId: flow.id,
        flowVersionId: flow.currentVersion.id,
        executeTiming,
        module,
        targetId,
        targetName: target.name,
        summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
        nodesSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        comment: context?.comment?.trim() || null,
        updateFields: updateFields.length ? JSON.stringify(updateFields) : null,
        currentNodeIndex: -1,
        submitterId: user.id,
        submitterName: user.name,
      },
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
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.update({
        where: { id: taskId },
        data: { status: 'APPROVED', action: 'APPROVE', handledAt },
      })
      await this.saveApprovalRecord(
        tx,
        user,
        task,
        'APPROVE',
        normalizedComment,
        normalizedAttachmentIds,
      )
    })

    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    })
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
    if (normalized.some((field) => !field.fieldId)) throw new BadRequestException('审批字段 ID 不能为空')
    if (new Set(normalized.map((field) => field.fieldId)).size !== normalized.length) {
      throw new BadRequestException('审批字段不能重复提交')
    }

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: task.instanceId, tenantId: user.tenantId, status: 'PENDING' },
    })
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
    await this.prisma.approvalInstance.update({
      where: { id: instance.id },
      data: {
        targetName: target.name,
        summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
      },
    })
    return { id: taskId, count: normalized.length }
  }

  async signTask(user: AuthUser, taskId: string, dto: AddSignTaskDto) {
    const sourceTask = await this.ensurePendingTask(user, taskId)
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: sourceTask.instanceId, tenantId: user.tenantId, status: 'PENDING' },
    })
    if (!instance) throw new BadRequestException('仅审批中的实例允许加签')
    if (!instance.flowId) throw new BadRequestException('审批实例缺少流程引用，不能加签')

    const flow = await this.prisma.approvalFlow.findFirst({
      where: { id: instance.flowId, tenantId: user.tenantId, deletedAt: null },
      select: { allowAddSign: true },
    })
    if (!flow?.allowAddSign) throw new BadRequestException('当前审批流未开启加签')

    const signApprover = await this.prisma.user.findFirst({
      where: { id: dto.signApprover, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!signApprover) throw new BadRequestException('加签审批人不存在或已停用')

    const sourceRelation = await this.prisma.approvalAddSignTask.findUnique({
      where: { taskId: sourceTask.id },
    })
    const rootTaskId = sourceRelation?.rootTaskId ?? sourceTask.id
    const sort = await this.nextAddSignSort(rootTaskId, sourceRelation, dto.type)
    const normalizedComment = dto.comment?.trim() || null
    const normalizedAttachmentIds = await this.ensureActionAttachmentIds(user, dto.attachmentIds)
    const handledAt = new Date()
    const signTaskId = randomUUID()
    const addSignRelationId = randomUUID()

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.update({
        where: { id: sourceTask.id },
        data:
          dto.type === 'BEFORE'
            ? { action: 'SIGN' }
            : { status: 'APPROVED', action: 'APPROVE', handledAt },
      })
      await tx.approvalTask.create({
        data: {
          id: signTaskId,
          tenantId: user.tenantId,
          instanceId: sourceTask.instanceId,
          nodeId: sourceTask.nodeId,
          nodeIndex: sourceTask.nodeIndex,
          nodeRound: sourceTask.nodeRound,
          nodeName: sourceTask.nodeName,
          approverId: signApprover.id,
          taskType: 'SIGN',
        },
      })
      await tx.approvalAddSignTask.create({
        data: {
          id: addSignRelationId,
          tenantId: user.tenantId,
          instanceId: sourceTask.instanceId,
          taskId: signTaskId,
          signTaskId: sourceTask.id,
          type: dto.type,
          rootTaskId,
          sort,
          comment: normalizedComment,
          createdById: user.id,
        },
      })
      if (dto.type === 'AFTER') {
        await this.saveApprovalRecord(
          tx,
          user,
          sourceTask,
          'APPROVE',
          normalizedComment,
          normalizedAttachmentIds,
        )
      }
      await this.saveActionAttachmentRelations(
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
    if (!sourceTask.nodeId) throw new BadRequestException('当前任务缺少稳定节点 ID，不能执行节点退回')

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: sourceTask.instanceId, tenantId: user.tenantId, status: 'PENDING' },
    })
    if (!instance) throw new BadRequestException('仅审批中的实例允许节点退回')
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const targetIndex = snapshot.findIndex((node) => node.nodeId === dto.returnToNodeId)
    if (targetIndex < 0) throw new BadRequestException('退回目标不属于当前审批实例的冻结流程版本')
    if (targetIndex >= sourceTask.nodeIndex) throw new BadRequestException('只能退回到当前节点之前的历史审批节点')
    const targetNode = snapshot[targetIndex]
    if (!targetNode?.nodeId) throw new BadRequestException('退回目标缺少稳定节点 ID')
    const targetNodeId = targetNode.nodeId

    const historicalRecord = await this.prisma.approvalRecord.findFirst({
      where: {
        tenantId: user.tenantId,
        instanceId: instance.id,
        nodeId: targetNodeId,
      },
      select: { id: true },
    })
    if (!historicalRecord) throw new BadRequestException('只能退回到已经执行过的历史审批节点')

    const submitter = await this.prisma.user.findUnique({ where: { id: instance.submitterId } })
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
      this.prisma.approvalTask.aggregate({
        where: { instanceId: instance.id, nodeId: targetNodeId },
        _max: { nodeRound: true },
      }),
      this.prisma.approvalRecord.aggregate({
        where: { instanceId: instance.id, nodeId: targetNodeId },
        _max: { nodeRound: true },
      }),
    ])
    const nextRound = Math.max(taskRound._max.nodeRound ?? 0, recordRound._max.nodeRound ?? 0) + 1
    const normalizedComment = dto.comment?.trim() || null
    const normalizedAttachmentIds = await this.ensureActionAttachmentIds(user, dto.attachmentIds)
    const backRecordId = randomUUID()

    await this.prisma.$transaction(async (tx) => {
      const stillPending = await tx.approvalTask.count({
        where: {
          id: sourceTask.id,
          tenantId: user.tenantId,
          approverId: user.id,
          status: 'PENDING',
          action: null,
          instance: { status: 'PENDING' },
        },
      })
      if (!stillPending) throw new BadRequestException('待办任务不存在或已处理')

      await tx.approvalTask.updateMany({
        where: {
          instanceId: instance.id,
          nodeIndex: { gt: targetIndex, lte: sourceTask.nodeIndex },
          status: 'PENDING',
        },
        data: { status: 'SKIPPED' },
      })
      await tx.approvalTask.update({
        where: { id: sourceTask.id },
        data: { status: 'PENDING', action: 'BACK', handledAt: new Date() },
      })
      await tx.approvalTask.createMany({
        data: approvers.map((approverId) => ({
          tenantId: instance.tenantId,
          instanceId: instance.id,
          nodeId: targetNodeId,
          nodeIndex: targetIndex,
          nodeRound: nextRound,
          nodeName: targetNode.name,
          approverId,
          taskType: 'APPROVAL' as const,
        })),
      })
      if (ccUserIds.length) {
        await tx.approvalTask.createMany({
          data: ccUserIds.map((approverId) => ({
            tenantId: instance.tenantId,
            instanceId: instance.id,
            nodeId: targetNodeId,
            nodeIndex: targetIndex,
            nodeRound: nextRound,
            nodeName: targetNode.name,
            approverId,
            taskType: 'CC' as const,
          })),
        })
      }
      const previousBackRecords = await tx.approvalReturnBackRecord.findMany({
        where: {
          tenantId: user.tenantId,
          instanceId: instance.id,
          returnToNodeId: targetNodeId,
        },
        select: { id: true },
      })
      if (previousBackRecords.length) {
        await tx.approvalInstanceAttachment.deleteMany({
          where: {
            tenantId: user.tenantId,
            instanceId: instance.id,
            elementId: { in: previousBackRecords.map((record) => record.id) },
          },
        })
      }
      await tx.approvalReturnBackRecord.deleteMany({
        where: {
          tenantId: user.tenantId,
          instanceId: instance.id,
          returnToNodeId: targetNodeId,
        },
      })
      await tx.approvalReturnBackRecord.create({
        data: {
          id: backRecordId,
          tenantId: user.tenantId,
          instanceId: instance.id,
          taskId: sourceTask.id,
          returnToNodeId: targetNodeId,
          returnReason: normalizedComment,
          returnUserId: user.id,
        },
      })
      await this.saveActionAttachmentRelations(
        tx,
        user.tenantId,
        instance.id,
        backRecordId,
        normalizedAttachmentIds,
      )
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { currentNodeIndex: targetIndex },
      })
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
    return this.prisma.$transaction(async (tx) => {
      const sourceTask = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId: user.tenantId,
          approverId: user.id,
          taskType: 'APPROVAL',
          status: 'APPROVED',
          action: 'APPROVE',
        },
      })
      if (!sourceTask) throw new NotFoundException('可撤回的已办任务不存在')

      const instance = await tx.approvalInstance.findFirst({
        where: { id: sourceTask.instanceId, tenantId: user.tenantId, status: 'PENDING' },
        include: { tasks: true },
      })
      if (!instance) throw new BadRequestException('仅审批中的实例允许撤回审批任务')
      if (!instance.flowId) throw new BadRequestException('审批实例缺少流程引用，不能撤回审批任务')

      const flow = await tx.approvalFlow.findFirst({
        where: { id: instance.flowId, tenantId: user.tenantId, deletedAt: null },
        select: { allowWithdraw: true },
      })
      if (!flow?.allowWithdraw) throw new BadRequestException('当前审批流未开启审批人撤回')
      if (!this.isTaskWithdrawable(instance, instance.tasks, sourceTask, true)) {
        throw new BadRequestException('当前审批任务已无法撤回')
      }

      // Cordys clearExpiredNode 会让下游当前轮次失效；MicroMatrix 保留历史 round，
      // 仅把仍活动的待办置为 SKIPPED，下一次 advance 以新 nodeRound 重建。
      if (instance.currentNodeIndex > sourceTask.nodeIndex) {
        await tx.approvalTask.updateMany({
          where: {
            instanceId: instance.id,
            tenantId: user.tenantId,
            nodeIndex: { gt: sourceTask.nodeIndex, lte: instance.currentNodeIndex },
            status: 'PENDING',
          },
          data: { status: 'SKIPPED' },
        })
      }

      const reopened = await tx.approvalTask.updateMany({
        where: {
          id: sourceTask.id,
          tenantId: user.tenantId,
          approverId: user.id,
          taskType: 'APPROVAL',
          status: 'APPROVED',
          action: 'APPROVE',
        },
        data: { status: 'PENDING', action: null, handledAt: null },
      })
      if (reopened.count !== 1) throw new BadRequestException('审批任务状态已变化，请刷新后重试')

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { currentNodeIndex: sourceTask.nodeIndex },
      })

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

    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    })
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.update({
        where: { id: taskId },
        data: { status: 'REJECTED', action: 'REJECT', handledAt },
      })
      await this.saveApprovalRecord(
        tx,
        user,
        task,
        'REJECT',
        normalizedComment,
        normalizedAttachmentIds,
      )
      await tx.approvalTask.updateMany({
        where: { instanceId: instance.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      })
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { status: 'REJECTED', finishedAt: new Date() },
      })
    })
    await this.resources.setBizStatus(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      'REJECTED',
    )
    await this.restorePreUpdateSnapshot(instance, user.id)
    await this.applyNodePostFieldUpdates(instance, task.nodeIndex, 'REJECT', user.id)
    await this.sendApprovalResult(instance, user.id, {
      title: '审批被驳回',
      content: `「${instance.targetName}」被 ${user.name} 驳回：${normalizedComment}`,
    })
    return { id: taskId, name: instance.targetName }
  }

  async cancel(user: AuthUser, instanceId: string) {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: instanceId, tenantId: user.tenantId },
    })
    if (!instance) throw new NotFoundException('审批不存在')
    if (instance.submitterId !== user.id) throw new BadRequestException('仅发起人可撤回')
    if (instance.status !== 'PENDING') throw new BadRequestException('仅审批中的申请可撤回')

    await this.prisma.$transaction([
      this.prisma.approvalTask.updateMany({
        where: { instanceId, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      }),
      this.prisma.approvalInstance.update({
        where: { id: instanceId },
        data: { status: 'CANCELED', finishedAt: new Date() },
      }),
    ])
    await this.resources.setBizStatus(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      instance.module === 'quote' || instance.module === 'contract' || instance.module === 'invoice' || instance.module === 'order'
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
    const instance = await this.prisma.approvalInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        module,
        targetId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!instance) throw new BadRequestException('该业务单据当前没有审批中的申请')

    const task = await this.prisma.approvalTask.findFirst({
      where: {
        instanceId: instance.id,
        approverId: user.id,
        taskType: 'APPROVAL',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!task) throw new BadRequestException('当前用户没有该单据的待审批任务')

    if (status === 'APPROVED') return this.approveTask(user, task.id, comment)
    if (status === 'UNAPPROVED' || status === 'REJECTED') {
      return this.rejectTask(user, task.id, comment?.trim() || '审批未通过')
    }
    throw new BadRequestException('不支持的审批状态')
  }

  async cancelTarget(user: AuthUser, module: ApprovalModule, targetId: string) {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        module,
        targetId,
        submitterId: user.id,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!instance) throw new BadRequestException('该业务单据当前没有可撤回的审批申请')
    return this.cancel(user, instance.id)
  }

  // ===== 查询 =====

  async myPending(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const where: Prisma.ApprovalTaskWhereInput = {
      tenantId: user.tenantId,
      approverId: user.id,
      taskType: { in: ['APPROVAL', 'SIGN'] },
      status: 'PENDING',
      OR: [{ action: null }, { action: { notIn: ['SIGN', 'BACK'] } }],
    }
    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.approvalTask.findMany({
        where,
        include: { instance: { include: { tasks: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalTask.count({ where }),
    ])
    const items = await Promise.all(
      tasks.map((t) => this.toInstanceVO(t.instance, t.instance.tasks, user)),
    )
    return { items, total, page, pageSize }
  }

  async myApplications(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const where: Prisma.ApprovalInstanceWhereInput = {
      tenantId: user.tenantId,
      submitterId: user.id,
    }
    const [instances, total] = await this.prisma.$transaction([
      this.prisma.approvalInstance.findMany({
        where,
        include: { tasks: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalInstance.count({ where }),
    ])
    const items = await Promise.all(instances.map((i) => this.toInstanceVO(i, i.tasks, user)))
    return { items, total, page, pageSize }
  }

  /** 已办：我处理过的 */
  async myHandled(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const where: Prisma.ApprovalTaskWhereInput = {
      tenantId: user.tenantId,
      approverId: user.id,
      taskType: { in: ['APPROVAL', 'SIGN'] },
      OR: [
        { status: { in: ['APPROVED', 'REJECTED'] } },
        { status: 'PENDING', action: 'BACK' },
      ],
    }
    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.approvalTask.findMany({
        where,
        include: { instance: { include: { tasks: true } } },
        orderBy: { handledAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalTask.count({ where }),
    ])
    const items = await Promise.all(
      tasks.map((t) => this.toInstanceVO(t.instance, t.instance.tasks, user)),
    )
    return { items, total, page, pageSize }
  }

  /** Cordys approval_task.type=cc：抄送记录与审批待办共用 approval_task 数据源。 */
  async myCopied(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalInstanceVO>> {
    const where: Prisma.ApprovalTaskWhereInput = {
      tenantId: user.tenantId,
      approverId: user.id,
      taskType: 'CC',
    }
    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.approvalTask.findMany({
        where,
        include: { instance: { include: { tasks: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalTask.count({ where }),
    ])
    const items = await Promise.all(
      tasks.map((task) => this.toInstanceVO(task.instance, task.instance.tasks, user)),
    )
    return { items, total, page, pageSize }
  }

  /** 某业务对象的最新审批实例（详情时间线） */
  async instanceForTarget(
    user: AuthUser,
    module: string,
    targetId: string,
  ): Promise<ApprovalInstanceVO | null> {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { tenantId: user.tenantId, module, targetId },
      include: { tasks: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!instance) return null
    return this.toInstanceVO(instance, instance.tasks, user)
  }

  async instanceDetail(user: AuthUser, instanceId: string): Promise<ApprovalInstanceVO> {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: {
        id: instanceId,
        tenantId: user.tenantId,
        OR: [
          { submitterId: user.id },
          { tasks: { some: { tenantId: user.tenantId, approverId: user.id } } },
        ],
      },
      include: { tasks: true },
    })
    if (!instance) throw new NotFoundException('审批实例不存在')
    return this.toInstanceVO(instance, instance.tasks, user, true)
  }

  // ===== 引擎内部 =====

  /** 推进到下一个有审批人的节点；全部走完则通过 */
  private async advance(instanceId: string, operatorId?: string) {
    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: instanceId },
    })
    if (instance.status !== 'PENDING') return
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const submitter = await this.prisma.user.findUnique({ where: { id: instance.submitterId } })
    if (!instance.flowId) throw new BadRequestException('审批实例缺少流程引用')
    const flowPolicy = await this.prisma.approvalFlow.findFirst({
      where: { id: instance.flowId, tenantId: instance.tenantId, deletedAt: null },
      select: { duplicateApproverRule: true },
    })
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
            ? await this.prisma.user.findFirst({
                where: { id: fallback, tenantId: instance.tenantId, status: 'ACTIVE' },
                select: { id: true },
              })
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
            ? await this.prisma.user.findFirst({
                where: {
                  id: submitter.leaderId,
                  tenantId: instance.tenantId,
                  status: 'ACTIVE',
                },
                select: { id: true },
              })
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
      const nodeRound = await this.nextApprovalNodeRound(
        instance.id,
        node.nodeId ?? null,
      )
      const handledAt = new Date()
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
      const autoRecordRows: Prisma.ApprovalRecordCreateManyInput[] = skippedFacts.map((fact) => ({
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
        await this.prisma.$transaction([
          this.prisma.approvalInstance.update({
            where: { id: instanceId },
            data: { currentNodeIndex: nodeIndex },
          }),
          ...(autoTaskRows.length
            ? [
                this.prisma.approvalTask.createMany({
                  data: autoTaskRows,
                }),
              ]
            : []),
          ...(autoRecordRows.length
            ? [this.prisma.approvalRecord.createMany({ data: autoRecordRows })]
            : []),
          ...(ccUserIds.length
            ? [
                this.prisma.approvalTask.createMany({
                  data: ccUserIds.map((approverId) => ({
                    tenantId: instance.tenantId,
                    instanceId,
                    nodeId: node.nodeId ?? null,
                    nodeIndex,
                    nodeRound,
                    nodeName: node.name,
                    approverId,
                    taskType: 'CC' as const,
                  })),
                }),
              ]
            : []),
        ])
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

      await this.prisma.$transaction([
        this.prisma.approvalInstance.update({
          where: { id: instanceId },
          data: { currentNodeIndex: nodeIndex },
        }),
        this.prisma.approvalTask.createMany({
          data: approvers.map((approverId) => ({
            tenantId: instance.tenantId,
            instanceId,
            nodeId: node.nodeId ?? null,
            nodeIndex,
            nodeRound,
            nodeName: node.name,
            approverId,
            taskType: 'APPROVAL',
          })),
        }),
        ...(autoTaskRows.length
          ? [
              this.prisma.approvalTask.createMany({
                data: autoTaskRows,
              }),
            ]
          : []),
        ...(autoRecordRows.length
          ? [this.prisma.approvalRecord.createMany({ data: autoRecordRows })]
          : []),
        ...(ccUserIds.length
          ? [
              this.prisma.approvalTask.createMany({
                data: ccUserIds.map((approverId) => ({
                  tenantId: instance.tenantId,
                  instanceId,
                  nodeId: node.nodeId ?? null,
                  nodeIndex,
                  nodeRound,
                  nodeName: node.name,
                  approverId,
                  taskType: 'CC' as const,
                })),
              }),
            ]
          : []),
      ])
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
    await this.prisma.approvalInstance.update({
      where: { id: instance.id },
      data: { status: 'APPROVED', finishedAt: new Date() },
    })
    await this.resources.setBizStatus(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      'APPROVED',
    )
    await this.resources.effectApproved(instance)
    await this.sendApprovalResult(instance, operatorId, {
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
        ...message,
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
        const users = await this.prisma.user.findMany({
          where: {
            tenantId,
            status: 'ACTIVE',
            userRoles: { some: { roleId: { in: node.approverIds } } },
          },
          select: { id: true },
        })
        ids = users.map((u) => u.id)
        break
      }
      case 'DEPT_LEADER': {
        const chain = await this.departmentLeaderChain(tenantId, submitterDeptId)
        ids = this.selectHierarchyApprovers(chain, this.approverLevel(node), node.approverDirection, false)
        break
      }
      case 'MULTIPLE_DEPT_LEADER': {
        const chain = await this.departmentLeaderChain(tenantId, submitterDeptId)
        ids = this.selectHierarchyApprovers(chain, this.approverLevel(node), node.approverDirection, true)
        break
      }
      case 'DIRECT_LEADER': {
        const chain = await this.directLeaderChain(tenantId, submitterId, submitterLeaderId)
        ids = this.selectHierarchyApprovers(chain, this.approverLevel(node), node.approverDirection, false)
        break
      }
      case 'MULTIPLE_DIRECT_LEADER': {
        const chain = await this.directLeaderChain(tenantId, submitterId, submitterLeaderId)
        ids = this.selectHierarchyApprovers(chain, this.approverLevel(node), node.approverDirection, true)
        break
      }
    }
    if (ids.length === 0) return []
    const uniqueIds = [...new Set(ids)]
    const active = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    const activeIds = new Set(active.map((u) => u.id))
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
      const leader = await this.prisma.user.findFirst({
        where: { id: currentLeaderId, tenantId },
        select: { leaderId: true },
      })
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
      const dept = await this.prisma.department.findFirst({
        where: { id: deptId, tenantId },
        select: { leaderId: true, parentId: true },
      })
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
      const approved = await this.prisma.approvalTask.findMany({
        where: {
          instanceId: instance.id,
          status: 'APPROVED',
          taskType: { in: ['APPROVAL', 'SIGN'] },
          ...(nodeId ? { OR: [{ nodeId: null }, { nodeId: { not: nodeId } }] } : { nodeIndex: { not: nodeIndex } }),
        },
        select: { approverId: true },
      })
      previousApproverIds = approved.map((task) => task.approverId)
    } else if (nodeIndex > 0) {
      const maxRound = await this.prisma.approvalTask.aggregate({
        where: { instanceId: instance.id, nodeIndex: nodeIndex - 1 },
        _max: { nodeRound: true },
      })
      if (maxRound._max.nodeRound !== null) {
        const approved = await this.prisma.approvalTask.findMany({
          where: {
            instanceId: instance.id,
            nodeIndex: nodeIndex - 1,
            nodeRound: maxRound._max.nodeRound,
            status: 'APPROVED',
            taskType: { in: ['APPROVAL', 'SIGN'] },
          },
          select: { approverId: true },
        })
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
          const config = target.condition?.conditionConfig as unknown as ApprovalConditionConfig | null
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
        if (!current.approver) throw new BadRequestException(`审批节点「${current.name}」缺少审批人配置`)
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
        (node.approver.passPostConfig as unknown as ApprovalNodeConfig['passPostConfig']) ?? undefined,
      rejectPostConfig:
        (node.approver.rejectPostConfig as unknown as ApprovalNodeConfig['rejectPostConfig']) ?? undefined,
    }
  }

  private matchCondition(
    config: ApprovalConditionConfig | null | undefined,
    fieldValues: Record<string, unknown>,
    updateFields: Set<string>,
  ) {
    const conditions = config?.conditions?.filter((condition) => this.validCondition(condition)) ?? []
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
      return actualValue.some((item) => expectedValue.some((expected) => this.conditionEquals(item, expected)))
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
    return range ? { operator: 'BETWEEN', value: range } : { operator: 'DYNAMICS', value: condition.value }
  }

  private dynamicDateRange(key: string): [number, number] | null {
    const now = new Date()
    const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
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
    const timingFlag =
      executeTiming === 'CREATE'
        ? { createExecute: true }
        : executeTiming === 'UPDATE'
          ? { updateExecute: true }
          : { deleteExecute: true }
    return this.prisma.approvalFlow.findFirst({
      where: {
        tenantId,
        formType: toDbFormType(formType),
        enabled: true,
        deletedAt: null,
        ...timingFlag,
      },
      include: {
        currentVersion: {
          include: {
            // 当前配置 UI 复用同一审批节点链，执行时机由 flow flags 决定。
            nodes: {
              include: { approver: true, condition: true },
              orderBy: { sort: 'asc' },
            },
            links: { orderBy: { sort: 'asc' } },
          },
        },
      },
    })
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
      const tail = await this.prisma.approvalAddSignTask.findFirst({
        where: { rootTaskId },
        orderBy: { sort: 'desc' },
        select: { sort: true },
      })
      return (tail?.sort ?? 0n) + 100n
    }
    if (type === 'BEFORE') return sourceRelation.sort - 100n

    const next = await this.prisma.approvalAddSignTask.findFirst({
      where: { rootTaskId, sort: { gt: sourceRelation.sort } },
      orderBy: { sort: 'asc' },
      select: { sort: true },
    })
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
    const relation = await this.prisma.approvalAddSignTask.findUnique({
      where: { taskId: completedTask.id },
    })
    if (!relation) throw new BadRequestException('加签任务缺少链路关系')

    const next = await this.prisma.approvalAddSignTask.findFirst({
      where: {
        rootTaskId: relation.rootTaskId,
        sort: { gt: relation.sort },
        task: { status: 'PENDING' },
      },
      orderBy: { sort: 'asc' },
      include: { task: true },
    })
    if (next) {
      if (next.task.action === 'SIGN') {
        await this.prisma.approvalTask.update({
          where: { id: next.task.id },
          data: { action: null },
        })
      }
      return
    }

    const rootTask = await this.prisma.approvalTask.findUnique({
      where: { id: relation.rootTaskId },
    })
    if (!rootTask) throw new BadRequestException('加签根任务不存在')
    if (rootTask.status === 'PENDING') {
      if (rootTask.action === 'SIGN') {
        await this.prisma.approvalTask.update({
          where: { id: rootTask.id },
          data: { action: null },
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
    const pending = await this.prisma.approvalTask.findMany({
      where: {
        instanceId: instance.id,
        nodeIndex: task.nodeIndex,
        nodeRound: task.nodeRound,
        status: 'PENDING',
        taskType: { in: ['APPROVAL', 'SIGN'] },
        OR: [{ action: null }, { action: { not: 'BACK' } }],
      },
      select: { id: true },
    })
    if (mode === 'ANY') {
      if (pending.length) {
        await this.prisma.approvalTask.updateMany({
          where: {
            instanceId: instance.id,
            nodeIndex: task.nodeIndex,
            nodeRound: task.nodeRound,
            status: 'PENDING',
            taskType: { in: ['APPROVAL', 'SIGN'] },
            OR: [{ action: null }, { action: { not: 'BACK' } }],
          },
          data: { status: 'SKIPPED' },
        })
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
      await this.prisma.approvalInstance.update({
        where: { id: instance.id },
        data: {
          targetName: target.name,
          summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
        },
      })
      instance.targetName = target.name
      instance.summary = target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null
    }
    await this.webhooks.enqueueRuntime(instance, nodeIndex, action, operatorId)
  }

  private async ensurePendingTask(user: AuthUser, taskId: string): Promise<ApprovalTask> {
    const task = await this.prisma.approvalTask.findFirst({
      where: {
        id: taskId,
        tenantId: user.tenantId,
        approverId: user.id,
        taskType: { in: ['APPROVAL', 'SIGN'] },
        status: 'PENDING',
        instance: { status: 'PENDING' },
      },
    })
    if (!task) throw new NotFoundException('待办任务不存在或已处理')
    if (task.action === 'SIGN') throw new BadRequestException('当前任务正在等待前置加签完成')
    if (task.action === 'BACK') throw new BadRequestException('当前任务已经执行节点退回')
    if (task.taskType === 'SIGN') {
      const relation = await this.prisma.approvalAddSignTask.findUnique({ where: { taskId: task.id } })
      if (!relation) throw new BadRequestException('加签任务缺少链路关系')
      const earlier = await this.prisma.approvalAddSignTask.findFirst({
        where: {
          rootTaskId: relation.rootTaskId,
          sort: { lt: relation.sort },
          task: { status: 'PENDING' },
        },
        select: { id: true },
      })
      if (earlier) throw new BadRequestException('当前加签任务尚未轮到处理')
    }
    return task
  }

  private async nextApprovalNodeRound(instanceId: string, nodeId: string | null): Promise<number> {
    if (!nodeId) return 1
    const [taskRound, recordRound] = await Promise.all([
      this.prisma.approvalTask.aggregate({
        where: { instanceId, nodeId },
        _max: { nodeRound: true },
      }),
      this.prisma.approvalRecord.aggregate({
        where: { instanceId, nodeId },
        _max: { nodeRound: true },
      }),
    ])
    return Math.max(taskRound._max.nodeRound ?? 0, recordRound._max.nodeRound ?? 0) + 1
  }

  private async requireCommentForInstance(user: AuthUser, instanceId: string): Promise<boolean> {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: instanceId, tenantId: user.tenantId },
      select: { flowId: true },
    })
    if (!instance?.flowId) return false
    const flow = await this.prisma.approvalFlow.findFirst({
      where: { id: instance.flowId, tenantId: user.tenantId, deletedAt: null },
      select: { requireComment: true },
    })
    return Boolean(flow?.requireComment)
  }

  private async ensureActionAttachmentIds(
    user: AuthUser,
    attachmentIds?: string[],
  ): Promise<string[]> {
    const ids = [...new Set((attachmentIds ?? []).map((id) => id.trim()).filter(Boolean))]
    if (!ids.length) return []
    if (ids.length > 20) throw new BadRequestException('单次审批最多上传 20 个附件')
    const attachments = await this.prisma.attachment.findMany({
      where: {
        id: { in: ids },
        tenantId: user.tenantId,
        uploaderId: user.id,
        targetType: null,
        targetId: null,
      },
      select: { id: true },
    })
    if (attachments.length !== ids.length) {
      throw new BadRequestException('审批附件不存在、已挂载、已删除或不属于当前操作人')
    }
    const bound = await this.prisma.approvalInstanceAttachment.findMany({
      where: { tenantId: user.tenantId, attachmentId: { in: ids } },
      select: { attachmentId: true },
    })
    if (bound.length) throw new BadRequestException('已归档的审批附件不能重复绑定')
    return ids
  }

  private async saveActionAttachmentRelations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    instanceId: string,
    elementId: string,
    attachmentIds: string[],
  ) {
    if (!attachmentIds.length) return
    await tx.approvalInstanceAttachment.createMany({
      data: attachmentIds.map((attachmentId) => ({
        tenantId,
        instanceId,
        elementId,
        attachmentId,
      })),
      skipDuplicates: true,
    })
  }

  /**
   * Cordys 同一 task/node/round 在“审批人撤回 -> 再次执行”时不会无条件追加第二条 record：
   * - 再次同意且没有新意见/附件时保留原 record；
   * - 有新意见/附件，或动作从 APPROVE 改为 REJECT 时，先删除旧 record 再创建新的执行记录。
   */
  private async saveApprovalRecord(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    task: ApprovalTask,
    result: 'APPROVE' | 'REJECT',
    comment: string | null,
    attachmentIds: string[] = [],
  ) {
    const where = {
      tenantId: user.tenantId,
      instanceId: task.instanceId,
      taskId: task.id,
      nodeId: task.nodeId,
      nodeRound: task.nodeRound,
    }
    const existing = await tx.approvalRecord.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, result: true },
    })
    if (
      existing?.result === 'APPROVE' &&
      result === 'APPROVE' &&
      !comment &&
      attachmentIds.length === 0
    ) {
      return existing
    }
    if (existing) {
      await tx.approvalInstanceAttachment.deleteMany({
        where: { tenantId: user.tenantId, instanceId: task.instanceId, elementId: existing.id },
      })
      await tx.approvalRecord.deleteMany({ where })
    }
    const record = await tx.approvalRecord.create({
      data: {
        tenantId: user.tenantId,
        instanceId: task.instanceId,
        taskId: task.id,
        nodeId: task.nodeId,
        nodeRound: task.nodeRound,
        result,
        comment,
        createdById: user.id,
      },
    })
    await this.saveActionAttachmentRelations(
      tx,
      user.tenantId,
      task.instanceId,
      record.id,
      attachmentIds,
    )
    return record
  }

  private isTaskWithdrawable(
    instance: ApprovalInstance,
    tasks: ApprovalTask[],
    task: ApprovalTask,
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
    const isActiveApprovalTask = (candidate: ApprovalTask) =>
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
    const approverIds = [...new Set(tasks.map((t) => t.approverId))]
    const users = approverIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, name: true },
        })
      : []
    const nameMap = new Map(users.map((u) => [u.id, u.name]))
    const [records, addSignTasks, returnBackRecords, attachmentRelations, flowCapability] = await Promise.all([
      this.prisma.approvalRecord.findMany({
        where: { tenantId: instance.tenantId, instanceId: instance.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.approvalAddSignTask.findMany({
        where: { tenantId: instance.tenantId, instanceId: instance.id },
        orderBy: [{ rootTaskId: 'asc' }, { sort: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.approvalReturnBackRecord.findMany({
        where: { tenantId: instance.tenantId, instanceId: instance.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.approvalInstanceAttachment.findMany({
        where: { tenantId: instance.tenantId, instanceId: instance.id },
        orderBy: { createdAt: 'asc' },
      }),
      instance.flowId
        ? this.prisma.approvalFlow.findFirst({
            where: { id: instance.flowId, tenantId: instance.tenantId, deletedAt: null },
            select: { allowAddSign: true, allowWithdraw: true, requireComment: true },
          })
        : Promise.resolve(null),
    ])
    const attachmentIds = [...new Set(attachmentRelations.map((relation) => relation.attachmentId))]
    const attachmentRows = attachmentIds.length
      ? await this.prisma.attachment.findMany({
          where: { tenantId: instance.tenantId, id: { in: attachmentIds } },
        })
      : []
    const attachmentMap = new Map(attachmentRows.map((attachment) => [attachment.id, attachment]))
    const latestRecordByTaskId = new Map(records.map((record) => [record.taskId, record]))
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
    const returnBackTargets = myPending?.taskType === 'APPROVAL'
      ? [...new Set(records.map((record) => record.nodeId).filter((nodeId): nodeId is string => Boolean(nodeId)))]
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
        createdAt: record.createdAt.toISOString(),
      })),
      addSignTasks: addSignTasks.map((relation) => ({
        id: relation.id,
        taskId: relation.taskId,
        signTaskId: relation.signTaskId,
        type: relation.type,
        rootTaskId: relation.rootTaskId,
        sort: relation.sort.toString(),
        comment: relation.comment,
        createdById: relation.createdById,
        createdAt: relation.createdAt.toISOString(),
      })),
      returnBackRecords: returnBackRecords.map((record) => ({
        id: record.id,
        taskId: record.taskId,
        returnToNodeId: record.returnToNodeId,
        returnReason: record.returnReason,
        returnUserId: record.returnUserId,
        createdAt: record.createdAt.toISOString(),
      })),
      returnBackTargets,
      approvalAttachments: attachmentRelations.flatMap((relation) => {
        const attachment = attachmentMap.get(relation.attachmentId)
        if (!attachment) return []
        return [{
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
            createdAt: attachment.createdAt.toISOString(),
          },
        }]
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
