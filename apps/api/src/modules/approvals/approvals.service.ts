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

type ApprovalExecuteTimingValue = 'CREATE' | 'UPDATE' | 'DELETE'

interface QuotationBusinessSnapshot {
  quotation: {
    name: string
    opportunityId: string
    untilTime: string
    amount: string
  }
  fields: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  fieldBlobs: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  snapshots: Array<{
    id: string
    quotationId: string
    quotationProp: string | null
    quotationValue: string | null
  }>
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly businessNotifications: BusinessNotificationsService,
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

  /** 报价 UPDATE 审批命中前保存编辑前业务快照。 */
  async captureBusinessSnapshot(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
  ): Promise<Prisma.InputJsonValue | null> {
    if (module !== 'quote') return null
    const quotation = await this.prisma.opportunityQuotation.findFirst({
      where: { id: targetId, organizationId: user.tenantId },
      select: { name: true, opportunityId: true, untilTime: true, amount: true },
    })
    if (!quotation) throw new NotFoundException('报价不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.opportunityQuotationField.findMany({ where: { resourceId: targetId } }),
      this.prisma.opportunityQuotationFieldBlob.findMany({ where: { resourceId: targetId } }),
      this.prisma.opportunityQuotationSnapshot.findMany({ where: { quotationId: targetId } }),
    ])
    const snapshot: QuotationBusinessSnapshot = {
      quotation: {
        name: quotation.name,
        opportunityId: quotation.opportunityId,
        untilTime: quotation.untilTime.toString(),
        amount: quotation.amount.toString(),
      },
      fields,
      fieldBlobs,
      snapshots,
    }
    return snapshot as unknown as Prisma.InputJsonValue
  }

  // ===== 提交与审批 =====

  async submit(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    executeTiming: ApprovalExecuteTimingValue = 'CREATE',
    businessSnapshot?: Prisma.InputJsonValue | null,
  ) {
    if (module === 'receivableRecord') {
      throw new BadRequestException('回款记录审批已退出流程设置，请使用 Cordys 发票审批链路')
    }
    const target = await this.targetInfo(user.tenantId, module, targetId)
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
        executeTiming,
        module,
        targetId,
        targetName: target.name,
        summary: target.amount ? `金额 ¥${target.amount.toLocaleString('zh-CN')}` : null,
        nodesSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        businessSnapshot: businessSnapshot ?? Prisma.DbNull,
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
    await this.restoreBusinessSnapshot(instance, user.id)
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
    await this.setBizStatus(
      instance.module,
      instance.targetId,
      instance.module === 'quote' ? 'REVOKED' : 'NONE',
    )
    await this.restoreBusinessSnapshot(instance, user.id)
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
    await this.effectApproved(instance)
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

  private async targetInfo(
    tenantId: string,
    module: ApprovalModule,
    targetId: string,
  ): Promise<TargetInfo> {
    switch (module) {
      case 'quote': {
        const quote = await this.prisma.opportunityQuotation.findFirst({
          where: { id: targetId, organizationId: tenantId },
        })
        if (!quote) throw new NotFoundException('报价不存在')
        return {
          name: `报价 ${quote.name}`,
          amount: Number(quote.amount),
          approvalStatus: this.normalizeQuotationApprovalStatus(quote.approvalStatus),
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
      case 'quote': {
        const approvalStatus = this.toQuotationApprovalStatus(status)
        const updated = await this.prisma.opportunityQuotation.update({
          where: { id: targetId },
          data: {
            approvalStatus,
            ...(approvalStatus === 'APPROVED' ? { approved: true } : {}),
          },
        })
        await this.syncQuotationSnapshot(targetId, approvalStatus, updated.approved)
        break
      }
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

  /** 审批通过后的业务生效动作。DELETE 报价直到审批通过才真正删除。 */
  private async effectApproved(instance: ApprovalInstance) {
    switch (instance.module) {
      case 'quote':
        if (instance.executeTiming === 'DELETE') {
          await this.prisma.opportunityQuotation.delete({ where: { id: instance.targetId } })
        }
        break
      case 'contract':
        await this.prisma.contract.update({
          where: { id: instance.targetId },
          data: { status: 'EXECUTING' },
        })
        break
      default:
        break
    }
  }

  /** Cordys UPDATE 审批驳回/撤回：恢复编辑前业务数据，但保留当前审批状态与 approved 历史事实。 */
  private async restoreBusinessSnapshot(instance: ApprovalInstance, operatorId: string) {
    if (instance.module !== 'quote' || instance.executeTiming !== 'UPDATE' || !instance.businessSnapshot) {
      return
    }
    const snapshot = instance.businessSnapshot as unknown as QuotationBusinessSnapshot
    if (!snapshot.quotation || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) {
      return
    }
    const current = await this.prisma.opportunityQuotation.findUnique({
      where: { id: instance.targetId },
      select: { approvalStatus: true, approved: true },
    })
    if (!current) return

    await this.prisma.$transaction(async (tx) => {
      await tx.opportunityQuotation.update({
        where: { id: instance.targetId },
        data: {
          name: snapshot.quotation.name,
          opportunityId: snapshot.quotation.opportunityId,
          untilTime: BigInt(snapshot.quotation.untilTime),
          amount: new Prisma.Decimal(snapshot.quotation.amount),
          updateTime: BigInt(Date.now()),
          updateUser: operatorId,
        },
      })
      await Promise.all([
        tx.opportunityQuotationField.deleteMany({ where: { resourceId: instance.targetId } }),
        tx.opportunityQuotationFieldBlob.deleteMany({ where: { resourceId: instance.targetId } }),
        tx.opportunityQuotationSnapshot.deleteMany({ where: { quotationId: instance.targetId } }),
      ])
      if (snapshot.fields.length) await tx.opportunityQuotationField.createMany({ data: snapshot.fields })
      if (snapshot.fieldBlobs.length) {
        await tx.opportunityQuotationFieldBlob.createMany({ data: snapshot.fieldBlobs })
      }
      if (snapshot.snapshots?.length) {
        await tx.opportunityQuotationSnapshot.createMany({ data: snapshot.snapshots })
      }
    })
    await this.syncQuotationSnapshot(instance.targetId, current.approvalStatus, current.approved)
  }

  private normalizeQuotationApprovalStatus(status: string) {
    if (status === 'APPROVING') return 'PENDING'
    if (status === 'UNAPPROVED') return 'REJECTED'
    if (status === 'REVOKED') return 'NONE'
    return status
  }

  private toQuotationApprovalStatus(status: string) {
    if (status === 'PENDING') return 'APPROVING'
    if (status === 'REJECTED') return 'UNAPPROVED'
    return status
  }

  private async syncQuotationSnapshot(
    quotationId: string,
    approvalStatus: string,
    approved: boolean,
  ) {
    const snapshots = await this.prisma.opportunityQuotationSnapshot.findMany({
      where: { quotationId },
    })
    for (const snapshot of snapshots) {
      if (!snapshot.quotationValue) continue
      let value: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(snapshot.quotationValue)
        value =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {}
      } catch {
        value = {}
      }
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.opportunityQuotationSnapshot.update({
        where: { id: snapshot.id },
        data: { quotationValue: JSON.stringify(value) },
      })
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
