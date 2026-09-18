import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { EnterpriseGlobalTaskExecutionVO, EnterpriseGlobalTaskVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampToISOString } from '../../prisma/prisma8-temporal'
import { prisma8JsonValue } from '../../prisma/prisma8-values'
import type { SaveEnterpriseGlobalTaskDto } from './dto/global-task.dto'
import { EnterpriseAiRuntimeService } from './enterprise-ai-runtime.service'

type Prisma8Timestamp = Parameters<typeof prisma8TimestampToISOString>[0]

@Injectable()
export class EnterpriseGlobalTasksService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly runtime: EnterpriseAiRuntimeService,
  ) {}

  async list(tenantId: string, keyword?: string): Promise<EnterpriseGlobalTaskVO[]> {
    const normalized = keyword?.trim()
    const scoped = this.tasks().where({ tenantId })
    const filtered = normalized ? scoped.where((task) => task.name.ilike(`%${normalized}%`)) : scoped
    const rows = await filtered
      .orderBy([(task) => task.createdAt.desc(), (task) => task.id.asc()])
      .all()
    const modelNames = await this.modelNames(rows.map((row) => row.applicableModelId))
    return rows.map((row) =>
      this.toVO(row, row.applicableModelId ? modelNames.get(row.applicableModelId) ?? null : null),
    )
  }

  async get(tenantId: string, id: string): Promise<EnterpriseGlobalTaskVO> {
    const row = await this.tasks().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('全局任务不存在')
    const modelNames = await this.modelNames([row.applicableModelId])
    return this.toVO(row, row.applicableModelId ? modelNames.get(row.applicableModelId) ?? null : null)
  }

  async create(
    user: AuthUser,
    input: SaveEnterpriseGlobalTaskDto,
  ): Promise<EnterpriseGlobalTaskVO> {
    await this.assertNameAvailable(user.tenantId, input.name)
    const model = await this.assertModel(user.tenantId, input.applicableModelId)
    const row = await this.tasks().create({
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
      updatedAt: prisma8Now(),
    })
    return this.toVO(row, model?.displayName ?? null)
  }

  async update(
    user: AuthUser,
    id: string,
    input: SaveEnterpriseGlobalTaskDto,
  ): Promise<EnterpriseGlobalTaskVO> {
    const existing = await this.ensureOwned(user.tenantId, id)
    await this.assertNameAvailable(user.tenantId, input.name, id)
    const model = await this.assertModel(user.tenantId, input.applicableModelId)
    const row = await this.tasks().where({ id: existing.id, tenantId: user.tenantId }).update({
      name: input.name,
      triggerType: input.triggerType,
      executionCondition: input.executionCondition ?? '',
      executionAction: input.executionAction ?? '',
      confirmationLevel: input.confirmationLevel,
      applicableModelId: input.applicableModelId || null,
      enable: input.enable,
      updatedById: user.id,
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('全局任务不存在')
    return this.toVO(row, model?.displayName ?? null)
  }

  async setStatus(tenantId: string, id: string, enable: boolean): Promise<EnterpriseGlobalTaskVO> {
    const existing = await this.ensureOwned(tenantId, id)
    const row = await this.tasks().where({ id: existing.id, tenantId }).update({
      enable,
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('全局任务不存在')
    const modelNames = await this.modelNames([row.applicableModelId])
    return this.toVO(row, row.applicableModelId ? modelNames.get(row.applicableModelId) ?? null : null)
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.ensureOwned(tenantId, id)
    await this.tasks().where({ id: existing.id, tenantId }).delete()
    return { id }
  }

  async execute(user: AuthUser, id: string): Promise<EnterpriseGlobalTaskExecutionVO> {
    const task = await this.tasks().where({ id, tenantId: user.tenantId }).first()
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
    const created = await this.executionsTable().create({
      tenantId: user.tenantId,
      taskId: task.id,
      status: 'PENDING',
      input: prisma8JsonValue(input),
      updatedAt: prisma8Now(),
    })
    await this.executionsTable().where({ id: created.id, tenantId: user.tenantId }).update({
      status: 'RUNNING',
      startedAt: prisma8Now(),
      updatedAt: prisma8Now(),
    })

    try {
      const result = await this.runtime.complete(
        user.tenantId,
        task.applicableModelId,
        this.analysisPrompt(task),
        1024,
      )
      const row = await this.executionsTable().where({ id: created.id, tenantId: user.tenantId }).update({
        status: 'SUCCEEDED',
        output: prisma8JsonValue({
          analysis: result.text,
          modelId: result.modelId,
          modelName: result.modelName,
          displayName: result.displayName,
          provider: result.provider,
          latencyMs: result.latencyMs,
        }),
        finishedAt: prisma8Now(),
        updatedAt: prisma8Now(),
      })
      if (!row) throw new NotFoundException('执行记录不存在')
      return this.executionToVO(row, task.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const row = await this.executionsTable().where({ id: created.id, tenantId: user.tenantId }).update({
        status: 'FAILED',
        errorMessage: message.slice(0, 1000),
        finishedAt: prisma8Now(),
        updatedAt: prisma8Now(),
      })
      if (!row) throw new NotFoundException('执行记录不存在')
      return this.executionToVO(row, task.name)
    }
  }

  async executions(tenantId: string, taskId?: string): Promise<EnterpriseGlobalTaskExecutionVO[]> {
    if (taskId) await this.ensureOwned(tenantId, taskId)
    const rows = await this.executionsTable()
      .where({ tenantId, ...(taskId && { taskId }) })
      .orderBy([(row) => row.createdAt.desc(), (row) => row.id.asc()])
      .limit(200)
      .all()
    const taskNames = await this.taskNames(rows.map((row) => row.taskId))
    return rows.map((row) => this.executionToVO(row, taskNames.get(row.taskId) ?? '已删除任务'))
  }

  async stopExecution(tenantId: string, id: string): Promise<EnterpriseGlobalTaskExecutionVO> {
    const existing = await this.ensureExecution(tenantId, id)
    if (!['PENDING', 'RUNNING'].includes(existing.status)) {
      throw new BadRequestException('只有等待中或执行中的记录可以停止')
    }
    const row = await this.executionsTable().where({ id: existing.id, tenantId }).update({
      status: 'STOPPED',
      finishedAt: prisma8Now(),
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('执行记录不存在')
    const taskNames = await this.taskNames([row.taskId])
    return this.executionToVO(row, taskNames.get(row.taskId) ?? '已删除任务')
  }

  async removeExecution(tenantId: string, id: string) {
    const existing = await this.ensureExecution(tenantId, id)
    if (['PENDING', 'RUNNING'].includes(existing.status)) {
      throw new BadRequestException('执行中的记录请先停止')
    }
    await this.executionsTable().where({ id: existing.id, tenantId }).delete()
    return { id }
  }

  private async ensureOwned(tenantId: string, id: string) {
    const row = await this.tasks().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('全局任务不存在')
    return row
  }

  private async ensureExecution(tenantId: string, id: string) {
    const row = await this.executionsTable().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('执行记录不存在')
    return row
  }

  private async assertNameAvailable(tenantId: string, name: string, excludeId?: string) {
    const duplicate = await this.tasks().where({ tenantId, name }).select('id').first()
    if (duplicate && duplicate.id !== excludeId) throw new BadRequestException('全局任务名称已存在')
  }

  private async assertModel(tenantId: string, modelId?: string | null) {
    if (!modelId) return null
    const model = await this.models().where({ id: modelId, tenantId }).first()
    if (!model) throw new BadRequestException('适用模型不存在')
    if (!model.enable) throw new BadRequestException('适用模型当前未启用')
    return model
  }

  private tasks() {
    return this.prisma8.client.orm.public.EnterpriseGlobalTasks
  }

  private executionsTable() {
    return this.prisma8.client.orm.public.EnterpriseGlobalTaskExecutions
  }

  private models() {
    return this.prisma8.client.orm.public.EnterpriseAiModels
  }

  private async modelNames(modelIds: Array<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set(modelIds.filter((id): id is string => Boolean(id)))]
    if (!ids.length) return new Map()
    const rows = await this.models()
      .where((model) => model.id.in(ids))
      .select('id', 'displayName')
      .all()
    return new Map(rows.map((row) => [row.id, row.displayName]))
  }

  private async taskNames(taskIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(taskIds)]
    if (!ids.length) return new Map()
    const rows = await this.tasks().where((task) => task.id.in(ids)).select('id', 'name').all()
    return new Map(rows.map((row) => [row.id, row.name]))
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
    enable: boolean
    createdAt: Prisma8Timestamp
    updatedAt: Prisma8Timestamp
  }, applicableModelName: string | null): EnterpriseGlobalTaskVO {
    return {
      id: row.id,
      name: row.name,
      triggerType: row.triggerType as EnterpriseGlobalTaskVO['triggerType'],
      executionCondition: row.executionCondition,
      executionAction: row.executionAction,
      confirmationLevel: row.confirmationLevel as EnterpriseGlobalTaskVO['confirmationLevel'],
      applicableModelId: row.applicableModelId,
      applicableModelName,
      enable: row.enable,
      createdAt: prisma8TimestampToISOString(row.createdAt),
      updatedAt: prisma8TimestampToISOString(row.updatedAt),
    }
  }

  private executionToVO(row: {
    id: string
    taskId: string
    status: string
    input: unknown
    output: unknown
    errorMessage: string | null
    startedAt: Prisma8Timestamp | null
    finishedAt: Prisma8Timestamp | null
    createdAt: Prisma8Timestamp
  }, taskName: string): EnterpriseGlobalTaskExecutionVO {
    return {
      id: row.id,
      taskId: row.taskId,
      taskName,
      status: row.status as EnterpriseGlobalTaskExecutionVO['status'],
      input: row.input,
      output: row.output,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt ? prisma8TimestampToISOString(row.startedAt) : null,
      finishedAt: row.finishedAt ? prisma8TimestampToISOString(row.finishedAt) : null,
      createdAt: prisma8TimestampToISOString(row.createdAt),
    }
  }
}
