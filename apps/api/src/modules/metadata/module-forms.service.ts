import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  evaluateFormula,
  formulaVariables,
  type FieldConfig,
  type FieldOption,
  type FieldType,
  type FieldVO,
} from '@micromatrix/shared'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateFieldDto, UpdateFieldDto } from './dto/field.dto'
import { MODULE_SYSTEM_FIELDS, type SystemFieldTemplate } from './system-fields'

const SYSTEM_ACTOR = 'SYSTEM'

type DatabaseClient = PrismaService | Prisma.TransactionClient
type FieldWithBlob = Prisma.SysModuleFieldGetPayload<{ include: { blob: true } }>

interface StoredFieldProp {
  key: string
  required: boolean
  system: boolean
  hidden: boolean
  options: FieldOption[] | null
  config: FieldConfig | null
  span: number
  showInList: boolean
  listWidth: number | null
}

export interface ModuleFormConfigVO {
  formKey: string
  formProp: Record<string, unknown>
  fields: FieldVO[]
}

@Injectable()
export class ModuleFormsService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(organizationId: string, formKey: string): Promise<ModuleFormConfigVO> {
    return this.prisma.$transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey)
      const [blob, fields] = await Promise.all([
        tx.sysModuleFormBlob.findUnique({ where: { id: form.id } }),
        this.findFields(tx, form.id),
      ])
      return {
        formKey,
        formProp: this.parseObject(blob?.prop),
        fields: fields.map((field) => this.toVO(field, formKey)),
      }
    })
  }

  async listFields(organizationId: string, formKey: string): Promise<FieldVO[]> {
    return (await this.getConfig(organizationId, formKey)).fields
  }

  async listFieldsInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    formKey: string,
  ): Promise<FieldVO[]> {
    const form = await this.ensureForm(tx, organizationId, formKey)
    const fields = await this.findFields(tx, form.id)
    return fields.map((field) => this.toVO(field, formKey))
  }

  async saveFormProp(
    organizationId: string,
    formKey: string,
    formProp: Record<string, unknown>,
    actorId: string,
  ): Promise<ModuleFormConfigVO> {
    await this.prisma.$transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const now = BigInt(Date.now())
      await tx.sysModuleForm.update({
        where: { id: form.id },
        data: { updateUser: actorId, updateTime: now },
      })
      await tx.sysModuleFormBlob.upsert({
        where: { id: form.id },
        create: { id: form.id, prop: JSON.stringify(formProp) },
        update: { prop: JSON.stringify(formProp) },
      })
    })
    return this.getConfig(organizationId, formKey)
  }

  async createField(
    organizationId: string,
    formKey: string,
    dto: CreateFieldDto,
    actorId = SYSTEM_ACTOR,
  ): Promise<FieldVO> {
    this.validateFieldInput(dto)
    return this.prisma.$transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const duplicated = await tx.sysModuleField.findFirst({
        where: { formId: form.id, name: dto.label.trim() },
        select: { id: true },
      })
      if (duplicated) throw new BadRequestException('字段名称不能重复')

      const max = await tx.sysModuleField.aggregate({
        where: { formId: form.id },
        _max: { pos: true },
      })
      const key = `cf_${randomBytes(6).toString('hex')}`
      const now = BigInt(Date.now())
      const created = await tx.sysModuleField.create({
        data: {
          formId: form.id,
          internalKey: key,
          name: dto.label.trim(),
          type: dto.type,
          mobile: false,
          pos: (max._max.pos ?? -1n) + 1n,
          createUser: actorId,
          updateUser: actorId,
          createTime: now,
          updateTime: now,
          blob: { create: { prop: JSON.stringify(this.dtoToProp(key, dto, false)) } },
        },
        include: { blob: true },
      })
      return this.toVO(created, formKey)
    })
  }

  async updateField(
    organizationId: string,
    id: string,
    dto: UpdateFieldDto,
    actorId = SYSTEM_ACTOR,
  ): Promise<FieldVO> {
    this.validateFieldInput(dto)
    return this.prisma.$transaction(async (tx) => {
      const field = await this.ensureField(tx, organizationId, id)
      const current = this.parseProp(field)
      if (dto.label && dto.label.trim() !== field.name) {
        const duplicated = await tx.sysModuleField.findFirst({
          where: { formId: field.formId, name: dto.label.trim(), NOT: { id } },
          select: { id: true },
        })
        if (duplicated) throw new BadRequestException('字段名称不能重复')
      }

      if (current.system && dto.type && dto.type !== field.type) {
        throw new BadRequestException('系统字段不可修改类型')
      }
      if (
        dto.type &&
        dto.type !== field.type &&
        this.isBlobType(dto.type) !== this.isBlobType(field.type as FieldType)
      ) {
        const count = await this.countFieldValues(tx, id)
        if (count > 0) throw new BadRequestException('字段已有数据，不能切换普通值与大字段存储类型')
      }

      const next: StoredFieldProp = {
        ...current,
        required: dto.required ?? current.required,
        hidden: dto.hidden ?? current.hidden,
        options: dto.options === undefined ? current.options : dto.options,
        config: dto.config === undefined ? current.config : dto.config,
        span: dto.span ?? current.span,
        showInList: dto.showInList ?? current.showInList,
        listWidth: dto.listWidth === undefined ? current.listWidth : dto.listWidth,
      }
      const updated = await tx.sysModuleField.update({
        where: { id },
        data: {
          name: dto.label?.trim(),
          type: current.system ? undefined : dto.type,
          updateUser: actorId,
          updateTime: BigInt(Date.now()),
          blob: {
            upsert: {
              create: { prop: JSON.stringify(next) },
              update: { prop: JSON.stringify(next) },
            },
          },
        },
        include: { blob: true },
      })
      return this.toVO(updated, field.form.formKey)
    })
  }

  async deleteField(organizationId: string, id: string): Promise<{ id: string; name: string }> {
    return this.prisma.$transaction(async (tx) => {
      const field = await this.ensureField(tx, organizationId, id)
      if (this.parseProp(field).system) throw new BadRequestException('系统字段不可删除')
      await this.deleteFieldValues(tx, id)
      await tx.sysModuleField.delete({ where: { id } })
      return { id, name: field.name }
    })
  }

  async reorder(
    organizationId: string,
    formKey: string,
    orderedIds: string[],
    actorId = SYSTEM_ACTOR,
  ): Promise<{ count: number }> {
    return this.prisma.$transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const fields = await tx.sysModuleField.findMany({
        where: { formId: form.id },
        select: { id: true },
      })
      const existing = new Set(fields.map((field) => field.id))
      const uniqueIds = [...new Set(orderedIds)]
      if (uniqueIds.length !== fields.length || uniqueIds.some((id) => !existing.has(id))) {
        throw new BadRequestException('字段排序必须包含当前表单的全部字段且不能重复')
      }
      const now = BigInt(Date.now())
      await Promise.all(
        uniqueIds.map((id, index) =>
          tx.sysModuleField.update({
            where: { id },
            data: { pos: BigInt(index), updateTime: now, updateUser: actorId },
          }),
        ),
      )
      return { count: uniqueIds.length }
    })
  }

  toVO(field: FieldWithBlob, formKey: string): FieldVO {
    const prop = this.parseProp(field)
    return {
      id: field.id,
      module: formKey,
      key: prop.key || field.internalKey || field.id,
      label: field.name,
      type: field.type as FieldType,
      required: prop.required,
      system: prop.system,
      hidden: prop.hidden,
      options: prop.options,
      config: prop.config,
      sort: Number(field.pos),
      span: prop.span,
      showInList: prop.showInList,
      listWidth: prop.listWidth,
    }
  }

  private async ensureForm(
    tx: DatabaseClient,
    organizationId: string,
    formKey: string,
    actorId = SYSTEM_ACTOR,
  ) {
    const now = BigInt(Date.now())
    const form = await tx.sysModuleForm.upsert({
      where: { organizationId_formKey: { organizationId, formKey } },
      update: {},
      create: {
        organizationId,
        formKey,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
        blob: { create: { prop: '{}' } },
      },
    })
    await this.ensureSystemFields(tx, form.id, formKey, actorId)
    return form
  }

  private async ensureSystemFields(
    tx: DatabaseClient,
    formId: string,
    formKey: string,
    actorId: string,
  ): Promise<void> {
    const templates = MODULE_SYSTEM_FIELDS[formKey]
    if (!templates?.length) return
    const existing = await tx.sysModuleField.findMany({
      where: { formId, internalKey: { in: templates.map((field) => field.key) } },
      select: { internalKey: true },
    })
    const existingKeys = new Set(existing.map((field) => field.internalKey))
    const now = BigInt(Date.now())
    for (const template of templates) {
      if (existingKeys.has(template.key)) continue
      await tx.sysModuleField.create({
        data: {
          formId,
          internalKey: template.key,
          name: template.label,
          type: template.type,
          mobile: false,
          pos: BigInt(template.sort),
          createUser: actorId,
          updateUser: actorId,
          createTime: now,
          updateTime: now,
          blob: { create: { prop: JSON.stringify(this.templateToProp(template)) } },
        },
      })
    }
  }

  private findFields(tx: DatabaseClient, formId: string): Promise<FieldWithBlob[]> {
    return tx.sysModuleField.findMany({
      where: { formId },
      include: { blob: true },
      orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
    })
  }

  private async ensureField(tx: DatabaseClient, organizationId: string, id: string) {
    const field = await tx.sysModuleField.findFirst({
      where: { id, form: { organizationId } },
      include: { blob: true, form: true },
    })
    if (!field) throw new NotFoundException('字段不存在')
    return field
  }

  private parseProp(field: Pick<FieldWithBlob, 'internalKey' | 'blob'>): StoredFieldProp {
    const raw = this.parseObject(field.blob?.prop)
    return {
      key: typeof raw['key'] === 'string' ? raw['key'] : (field.internalKey ?? ''),
      required: raw['required'] === true,
      system: raw['system'] === true,
      hidden: raw['hidden'] === true,
      options: Array.isArray(raw['options']) ? (raw['options'] as FieldOption[]) : null,
      config: this.isRecord(raw['config']) ? (raw['config'] as FieldConfig) : null,
      span: typeof raw['span'] === 'number' ? raw['span'] : 12,
      showInList: raw['showInList'] !== false,
      listWidth: typeof raw['listWidth'] === 'number' ? raw['listWidth'] : null,
    }
  }

  private templateToProp(template: SystemFieldTemplate): StoredFieldProp {
    return {
      key: template.key,
      required: template.required ?? false,
      system: template.system ?? true,
      hidden: template.hidden ?? false,
      options: template.options ?? null,
      config: template.config ?? null,
      span: template.span ?? 12,
      showInList: template.showInList ?? true,
      listWidth: template.listWidth ?? null,
    }
  }

  private dtoToProp(key: string, dto: CreateFieldDto, system: boolean): StoredFieldProp {
    return {
      key,
      required: dto.required ?? false,
      system,
      hidden: dto.hidden ?? false,
      options: dto.options ?? null,
      config: dto.config ?? null,
      span: dto.span ?? 12,
      showInList: dto.showInList ?? true,
      listWidth: dto.listWidth ?? null,
    }
  }

  private validateFieldInput(dto: Partial<CreateFieldDto>): void {
    if (dto.type === 'formula' || dto.config?.formula) this.validateFormula(dto.config?.formula)
    if (dto.options) {
      const labels = dto.options.map((option) => option.label.trim())
      const values = dto.options.map((option) => option.value)
      if (new Set(labels).size !== labels.length || new Set(values).size !== values.length) {
        throw new BadRequestException('同一字段的选项名称和值不能重复')
      }
    }
  }

  private validateFormula(formula?: string): void {
    if (!formula?.trim()) throw new BadRequestException('计算字段必须配置公式')
    const vars = formulaVariables(formula)
    if (evaluateFormula(formula, Object.fromEntries(vars.map((value) => [value, 1]))) === null) {
      throw new BadRequestException('公式语法错误')
    }
  }

  private async countFieldValues(tx: DatabaseClient, fieldId: string): Promise<number> {
    const counts = await Promise.all([
      tx.clueField.count({ where: { fieldId } }),
      tx.clueFieldBlob.count({ where: { fieldId } }),
      tx.customerField.count({ where: { fieldId } }),
      tx.customerFieldBlob.count({ where: { fieldId } }),
      tx.customerContactField.count({ where: { fieldId } }),
      tx.customerContactFieldBlob.count({ where: { fieldId } }),
      tx.opportunityField.count({ where: { fieldId } }),
      tx.opportunityFieldBlob.count({ where: { fieldId } }),
      tx.productField.count({ where: { fieldId } }),
      tx.productFieldBlob.count({ where: { fieldId } }),
      tx.productPriceField.count({ where: { fieldId } }),
      tx.productPriceFieldBlob.count({ where: { fieldId } }),
      tx.opportunityQuotationField.count({ where: { fieldId } }),
      tx.opportunityQuotationFieldBlob.count({ where: { fieldId } }),
      tx.contractField.count({ where: { fieldId } }),
      tx.contractFieldBlob.count({ where: { fieldId } }),
      tx.contractPaymentPlanField.count({ where: { fieldId } }),
      tx.contractPaymentPlanFieldBlob.count({ where: { fieldId } }),
      tx.contractPaymentRecordField.count({ where: { fieldId } }),
      tx.contractPaymentRecordFieldBlob.count({ where: { fieldId } }),
      tx.contractInvoiceField.count({ where: { fieldId } }),
      tx.contractInvoiceFieldBlob.count({ where: { fieldId } }),
      tx.orderField.count({ where: { fieldId } }),
      tx.orderFieldBlob.count({ where: { fieldId } }),
    ])
    return counts.reduce((sum, count) => sum + count, 0)
  }

  private async deleteFieldValues(tx: DatabaseClient, fieldId: string): Promise<void> {
    await Promise.all([
      tx.clueField.deleteMany({ where: { fieldId } }),
      tx.clueFieldBlob.deleteMany({ where: { fieldId } }),
      tx.customerField.deleteMany({ where: { fieldId } }),
      tx.customerFieldBlob.deleteMany({ where: { fieldId } }),
      tx.customerContactField.deleteMany({ where: { fieldId } }),
      tx.customerContactFieldBlob.deleteMany({ where: { fieldId } }),
      tx.opportunityField.deleteMany({ where: { fieldId } }),
      tx.opportunityFieldBlob.deleteMany({ where: { fieldId } }),
      tx.productField.deleteMany({ where: { fieldId } }),
      tx.productFieldBlob.deleteMany({ where: { fieldId } }),
      tx.productPriceField.deleteMany({ where: { fieldId } }),
      tx.productPriceFieldBlob.deleteMany({ where: { fieldId } }),
      tx.opportunityQuotationField.deleteMany({ where: { fieldId } }),
      tx.opportunityQuotationFieldBlob.deleteMany({ where: { fieldId } }),
      tx.contractField.deleteMany({ where: { fieldId } }),
      tx.contractFieldBlob.deleteMany({ where: { fieldId } }),
      tx.contractPaymentPlanField.deleteMany({ where: { fieldId } }),
      tx.contractPaymentPlanFieldBlob.deleteMany({ where: { fieldId } }),
      tx.contractPaymentRecordField.deleteMany({ where: { fieldId } }),
      tx.contractPaymentRecordFieldBlob.deleteMany({ where: { fieldId } }),
      tx.contractInvoiceField.deleteMany({ where: { fieldId } }),
      tx.contractInvoiceFieldBlob.deleteMany({ where: { fieldId } }),
      tx.orderField.deleteMany({ where: { fieldId } }),
      tx.orderFieldBlob.deleteMany({ where: { fieldId } }),
    ])
  }

  private isBlobType(type: FieldType): boolean {
    return ['textarea', 'multiselect', 'checkbox'].includes(type)
  }

  private parseObject(value?: string | null): Record<string, unknown> {
    if (!value) return {}
    try {
      const parsed: unknown = JSON.parse(value)
      return this.isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }
}
