import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
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
import type { AddSignTaskDto, ReturnBackTaskDto } from './dto/approval.dto'

type ApprovalExecuteTimingValue = 'CREATE' | 'UPDATE' | 'DELETE'

interface ApprovalSubmitContext {
  preUpdateSnapshot?: Prisma.InputJsonValue | null
  comment?: string | null
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly businessNotifications: BusinessNotificationsService,
    private readonly resources: ApprovalResourceService,
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

    const snapshot: ApprovalNodeConfig[] = flow.currentVersion.nodes
      .filter((node) => node.nodeType === 'APPROVER' && node.approver)
      .map((node) => ({
        nodeId: node.id,
        name: node.name,
        approverType: node.approver!.approverType,
        approverIds: node.approver!.approverIds,
        ccUserIds: node.approver!.ccUserIds,
        mode: node.approver!.mode,
      }))

    const preUpdateSnapshot = context?.preUpdateSnapshot ?? null
    const updateFields =
      executeTiming === 'UPDATE' && preUpdateSnapshot
        ? await this.resources.deriveUpdateFields(user, module, targetId, preUpdateSnapshot)
        : []

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

  async approveTask(user: AuthUser, taskId: string, comment?: string) {
    const task = await this.ensurePendingTask(user, taskId)
    const handledAt = new Date()
    const normalizedComment = comment?.trim() || null
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.update({
        where: { id: taskId },
        data: { status: 'APPROVED', action: 'APPROVE', handledAt },
      })
      await this.saveApprovalRecord(tx, user, task, 'APPROVE', normalizedComment)
    })

    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    })
    if (task.taskType === 'SIGN') await this.continueAddSignChain(task, instance, user.id)
    else await this.completeApprovedNodeTask(task, instance, user.id)
    return { id: taskId, name: instance.targetName }
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
    const handledAt = new Date()
    const signTaskId = randomUUID()

    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.approvalTask.update({
        where: { id: sourceTask.id },
        data:
          dto.type === 'BEFORE'
            ? { action: 'SIGN' }
            : { status: 'APPROVED', action: 'APPROVE', handledAt },
      }),
      this.prisma.approvalTask.create({
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
      }),
      this.prisma.approvalAddSignTask.create({
        data: {
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
      }),
    ]
    if (dto.type === 'AFTER') {
      operations.push(
        this.prisma.approvalRecord.create({
          data: {
            tenantId: user.tenantId,
            instanceId: sourceTask.instanceId,
            taskId: sourceTask.id,
            nodeId: sourceTask.nodeId,
            nodeRound: sourceTask.nodeRound,
            result: 'APPROVE',
            comment: normalizedComment,
            createdById: user.id,
          },
        }),
      )
    }
    await this.prisma.$transaction(operations)
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

  async rejectTask(user: AuthUser, taskId: string, comment?: string) {
    const task = await this.ensurePendingTask(user, taskId)
    if (!comment?.trim()) throw new BadRequestException('驳回时请填写审批意见')
    const normalizedComment = comment.trim()
    const handledAt = new Date()

    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    })
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.update({
        where: { id: taskId },
        data: { status: 'REJECTED', action: 'REJECT', handledAt },
      })
      await this.saveApprovalRecord(tx, user, task, 'REJECT', normalizedComment)
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
      tasks.map((t) => this.toInstanceVO(t.instance, t.instance.tasks, user.id)),
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
    const items = await Promise.all(instances.map((i) => this.toInstanceVO(i, i.tasks, user.id)))
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
      tasks.map((t) => this.toInstanceVO(t.instance, t.instance.tasks, user.id)),
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
      tasks.map((task) => this.toInstanceVO(task.instance, task.instance.tasks, user.id)),
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
    return this.toInstanceVO(instance, instance.tasks, user.id)
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

    let nodeIndex = instance.currentNodeIndex
    for (;;) {
      nodeIndex += 1
      if (nodeIndex >= snapshot.length) {
        await this.finalizeApproved(instance, operatorId)
        return
      }
      const approvers = await this.resolveApprovers(
        instance.tenantId,
        snapshot[nodeIndex],
        submitter?.deptId ?? null,
        submitter?.leaderId ?? null,
      )
      if (approvers.length === 0) continue
      const ccUserIds = [...new Set(snapshot[nodeIndex].ccUserIds ?? [])].filter(
        (userId) => userId !== instance.submitterId,
      )
      const nodeRound = await this.nextApprovalNodeRound(
        instance.id,
        snapshot[nodeIndex].nodeId ?? null,
      )

      await this.prisma.$transaction([
        this.prisma.approvalInstance.update({
          where: { id: instanceId },
          data: { currentNodeIndex: nodeIndex },
        }),
        this.prisma.approvalTask.createMany({
          data: approvers.map((approverId) => ({
            tenantId: instance.tenantId,
            instanceId,
            nodeId: snapshot[nodeIndex].nodeId ?? null,
            nodeIndex,
            nodeRound,
            nodeName: snapshot[nodeIndex].name,
            approverId,
            taskType: 'APPROVAL',
          })),
        }),
        ...(ccUserIds.length
          ? [
              this.prisma.approvalTask.createMany({
                data: ccUserIds.map((approverId) => ({
                  tenantId: instance.tenantId,
                  instanceId,
                  nodeId: snapshot[nodeIndex].nodeId ?? null,
                  nodeIndex,
                  nodeRound,
                  nodeName: snapshot[nodeIndex].name,
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
        if (!submitterDeptId) break
        const dept = await this.prisma.department.findUnique({ where: { id: submitterDeptId } })
        if (dept?.leaderId) ids = [dept.leaderId]
        break
      }
      case 'DIRECT_LEADER':
        if (submitterLeaderId) ids = [submitterLeaderId]
        break
    }
    if (ids.length === 0) return []
    const active = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] }, tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    return active.map((u) => u.id)
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
              include: { approver: true },
              orderBy: { sort: 'asc' },
            },
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
      await this.advance(instance.id, operatorId)
    } else if (pending.length === 0) {
      await this.advance(instance.id, operatorId)
    }
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

  /**
   * Cordys 同一 task/node/round 在“审批人撤回 -> 再次执行”时不会无条件追加第二条 record：
   * - 再次同意且没有新意见/附件时保留原 record；
   * - 有新意见，或动作从 APPROVE 改为 REJECT 时，先删除旧 record 再创建新的执行记录。
   * 当前 9.3D 尚未接审批附件，因此这里只按 result/comment 实现对应语义。
   */
  private async saveApprovalRecord(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    task: ApprovalTask,
    result: 'APPROVE' | 'REJECT',
    comment: string | null,
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
      select: { result: true },
    })
    if (existing?.result === 'APPROVE' && result === 'APPROVE' && !comment) return
    if (existing) await tx.approvalRecord.deleteMany({ where })
    await tx.approvalRecord.create({
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
    currentUserId: string,
  ): Promise<ApprovalInstanceVO> {
    const approverIds = [...new Set(tasks.map((t) => t.approverId))]
    const users = approverIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, name: true },
        })
      : []
    const nameMap = new Map(users.map((u) => [u.id, u.name]))
    const [records, addSignTasks, returnBackRecords, flowCapability] = await Promise.all([
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
      instance.flowId
        ? this.prisma.approvalFlow.findFirst({
            where: { id: instance.flowId, tenantId: instance.tenantId, deletedAt: null },
            select: { allowAddSign: true, allowWithdraw: true },
          })
        : Promise.resolve(null),
    ])
    const latestRecordByTaskId = new Map(records.map((record) => [record.taskId, record]))
    const approvalTasks = tasks.filter(
      (task) => task.taskType === 'APPROVAL' || task.taskType === 'SIGN',
    )
    const myPending = approvalTasks.find(
      (task) =>
        task.approverId === currentUserId &&
        task.status === 'PENDING' &&
        task.action !== 'SIGN' &&
        task.action !== 'BACK',
    )
    const latestMyApproved = approvalTasks
      .filter(
        (task) =>
          task.approverId === currentUserId &&
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
      canAddSign: Boolean(myPending && flowCapability?.allowAddSign),
      canReturnBack: Boolean(myPending?.taskType === 'APPROVAL' && returnBackTargets.length),
      canWithdraw: Boolean(myWithdrawTask),
      myPendingTaskId: myPending?.id ?? null,
      myWithdrawTaskId: myWithdrawTask?.id ?? null,
    }
  }
}
