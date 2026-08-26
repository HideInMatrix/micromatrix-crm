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

interface TargetInfo {
  name: string
  amount: number
  approvalStatus: string
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly businessNotifications: BusinessNotificationsService,
  ) {}

  /** 该模块在指定金额下是否需要审批 */
  async flowRequired(tenantId: string, module: string, amount: number): Promise<boolean> {
    const flow = await this.enabledFlow(tenantId, module)
    if (!flow?.currentVersion) return false
    const amountGte = (flow.condition as { amountGte?: number } | null)?.amountGte
    return amountGte === undefined || amountGte === null || amount >= amountGte
  }

  // ===== 提交与审批 =====

  async submit(user: AuthUser, module: ApprovalModule, targetId: string) {
    if (module === 'receivableRecord') {
      throw new BadRequestException('回款记录审批已退出流程设置，请使用 Cordys 发票审批链路')
    }
    const target = await this.targetInfo(user.tenantId, module, targetId)
    if (target.approvalStatus === 'PENDING') throw new BadRequestException('该单据已在审批中')
    if (target.approvalStatus === 'APPROVED') throw new BadRequestException('该单据已审批通过')

    const flow = await this.enabledFlow(user.tenantId, module)
    if (!flow?.currentVersion) throw new BadRequestException('该业务对象未配置启用的审批流')
    if (!(await this.flowRequired(user.tenantId, module, target.amount))) {
      throw new BadRequestException('该单据金额未达到审批条件，无需审批')
    }

    const snapshot: ApprovalNodeConfig[] = flow.currentVersion.nodes
      .filter((node) => node.nodeType === 'APPROVER' && node.approver)
      .map((node) => ({
        name: node.name,
        approverType: node.approver!.approverType,
        approverIds: node.approver!.approverIds,
        ccUserIds: node.approver!.ccUserIds,
        mode: node.approver!.mode,
      }))

    const instance = await this.prisma.approvalInstance.create({
      data: {
        tenantId: user.tenantId,
        flowId: flow.id,
        flowVersionId: flow.currentVersion.id,
        executeTiming: 'CREATE',
        module,
        targetId,
        targetName: target.name,
        summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
        nodesSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        currentNodeIndex: -1,
        submitterId: user.id,
        submitterName: user.name,
      },
    })

    await this.setBizStatus(module, targetId, 'PENDING')
    await this.advance(instance.id, user.id)
    return { id: instance.id, name: target.name }
  }

  async approveTask(user: AuthUser, taskId: string, comment?: string) {
    const task = await this.ensurePendingTask(user, taskId)
    await this.prisma.approvalTask.update({
      where: { id: taskId },
      data: { status: 'APPROVED', comment, handledAt: new Date() },
    })

    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    })
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const mode = snapshot[task.nodeIndex]?.mode ?? 'ANY'

    const siblings = await this.prisma.approvalTask.findMany({
      where: { instanceId: instance.id, nodeIndex: task.nodeIndex, status: 'PENDING' },
    })
    if (mode === 'ANY') {
      await this.prisma.approvalTask.updateMany({
        where: { instanceId: instance.id, nodeIndex: task.nodeIndex, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      })
      await this.advance(instance.id, user.id)
    } else if (siblings.length === 0) {
      await this.advance(instance.id, user.id)
    }
    return { id: taskId, name: instance.targetName }
  }

  async rejectTask(user: AuthUser, taskId: string, comment?: string) {
    const task = await this.ensurePendingTask(user, taskId)
    if (!comment?.trim()) throw new BadRequestException('驳回时请填写审批意见')

    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    })
    await this.prisma.$transaction([
      this.prisma.approvalTask.update({
        where: { id: taskId },
        data: { status: 'REJECTED', comment, handledAt: new Date() },
      }),
      this.prisma.approvalTask.updateMany({
        where: { instanceId: instance.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      }),
      this.prisma.approvalInstance.update({
        where: { id: instance.id },
        data: { status: 'REJECTED', finishedAt: new Date() },
      }),
    ])
    await this.setBizStatus(instance.module, instance.targetId, 'REJECTED')
    await this.sendApprovalResult(instance, user.id, {
      title: '审批被驳回',
      content: `「${instance.targetName}」被 ${user.name} 驳回：${comment}`,
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
    await this.setBizStatus(instance.module, instance.targetId, 'NONE')
    return { id: instanceId, name: instance.targetName }
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
      taskType: 'APPROVAL',
      status: 'PENDING',
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
      taskType: 'APPROVAL',
      status: { in: ['APPROVED', 'REJECTED'] },
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

      await this.prisma.$transaction([
        this.prisma.approvalInstance.update({
          where: { id: instanceId },
          data: { currentNodeIndex: nodeIndex },
        }),
        this.prisma.approvalTask.createMany({
          data: approvers.map((approverId) => ({
            tenantId: instance.tenantId,
            instanceId,
            nodeIndex,
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
                  nodeIndex,
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
    await this.setBizStatus(instance.module, instance.targetId, 'APPROVED')
    await this.effectApproved(instance.module, instance.targetId)
    await this.sendApprovalResult(instance, operatorId, {
      title: '审批已通过',
      content: `「${instance.targetName}」已审批通过`,
    })
  }

  private approvalResultEvent(module: string): MessageTaskEvent | undefined {
    if (module === 'quote') return 'BUSINESS_QUOTATION_APPROVAL'
    if (module === 'contract') return 'CONTRACT_APPROVAL'
    if (module === 'order') return 'ORDER_APPROVAL'
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

  private async enabledFlow(tenantId: string, module: string) {
    const formType = MODULE_TO_FORM_TYPE[module as ApprovalModule]
    if (!formType) return null
    return this.prisma.approvalFlow.findFirst({
      where: {
        tenantId,
        formType: toDbFormType(formType),
        enabled: true,
        deletedAt: null,
        createExecute: true,
      },
      include: {
        currentVersion: {
          include: {
            nodes: {
              where: { executeTiming: 'CREATE' },
              include: { approver: true },
              orderBy: { sort: 'asc' },
            },
          },
        },
      },
    })
  }

  private async targetInfo(
    tenantId: string,
    module: ApprovalModule,
    targetId: string,
  ): Promise<TargetInfo> {
    switch (module) {
      case 'quote': {
        const quote = await this.prisma.quote.findFirst({ where: { id: targetId, tenantId } })
        if (!quote) throw new NotFoundException('报价不存在')
        return {
          name: `报价 ${quote.name}`,
          amount: Number(quote.totalAmount),
          approvalStatus: quote.approvalStatus,
        }
      }
      case 'contract': {
        const contract = await this.prisma.contract.findFirst({ where: { id: targetId, tenantId } })
        if (!contract) throw new NotFoundException('合同不存在')
        return {
          name: `合同 ${contract.name}`,
          amount: Number(contract.amount),
          approvalStatus: contract.approvalStatus,
        }
      }
      case 'order': {
        const order = await this.prisma.order.findFirst({ where: { id: targetId, tenantId } })
        if (!order) throw new NotFoundException('订单不存在')
        return {
          name: `订单 ${order.name}`,
          amount: Number(order.amount),
          approvalStatus: order.approvalStatus,
        }
      }
      case 'receivableRecord': {
        const record = await this.prisma.receivableRecord.findFirst({
          where: { id: targetId, tenantId },
        })
        if (!record) throw new NotFoundException('回款记录不存在')
        return {
          name: `回款 ¥${Number(record.amount)}`,
          amount: Number(record.amount),
          approvalStatus: record.approvalStatus,
        }
      }
    }
  }

  private async setBizStatus(module: string, targetId: string, status: string) {
    const data = { approvalStatus: status }
    switch (module) {
      case 'quote':
        await this.prisma.quote.update({ where: { id: targetId }, data })
        break
      case 'contract':
        await this.prisma.contract.update({ where: { id: targetId }, data })
        break
      case 'order':
        await this.prisma.order.update({ where: { id: targetId }, data })
        break
      case 'receivableRecord':
        await this.prisma.receivableRecord.update({ where: { id: targetId }, data })
        break
    }
  }

  /** 审批通过后的业务生效动作 */
  private async effectApproved(module: string, targetId: string) {
    switch (module) {
      case 'quote':
        await this.prisma.quote.update({ where: { id: targetId }, data: { status: 'CONFIRMED' } })
        break
      case 'contract':
        await this.prisma.contract.update({
          where: { id: targetId },
          data: { status: 'EXECUTING' },
        })
        break
      default:
        break
    }
  }

  private async ensurePendingTask(user: AuthUser, taskId: string): Promise<ApprovalTask> {
    const task = await this.prisma.approvalTask.findFirst({
      where: {
        id: taskId,
        tenantId: user.tenantId,
        approverId: user.id,
        taskType: 'APPROVAL',
        status: 'PENDING',
      },
    })
    if (!task) throw new NotFoundException('待办任务不存在或已处理')
    return task
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
    const approvalTasks = tasks.filter((task) => task.taskType === 'APPROVAL')
    const myPending = approvalTasks.find(
      (task) => task.approverId === currentUserId && task.status === 'PENDING',
    )

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
        .sort((a, b) => a.nodeIndex - b.nodeIndex || a.createdAt.getTime() - b.createdAt.getTime())
        .map((t) => ({
          id: t.id,
          instanceId: t.instanceId,
          nodeIndex: t.nodeIndex,
          nodeName: t.nodeName,
          approverId: t.approverId,
          approverName: nameMap.get(t.approverId),
          taskType: t.taskType,
          status: t.status,
          comment: t.comment,
          handledAt: t.handledAt?.toISOString() ?? null,
        })),
      myPendingTaskId: myPending?.id ?? null,
    }
  }
}
