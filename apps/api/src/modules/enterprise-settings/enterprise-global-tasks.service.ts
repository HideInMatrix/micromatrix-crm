import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { EnterpriseGlobalTaskExecutionVO, EnterpriseGlobalTaskVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import type { SaveEnterpriseGlobalTaskDto } from './dto/global-task.dto'
import { EnterpriseAiRuntimeService } from './enterprise-ai-runtime.service'

@Injectable()
export class EnterpriseGlobalTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: EnterpriseAiRuntimeService,
  ) {}

  async list(tenantId: string, keyword?: string): Promise<EnterpriseGlobalTaskVO[]> {
    const normalized = keyword?.trim()
    const rows = await this.prisma.enterpriseGlobalTask.findMany({
      where: {
        tenantId,
        ...(normalized && { name: { contains: normalized, mode: 'insensitive' } }),
      },
      include: { applicableModel: { select: { displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map((row) => this.toVO(row))
  }

  async get(tenantId: string, id: string): Promise<EnterpriseGlobalTaskVO> {
    const row = await this.prisma.enterpriseGlobalTask.findFirst({
      where: { id, tenantId },
      include: { applicableModel: { select: { displayName: true } } },
    })
    if (!row) throw new NotFoundException('全局任务不存在')
    return this.toVO(row)
  }

  async create(
    user: AuthUser,
    input: SaveEnterpriseGlobalTaskDto,
  ): Promise<EnterpriseGlobalTaskVO> {
    await this.assertNameAvailable(user.tenantId, input.name)
    await this.assertModel(user.tenantId, input.applicableModelId)
    const row = await this.prisma.enterpriseGlobalTask.create({
      data: {
        tenantId: user.tenantId,
        name: input.name,
        triggerType: input.triggerType,
        executionCondition: input.executionCondition ?? '',
        executionAction: input.executionAction ?? '',
        confirmationLevel: input.confirmationLevel,
        applicableModelId: input.applicableModelId || null,
        enable: input.enable,
        createdById: user.id,
        updatedById: user.id,
      },
      include: { applicableModel: { select: { displayName: true } } },
    })
    return this.toVO(row)
  }

  async update(
    user: AuthUser,
    id: string,
    input: SaveEnterpriseGlobalTaskDto,
  ): Promise<EnterpriseGlobalTaskVO> {
    await this.ensureOwned(user.tenantId, id)
    await this.assertNameAvailable(user.tenantId, input.name, id)
    await this.assertModel(user.tenantId, input.applicableModelId)
    const row = await this.prisma.enterpriseGlobalTask.update({
      where: { id },
      data: {
        name: input.name,
        triggerType: input.triggerType,
        executionCondition: input.executionCondition ?? '',
        executionAction: input.executionAction ?? '',
        confirmationLevel: input.confirmationLevel,
        applicableModelId: input.applicableModelId || null,
        enable: input.enable,
        updatedById: user.id,
      },
      include: { applicableModel: { select: { displayName: true } } },
    })
    return this.toVO(row)
  }

  async setStatus(tenantId: string, id: string, enable: boolean): Promise<EnterpriseGlobalTaskVO> {
    await this.ensureOwned(tenantId, id)
    const row = await this.prisma.enterpriseGlobalTask.update({
      where: { id },
      data: { enable },
      include: { applicableModel: { select: { displayName: true } } },
    })
    return this.toVO(row)
  }

  async remove(tenantId: string, id: string) {
    await this.ensureOwned(tenantId, id)
    await this.prisma.enterpriseGlobalTask.delete({ where: { id } })
    return { id }
  }

  async execute(user: AuthUser, id: string): Promise<EnterpriseGlobalTaskExecutionVO> {
    const task = await this.prisma.enterpriseGlobalTask.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!task) throw new NotFoundException('全局任务不存在')
    if (!task.enable) throw new BadRequestException('全局任务当前未启用')
    if (task.confirmationLevel !== 'only_analysis') {
      throw new BadRequestException(
        '当前运行时只支持“仅分析”任务，ask/auto 需等待 Agent/Tool Runtime',
      )
    }
    if (!task.applicableModelId) throw new BadRequestException('全局任务未绑定适用 AI 模型')

    const input = {
      trigger: 'manual',
      taskName: task.name,
      executionCondition: task.executionCondition,
      executionAction: task.executionAction,
      requestedById: user.id,
      requestedAt: new Date().toISOString(),
    }
    const created = await this.prisma.enterpriseGlobalTaskExecution.create({
      data: { tenantId: user.tenantId, taskId: task.id, status: 'PENDING', input },
    })
    await this.prisma.enterpriseGlobalTaskExecution.update({
      where: { id: created.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    })

    try {
      const result = await this.runtime.complete(
        user.tenantId,
        task.applicableModelId,
        this.analysisPrompt(task),
        1024,
      )
      const row = await this.prisma.enterpriseGlobalTaskExecution.update({
        where: { id: created.id },
        data: {
          status: 'SUCCEEDED',
          output: {
            analysis: result.text,
            modelId: result.modelId,
            modelName: result.modelName,
            displayName: result.displayName,
            provider: result.provider,
            latencyMs: result.latencyMs,
          },
          finishedAt: new Date(),
        },
        include: { task: { select: { name: true } } },
      })
      return this.executionToVO(row)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const row = await this.prisma.enterpriseGlobalTaskExecution.update({
        where: { id: created.id },
        data: { status: 'FAILED', errorMessage: message.slice(0, 1000), finishedAt: new Date() },
        include: { task: { select: { name: true } } },
      })
      return this.executionToVO(row)
    }
  }

  async executions(tenantId: string, taskId?: string): Promise<EnterpriseGlobalTaskExecutionVO[]> {
    if (taskId) await this.ensureOwned(tenantId, taskId)
    const rows = await this.prisma.enterpriseGlobalTaskExecution.findMany({
      where: { tenantId, ...(taskId && { taskId }) },
      include: { task: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
    })
    return rows.map((row) => this.executionToVO(row))
  }

  async stopExecution(tenantId: string, id: string): Promise<EnterpriseGlobalTaskExecutionVO> {
    const existing = await this.ensureExecution(tenantId, id)
    if (!['PENDING', 'RUNNING'].includes(existing.status)) {
      throw new BadRequestException('只有等待中或执行中的记录可以停止')
    }
    const row = await this.prisma.enterpriseGlobalTaskExecution.update({
      where: { id: existing.id },
      data: { status: 'STOPPED', finishedAt: new Date() },
      include: { task: { select: { name: true } } },
    })
    return this.executionToVO(row)
  }

  async removeExecution(tenantId: string, id: string) {
    const existing = await this.ensureExecution(tenantId, id)
    if (['PENDING', 'RUNNING'].includes(existing.status)) {
      throw new BadRequestException('执行中的记录请先停止')
    }
    await this.prisma.enterpriseGlobalTaskExecution.delete({ where: { id: existing.id } })
    return { id }
  }

  private ensureOwned(tenantId: string, id: string) {
    return this.prisma.enterpriseGlobalTask.findFirst({ where: { id, tenantId } }).then((row) => {
      if (!row) throw new NotFoundException('全局任务不存在')
      return row
    })
  }

  private ensureExecution(tenantId: string, id: string) {
    return this.prisma.enterpriseGlobalTaskExecution
      .findFirst({ where: { id, tenantId } })
      .then((row) => {
        if (!row) throw new NotFoundException('执行记录不存在')
        return row
      })
  }

  private async assertNameAvailable(tenantId: string, name: string, excludeId?: string) {
    const duplicate = await this.prisma.enterpriseGlobalTask.findFirst({
      where: { tenantId, name, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException('全局任务名称已存在')
  }

  private async assertModel(tenantId: string, modelId?: string | null) {
    if (!modelId) return
    const model = await this.prisma.enterpriseAiModel.findFirst({
      where: { id: modelId, tenantId },
    })
    if (!model) throw new BadRequestException('适用模型不存在')
    if (!model.enable) throw new BadRequestException('适用模型当前未启用')
  }

  private analysisPrompt(task: {
    name: string
    executionCondition: string
    executionAction: string
  }) {
    return [
      '你是 MicroMatrix CRM 的全局任务分析执行器。',
      '本次运行模式为 only_analysis：只能分析和给出建议，不允许声称已经修改任何 CRM 数据或调用外部业务工具。',
      `任务名称：${task.name}`,
      `执行条件：${task.executionCondition || '未指定，按手动触发处理'}`,
      `执行动作：${task.executionAction || '未指定'}`,
      '请用简洁中文输出：1. 条件判断；2. 分析结果；3. 建议动作。',
    ].join('\n')
  }

  private toVO(row: {
    id: string
    name: string
    triggerType: string
    executionCondition: string
    executionAction: string
    confirmationLevel: string
    applicableModelId: string | null
    applicableModel: { displayName: string } | null
    enable: boolean
    createdAt: Date
    updatedAt: Date
  }): EnterpriseGlobalTaskVO {
    return {
      id: row.id,
      name: row.name,
      triggerType: row.triggerType as EnterpriseGlobalTaskVO['triggerType'],
      executionCondition: row.executionCondition,
      executionAction: row.executionAction,
      confirmationLevel: row.confirmationLevel as EnterpriseGlobalTaskVO['confirmationLevel'],
      applicableModelId: row.applicableModelId,
      applicableModelName: row.applicableModel?.displayName ?? null,
      enable: row.enable,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private executionToVO(row: {
    id: string
    taskId: string
    task: { name: string }
    status: string
    input: unknown
    output: unknown
    errorMessage: string | null
    startedAt: Date | null
    finishedAt: Date | null
    createdAt: Date
  }): EnterpriseGlobalTaskExecutionVO {
    return {
      id: row.id,
      taskId: row.taskId,
      taskName: row.task.name,
      status: row.status as EnterpriseGlobalTaskExecutionVO['status'],
      input: row.input,
      output: row.output,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
