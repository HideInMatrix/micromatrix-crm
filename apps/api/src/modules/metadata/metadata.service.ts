import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  evaluateFormula,
  formulaVariables,
  isCustomFieldKey,
  type FieldConfig,
  type FieldOption,
  type FieldType,
  type FieldVO,
} from '@micromatrix/shared'
import { FieldDefinition, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateFieldDto, UpdateFieldDto } from './dto/field.dto'
import { MODULE_SYSTEM_FIELDS } from './system-fields'

@Injectable()
export class MetadataService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取模块字段（首次访问自动初始化系统字段） */
  async listFields(tenantId: string, module: string): Promise<FieldVO[]> {
    await this.ensureSystemFields(tenantId, module)
    const fields = await this.prisma.fieldDefinition.findMany({
      where: { tenantId, module },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    })
    return fields.map((f) => this.toVO(f))
  }

  /** 字段 Map（key → FieldVO），供筛选与校验使用 */
  async fieldsMap(tenantId: string, module: string): Promise<Map<string, FieldVO>> {
    const fields = await this.listFields(tenantId, module)
    return new Map(fields.map((f) => [f.key, f]))
  }

  async createField(tenantId: string, module: string, dto: CreateFieldDto): Promise<FieldVO> {
    if (dto.type === 'formula') this.validateFormula(dto.config?.formula)
    const maxSort = await this.prisma.fieldDefinition.aggregate({
      where: { tenantId, module },
      _max: { sort: true },
    })
    const field = await this.prisma.fieldDefinition.create({
      data: {
        tenantId,
        module,
        key: `cf_${Math.random().toString(36).slice(2, 10)}`,
        label: dto.label,
        type: dto.type,
        required: dto.required ?? false,
        options: (dto.options ?? undefined) as Prisma.InputJsonValue | undefined,
        config: (dto.config ?? undefined) as Prisma.InputJsonValue | undefined,
        span: dto.span ?? 12,
        showInList: dto.showInList ?? true,
        listWidth: dto.listWidth,
        sort: (maxSort._max.sort ?? 0) + 1,
      },
    })
    return this.toVO(field)
  }

  async updateField(tenantId: string, id: string, dto: UpdateFieldDto): Promise<FieldVO> {
    const field = await this.ensureExists(tenantId, id)
    if (dto.config?.formula) this.validateFormula(dto.config.formula)

    const data: Prisma.FieldDefinitionUpdateInput = {
      label: dto.label,
      required: dto.required,
      hidden: dto.hidden,
      options: (dto.options ?? undefined) as Prisma.InputJsonValue | undefined,
      config: (dto.config ?? undefined) as Prisma.InputJsonValue | undefined,
      span: dto.span,
      showInList: dto.showInList,
      listWidth: dto.listWidth,
    }
    // 系统字段不允许修改类型
    if (!field.system && dto.type) data.type = dto.type

    const updated = await this.prisma.fieldDefinition.update({ where: { id }, data })
    return this.toVO(updated)
  }

  async deleteField(tenantId: string, id: string) {
    const field = await this.ensureExists(tenantId, id)
    if (field.system) throw new BadRequestException('系统字段不可删除')
    await this.prisma.fieldDefinition.delete({ where: { id } })
    return { id, name: field.label }
  }

  async reorder(tenantId: string, module: string, orderedIds: string[]) {
    const fields = await this.prisma.fieldDefinition.findMany({ where: { tenantId, module } })
    const idSet = new Set(fields.map((f) => f.id))
    const updates = orderedIds
      .filter((id) => idSet.has(id))
      .map((id, index) =>
        this.prisma.fieldDefinition.update({ where: { id }, data: { sort: index } }),
      )
    await this.prisma.$transaction(updates)
    return { count: updates.length }
  }

  /**
   * 校验并清洗自定义字段数据：仅保留已定义的 cf_ 字段；
   * requireAll=true（新建）时校验全部必填自定义字段。
   */
  async validateCustomData(
    tenantId: string,
    module: string,
    input: Record<string, unknown> | undefined,
    options: { requireAll: boolean },
  ): Promise<Record<string, unknown>> {
    const fields = await this.fieldsMap(tenantId, module)
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(input ?? {})) {
      const field = fields.get(key)
      if (!field || !isCustomFieldKey(key) || field.type === 'formula') continue
      result[key] = value
    }

    for (const field of fields.values()) {
      if (!isCustomFieldKey(field.key) || !field.required || field.hidden) continue
      const value = options.requireAll
        ? result[field.key]
        : field.key in result
          ? result[field.key]
          : '__SKIP__'
      if (value === '__SKIP__') continue
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        throw new BadRequestException(`「${field.label}」为必填项`)
      }
    }
    return result
  }

  /** 计算对象上全部公式字段的值（列表/详情响应时调用） */
  computeFormulas(
    fields: FieldVO[],
    record: Record<string, unknown>,
    customData: Record<string, unknown>,
  ): Record<string, number | null> {
    const vars: Record<string, unknown> = { ...record, ...customData }
    const output: Record<string, number | null> = {}
    for (const field of fields) {
      if (field.type !== 'formula' || !field.config?.formula) continue
      output[field.key] = evaluateFormula(field.config.formula, vars)
    }
    return output
  }

  private validateFormula(formula?: string) {
    if (!formula?.trim()) throw new BadRequestException('计算字段必须配置公式')
    const vars = formulaVariables(formula)
    if (evaluateFormula(formula, Object.fromEntries(vars.map((v) => [v, 1]))) === null) {
      throw new BadRequestException('公式语法错误')
    }
  }

  private async ensureSystemFields(tenantId: string, module: string): Promise<void> {
    const template = MODULE_SYSTEM_FIELDS[module]
    if (!template) return
    const count = await this.prisma.fieldDefinition.count({
      where: { tenantId, module, system: true },
    })
    if (count > 0) return
    await this.prisma.fieldDefinition.createMany({
      data: template.map((t) => ({
        tenantId,
        module,
        key: t.key,
        label: t.label,
        type: t.type,
        required: t.required ?? false,
        system: true,
        options: (t.options ?? undefined) as Prisma.InputJsonValue | undefined,
        span: t.span ?? 12,
        showInList: t.showInList ?? true,
        listWidth: t.listWidth,
        sort: t.sort,
      })),
      skipDuplicates: true,
    })
  }

  private async ensureExists(tenantId: string, id: string) {
    const field = await this.prisma.fieldDefinition.findFirst({ where: { id, tenantId } })
    if (!field) throw new NotFoundException('字段不存在')
    return field
  }

  private toVO(field: FieldDefinition): FieldVO {
    return {
      id: field.id,
      module: field.module,
      key: field.key,
      label: field.label,
      type: field.type as FieldType,
      required: field.required,
      system: field.system,
      hidden: field.hidden,
      options: (field.options as FieldOption[] | null) ?? null,
      config: (field.config as FieldConfig | null) ?? null,
      sort: field.sort,
      span: field.span,
      showInList: field.showInList,
      listWidth: field.listWidth,
    }
  }
}
