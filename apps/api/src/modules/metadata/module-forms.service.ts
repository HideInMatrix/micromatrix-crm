import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {
  applyFormLinkScenario,
  evaluateFormula,
  FORM_LINK_SCENARIO_KEYS,
  formulaVariables,
  isFormLinkFieldCompatible,
  isSubTableFieldType,
  type DataSourceSubFieldLinkField,
  type FieldConfig,
  type FieldLinkOption,
  type FieldOption,
  type FieldType,
  type FieldVO,
  type FormLinkProp,
  type FormLinkScenario,
  type FormLinkScenarioKey,
} from '@micromatrix/shared'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateFieldDto, UpdateFieldDto } from './dto/field.dto'
import { MODULE_SYSTEM_FIELDS, type SystemFieldTemplate } from './system-fields'

const SYSTEM_ACTOR = 'SYSTEM'
const CACHE_TTL_SECONDS = 10 * 60

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
  subFields: StoredSubFieldProp[] | null
}

interface StoredSubFieldProp {
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  options: FieldOption[] | null
  config: FieldConfig | null
  sort: number
}

export interface ModuleFormConfigVO {
  formKey: string
  formProp: Record<string, unknown>
  fields: FieldVO[]
}

@Injectable()
export class ModuleFormsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  async getConfig(organizationId: string, formKey: string): Promise<ModuleFormConfigVO> {
    if (this.cache) {
      return this.cache.remember({
        tenantId: organizationId,
        namespace: this.cacheNamespace(formKey),
        key: 'config',
        ttlSeconds: CACHE_TTL_SECONDS,
        loader: () => this.loadConfig(organizationId, formKey),
      })
    }
    return this.loadConfig(organizationId, formKey)
  }

  private async loadConfig(organizationId: string, formKey: string): Promise<ModuleFormConfigVO> {
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

  async resolveFormLink(
    organizationId: string,
    targetFormKey: string,
    sourceFormKey: string,
    scenarioKey: FormLinkScenarioKey,
    sourceValues: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const [targetConfig, sourceConfig] = await Promise.all([
      this.getConfig(organizationId, targetFormKey),
      this.getConfig(organizationId, sourceFormKey),
    ])
    const linkProp = this.parseFormLinkProp(targetConfig.formProp['linkProp'])
    const scenario = (linkProp[sourceFormKey] ?? []).find((item) => item.key === scenarioKey)
    if (!scenario) return {}
    this.validateFormLinkScenario(targetConfig.fields, sourceConfig.fields, scenario)
    return applyFormLinkScenario(sourceConfig.fields, targetConfig.fields, scenario, sourceValues)
  }

  async saveFormProp(
    organizationId: string,
    formKey: string,
    formProp: Record<string, unknown>,
    actorId: string,
  ): Promise<ModuleFormConfigVO> {
    await this.validateFormPropLinkage(organizationId, formKey, formProp)
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
    await this.invalidateForm(organizationId, formKey)
    return this.getConfig(organizationId, formKey)
  }

  async createField(
    organizationId: string,
    formKey: string,
    dto: CreateFieldDto,
    actorId = SYSTEM_ACTOR,
  ): Promise<FieldVO> {
    this.validateFieldInput(dto)
    const result = await this.prisma.$transaction(async (tx) => {
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
      const storedProp = this.dtoToProp(key, dto, false)
      if (dto.type === 'sub_product') {
        this.validateStoredSubFields(storedProp.subFields ?? [])
        this.validateSubTableColumns(storedProp.config, storedProp.subFields ?? [])
      }
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
          blob: { create: { prop: JSON.stringify(storedProp) } },
        },
        include: { blob: true },
      })
      const result = this.toVO(created, formKey)
      const allFields = (await this.findFields(tx, form.id)).map((item) => this.toVO(item, formKey))
      this.validateFormLinkage(allFields)
      return result
    })
    await this.invalidateForm(organizationId, formKey)
    return result
  }

  async updateField(
    organizationId: string,
    id: string,
    dto: UpdateFieldDto,
    actorId = SYSTEM_ACTOR,
  ): Promise<FieldVO> {
    this.validateFieldInput(dto)
    const result = await this.prisma.$transaction(async (tx) => {
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

      const nextType = (dto.type ?? field.type) as FieldType
      if (dto.type && dto.type !== field.type && dto.type === 'sub_product') {
        const count = await this.countFieldValues(tx, id)
        if (count > 0) throw new BadRequestException('字段已有数据，不能切换为子表格类型')
      }
      if (dto.type && dto.type !== field.type && field.type === 'sub_product') {
        const subIds = current.subFields?.map((subField) => subField.id) ?? []
        const counts = await Promise.all(subIds.map((subId) => this.countFieldValues(tx, subId)))
        if (counts.some((count) => count > 0)) {
          throw new BadRequestException('子表格已有数据，不能修改父字段类型')
        }
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
        subFields:
          dto.subFields === undefined
            ? current.subFields
            : this.normalizeSubFields(dto.subFields, current.subFields),
      }
      if ((dto.type ?? field.type) === 'sub_product') {
        next.required = false
        next.span = 24
        next.showInList = false
        next.listWidth = null
      }
      if (
        ['data_source', 'data_source_multiple'].includes(field.type) &&
        current.config?.dataSourceType &&
        next.config?.dataSourceType !== current.config.dataSourceType
      ) {
        throw new BadRequestException('已保存的数据源字段不能修改数据源类型，请删除字段后重建')
      }
      this.validateFieldSpecificConfig(nextType, next.config)
      if (nextType === 'sub_product') {
        this.validateStoredSubFields(next.subFields ?? [])
        this.validateSubTableColumns(next.config, next.subFields ?? [])
        await this.reconcileSubFieldValues(tx, current.subFields ?? [], next.subFields ?? [])
      } else {
        next.subFields = null
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
      const result = this.toVO(updated, field.form.formKey)
      const allFields = (await this.findFields(tx, field.formId)).map((item) =>
        this.toVO(item, field.form.formKey),
      )
      this.validateFormLinkage(allFields)
      return result
    })
    await this.invalidateForm(organizationId, result.module)
    return result
  }

  async deleteField(organizationId: string, id: string): Promise<{ id: string; name: string }> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const field = await this.ensureField(tx, organizationId, id)
      const prop = this.parseProp(field)
      if (prop.system) throw new BadRequestException('系统字段不可删除')
      if (field.type === 'sub_product') {
        const childIds = prop.subFields?.map((subField) => subField.id) ?? []
        await Promise.all([
          tx.customFormDataField.deleteMany({
            where: {
              OR: [{ refSubId: id }, ...(childIds.length ? [{ fieldId: { in: childIds } }] : [])],
            },
          }),
          tx.customFormDataFieldBlob.deleteMany({
            where: {
              OR: [{ refSubId: id }, ...(childIds.length ? [{ fieldId: { in: childIds } }] : [])],
            },
          }),
        ])
      }
      await this.deleteFieldValues(tx, id)
      await tx.sysModuleField.delete({ where: { id } })
      return { result: { id, name: field.name }, formKey: field.form.formKey }
    })
    await this.invalidateForm(organizationId, deleted.formKey)
    return deleted.result
  }

  async reorder(
    organizationId: string,
    formKey: string,
    orderedIds: string[],
    actorId = SYSTEM_ACTOR,
  ): Promise<{ count: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
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
    await this.invalidateForm(organizationId, formKey)
    return result
  }

  async invalidateFormCache(organizationId: string, formKey: string): Promise<void> {
    await this.invalidateForm(organizationId, formKey)
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
      subFields: prop.subFields?.map((subField) => this.subFieldToVO(subField, formKey)) ?? null,
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

  private cacheNamespace(formKey: string): string {
    return `metadata:${formKey}`
  }

  private async invalidateForm(organizationId: string, formKey: string): Promise<void> {
    await this.cache?.invalidate(organizationId, this.cacheNamespace(formKey))
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
      options: this.parseFieldOptions(raw['options']),
      config: this.isRecord(raw['config']) ? (raw['config'] as FieldConfig) : null,
      span: typeof raw['span'] === 'number' ? raw['span'] : 12,
      showInList: raw['showInList'] !== false,
      listWidth: typeof raw['listWidth'] === 'number' ? raw['listWidth'] : null,
      subFields: this.parseStoredSubFields(raw['subFields']),
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
      subFields: null,
    }
  }

  private dtoToProp(key: string, dto: CreateFieldDto, system: boolean): StoredFieldProp {
    return {
      key,
      required: dto.type === 'sub_product' ? false : (dto.required ?? false),
      system,
      hidden: dto.hidden ?? false,
      options: dto.options ?? null,
      config: dto.config ?? null,
      span: dto.type === 'sub_product' ? 24 : (dto.span ?? 12),
      showInList: dto.type === 'sub_product' ? false : (dto.showInList ?? true),
      listWidth: dto.type === 'sub_product' ? null : (dto.listWidth ?? null),
      subFields: this.normalizeSubFields(dto.subFields),
    }
  }

  private validateFieldInput(dto: Partial<CreateFieldDto>): void {
    if (dto.type === 'formula' || dto.config?.formula) this.validateFormula(dto.config?.formula)
    if (dto.type) this.validateFieldSpecificConfig(dto.type, dto.config)
    if (dto.subFields !== undefined && dto.type !== undefined && dto.type !== 'sub_product') {
      throw new BadRequestException('只有子表格字段可以配置子字段')
    }
    if (dto.type === 'sub_product') this.validateSubFields(dto.subFields ?? [])
    if (dto.options) {
      for (const option of dto.options as unknown[]) {
        if (!this.isRecord(option)) throw new BadRequestException('选项格式不正确')
        if (typeof option['label'] !== 'string' || typeof option['value'] !== 'string') {
          throw new BadRequestException('选项格式不正确')
        }
        if (!option['label'].trim() || !option['value'].trim()) {
          throw new BadRequestException('选项名称和值不能为空')
        }
      }
      const labels = dto.options.map((option) => option.label.trim())
      const values = dto.options.map((option) => option.value.trim())
      if (new Set(labels).size !== labels.length || new Set(values).size !== values.length) {
        throw new BadRequestException('同一字段的选项名称和值不能重复')
      }
    }
  }

  private validateFieldSpecificConfig(type: FieldType, config?: FieldConfig | null): void {
    if (type === 'data_source' || type === 'data_source_multiple') {
      if (typeof config?.dataSourceType !== 'string' || !config.dataSourceType.trim()) {
        throw new BadRequestException('数据源字段必须配置数据源类型')
      }
      this.validateDataSourceFilterConfig(config)
      if (config?.showFields !== undefined) {
        if (type !== 'data_source') {
          throw new BadRequestException('只有单选数据源字段支持派生显示字段')
        }
        this.validateStringIds(config.showFields, '数据源显示字段')
      }
      if (config?.linkFields !== undefined) {
        if (type !== 'data_source') {
          throw new BadRequestException('只有单选数据源字段支持字段填充')
        }
        this.validateDataSourceLinkFields(config.linkFields, false)
      }
      if (config?.childLinkFields !== undefined) {
        if (type !== 'data_source') {
          throw new BadRequestException('只有单选数据源字段支持子表填充')
        }
        this.validateDataSourceLinkFields(config.childLinkFields, true)
      }
    } else if (
      config?.combineSearch !== undefined ||
      config?.showFields !== undefined ||
      config?.linkFields !== undefined ||
      config?.childLinkFields !== undefined
    ) {
      throw new BadRequestException('只有数据源字段可以配置数据源过滤、显示和填充规则')
    }

    if (config?.showControlRules !== undefined) {
      if (!['select', 'multiselect', 'radio', 'checkbox'].includes(type)) {
        throw new BadRequestException('只有选择类字段可以配置显隐规则')
      }
      if (!Array.isArray(config.showControlRules)) {
        throw new BadRequestException('字段显隐规则格式不正确')
      }
      for (const rule of config.showControlRules) {
        if (!rule || typeof rule !== 'object' || !Array.isArray(rule.fieldIds)) {
          throw new BadRequestException('字段显隐规则格式不正确')
        }
        this.validateStringIds(rule.fieldIds, '显隐目标字段')
        if (
          rule.value !== undefined &&
          !['string', 'number', 'boolean'].includes(typeof rule.value)
        ) {
          throw new BadRequestException('字段显隐规则值格式不正确')
        }
      }
    }

    if (config?.linkProp !== undefined) {
      if (!['select', 'multiselect'].includes(type)) {
        throw new BadRequestException('只有单选/多选下拉字段可以配置字段联动')
      }
      const link = config.linkProp
      if (
        !link ||
        typeof link !== 'object' ||
        typeof link.targetField !== 'string' ||
        !link.targetField.trim() ||
        !Array.isArray(link.linkOptions) ||
        !link.linkOptions.length
      ) {
        throw new BadRequestException('字段联动配置不正确')
      }
      for (const option of link.linkOptions) this.validateFieldLinkOption(option)
    }

    if (type === 'sub_product') {
      const fixedColumn = config?.fixedColumn ?? 1
      if (![1, 2, 3].includes(fixedColumn)) {
        throw new BadRequestException('子表固定列数量只能为 1、2 或 3')
      }
      if (config?.sumColumns !== undefined && !Array.isArray(config.sumColumns)) {
        throw new BadRequestException('子表汇总列配置不正确')
      }
    }

    if (type === 'location') {
      const scope = config?.scope ?? 'ALL'
      const locationType = config?.locationType ?? 'PCD'
      if (!['ALL', 'CN'].includes(scope)) throw new BadRequestException('地址范围配置不正确')
      if (!['C', 'P', 'PC', 'PCD', 'detail'].includes(locationType)) {
        throw new BadRequestException('地址层级配置不正确')
      }
      if (scope === 'CN' && locationType === 'C') {
        throw new BadRequestException('中国范围的地址字段不支持仅国家层级')
      }
    }

    if (type === 'attachment') {
      if (config?.onlyOne !== undefined && typeof config.onlyOne !== 'boolean') {
        throw new BadRequestException('附件单文件配置不正确')
      }
      if (config?.accept !== undefined && typeof config.accept !== 'string') {
        throw new BadRequestException('附件类型配置不正确')
      }
      if (config?.accept) {
        const extensions = config.accept
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
        if (extensions.length === 0 || extensions.some((item) => !/^\.[a-z0-9]+$/.test(item))) {
          throw new BadRequestException('附件类型应使用逗号分隔的扩展名，例如 .pdf,.docx')
        }
      }
      if (config?.limitSize) {
        const match = config.limitSize.trim().match(/^(\d+(?:\.\d+)?)(KB|MB)$/i)
        if (!match || Number(match[1]) <= 0) {
          throw new BadRequestException('附件大小限制格式应为 500KB 或 20MB')
        }
        const bytes = Number(match[1]) * (match[2]?.toUpperCase() === 'KB' ? 1024 : 1024 * 1024)
        if (bytes > 20 * 1024 * 1024) {
          throw new BadRequestException('附件大小限制不能超过当前平台 20MB 上限')
        }
      }
    }
  }

  private validateFieldLinkOption(option: FieldLinkOption): void {
    if (!option || typeof option !== 'object') {
      throw new BadRequestException('字段联动选项格式不正确')
    }
    const current = Array.isArray(option.current) ? option.current : [option.current]
    if (!current.length) {
      throw new BadRequestException('字段联动触发值不能为空')
    }
    this.validateStringIds(current, '字段联动触发值')
    if (!['AUTO', 'HIDDEN'].includes(option.method)) {
      throw new BadRequestException('字段联动方式不正确')
    }
    const target = Array.isArray(option.target) ? option.target : [option.target]
    this.validateStringIds(target, '字段联动目标值')
  }

  private validateDataSourceFilterConfig(config?: FieldConfig | null): void {
    const combine = config?.combineSearch
    if (combine === undefined) return
    if (
      !combine ||
      typeof combine !== 'object' ||
      !['AND', 'OR'].includes(combine.searchMode) ||
      !Array.isArray(combine.conditions)
    ) {
      throw new BadRequestException('数据源过滤配置不正确')
    }
    for (const condition of combine.conditions) {
      if (
        !condition ||
        typeof condition !== 'object' ||
        typeof condition.leftFieldId !== 'string' ||
        !condition.leftFieldId.trim() ||
        ![
          'EQUALS',
          'NOT_EQUALS',
          'IN',
          'NOT_IN',
          'CONTAINS',
          'NOT_CONTAINS',
          'GT',
          'GE',
          'LT',
          'LE',
          'EMPTY',
          'NOT_EMPTY',
        ].includes(condition.operator)
      ) {
        throw new BadRequestException('数据源过滤条件格式不正确')
      }
      if (!['MATCH_FIELD', 'MATCH_VALUE'].includes(condition.matchType)) {
        throw new BadRequestException('数据源过滤匹配方式不正确')
      }
      if (
        condition.matchType === 'MATCH_FIELD' &&
        (typeof condition.rightFieldId !== 'string' || !condition.rightFieldId.trim())
      ) {
        throw new BadRequestException('数据源动态过滤必须选择当前表单字段')
      }
    }
  }

  private validateDataSourceLinkFields(
    links: DataSourceSubFieldLinkField[] | NonNullable<FieldConfig['linkFields']>,
    childMode: boolean,
  ): void {
    if (!Array.isArray(links)) throw new BadRequestException('数据源字段填充配置不正确')
    const currents = new Set<string>()
    for (const link of links) {
      if (
        !link ||
        typeof link !== 'object' ||
        typeof link.current !== 'string' ||
        !link.current.trim() ||
        typeof link.link !== 'string' ||
        !link.link.trim() ||
        link.method !== 'fill' ||
        typeof link.enable !== 'boolean'
      ) {
        throw new BadRequestException('数据源字段填充配置不正确')
      }
      if (currents.has(link.current))
        throw new BadRequestException('同一字段不能重复配置数据源填充')
      currents.add(link.current)
      if (childMode) {
        const childLinks = (link as DataSourceSubFieldLinkField).childLinks
        if (!Array.isArray(childLinks)) throw new BadRequestException('数据源子表填充配置不正确')
        this.validateDataSourceLinkFields(childLinks, false)
      } else if ('childLinks' in link && (link as DataSourceSubFieldLinkField).childLinks?.length) {
        throw new BadRequestException('数据源子字段填充不能继续嵌套')
      }
    }
  }

  private validateStringIds(values: string[], label: string): void {
    if (values.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new BadRequestException(`${label}不能为空`)
    }
    if (new Set(values).size !== values.length) {
      throw new BadRequestException(`${label}不能重复`)
    }
  }

  private validateFormLinkage(fields: FieldVO[]): void {
    const byId = new Map(fields.map((field) => [field.id, field]))

    for (const field of fields) {
      const sourceOptions = new Set((field.options ?? []).map((option) => option.value))
      for (const rule of field.config?.showControlRules ?? []) {
        if (rule.value !== undefined && !sourceOptions.has(String(rule.value))) {
          throw new BadRequestException(`「${field.label}」显隐规则包含不存在的选项值`)
        }
        for (const targetId of rule.fieldIds) {
          if (targetId === field.id) throw new BadRequestException('字段不能控制自身显隐')
          if (!byId.has(targetId)) throw new BadRequestException('显隐规则引用的目标字段不存在')
        }
      }

      const link = field.config?.linkProp
      if (link) {
        const target = byId.get(link.targetField)
        if (!target) throw new BadRequestException('字段联动引用的目标字段不存在')
        if (target.id === field.id) throw new BadRequestException('字段不能联动自身')
        if (!['select', 'multiselect'].includes(target.type)) {
          throw new BadRequestException('字段联动目标必须是单选或多选下拉字段')
        }
        const targetOptions = new Set((target.options ?? []).map((option) => option.value))
        for (const option of link.linkOptions) {
          const current = Array.isArray(option.current) ? option.current : [option.current]
          if (current.some((value) => !sourceOptions.has(value))) {
            throw new BadRequestException(`「${field.label}」字段联动包含不存在的触发选项`)
          }
          const targetValues = Array.isArray(option.target) ? option.target : [option.target]
          if (targetValues.some((value) => !targetOptions.has(value))) {
            throw new BadRequestException(`「${target.label}」字段联动包含不存在的目标选项`)
          }
        }
      }

      for (const condition of field.config?.combineSearch?.conditions ?? []) {
        if (condition.matchType !== 'MATCH_FIELD') continue
        if (!condition.rightFieldId || !byId.has(condition.rightFieldId)) {
          throw new BadRequestException('数据源过滤引用的当前表单字段不存在')
        }
      }

      for (const item of field.config?.linkFields ?? []) {
        const target = byId.get(item.current)
        if (!target) throw new BadRequestException('数据源填充引用的当前表单字段不存在')
        if (target.type === 'formula' || target.type === 'sub_product') {
          throw new BadRequestException('数据源顶层填充不能直接写入公式或子表字段')
        }
      }

      for (const parentLink of field.config?.childLinkFields ?? []) {
        const parent = byId.get(parentLink.current)
        if (!parent || parent.type !== 'sub_product') {
          throw new BadRequestException('数据源子表填充必须指向当前表单的子表字段')
        }
        const childIds = new Set((parent.subFields ?? []).map((subField) => subField.id))
        for (const childLink of parentLink.childLinks) {
          if (!childIds.has(childLink.current)) {
            throw new BadRequestException('数据源子表填充引用的当前子字段不存在')
          }
          const target = parent.subFields?.find((subField) => subField.id === childLink.current)
          if (target?.type === 'formula') {
            throw new BadRequestException('数据源子表填充不能直接写入公式字段')
          }
        }
      }
    }

    this.validateFieldLinkCycles(fields)
  }

  private validateFieldLinkCycles(fields: FieldVO[]): void {
    const edges = new Map<string, string>()
    for (const field of fields) {
      if (field.config?.linkProp) edges.set(field.id, field.config.linkProp.targetField)
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new BadRequestException('字段联动不能形成循环')
      visiting.add(id)
      const target = edges.get(id)
      if (target) visit(target)
      visiting.delete(id)
      visited.add(id)
    }
    for (const id of edges.keys()) visit(id)
  }

  private validateSubFields(subFields: NonNullable<CreateFieldDto['subFields']>): void {
    const labels = new Set<string>()
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const subField of subFields) {
      const label = subField.label.trim()
      if (!label) throw new BadRequestException('子字段名称不能为空')
      if (labels.has(label)) throw new BadRequestException(`子字段名称「${label}」不能重复`)
      labels.add(label)
      if (!isSubTableFieldType(subField.type)) {
        throw new BadRequestException(`「${label}」不是子表支持的字段类型`)
      }
      if (subField.id) {
        if (ids.has(subField.id)) throw new BadRequestException('子字段 ID 不能重复')
        ids.add(subField.id)
      }
      if (subField.key) {
        if (keys.has(subField.key)) throw new BadRequestException('子字段 key 不能重复')
        keys.add(subField.key)
      }
      this.validateSubFieldLinkageConfig(subField.config)
      this.validateFieldSpecificConfig(subField.type, subField.config)
      if (subField.type === 'formula') this.validateFormula(subField.config?.formula)
      if (subField.options) this.validateOptions(subField.options)
    }
  }

  private validateStoredSubFields(subFields: StoredSubFieldProp[]): void {
    const labels = new Set<string>()
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const subField of subFields) {
      if (labels.has(subField.label)) throw new BadRequestException('子字段名称不能重复')
      if (ids.has(subField.id)) throw new BadRequestException('子字段 ID 不能重复')
      if (keys.has(subField.key)) throw new BadRequestException('子字段 key 不能重复')
      labels.add(subField.label)
      ids.add(subField.id)
      keys.add(subField.key)
      if (!isSubTableFieldType(subField.type)) {
        throw new BadRequestException(`「${subField.label}」不是子表支持的字段类型`)
      }
      this.validateSubFieldLinkageConfig(subField.config)
      this.validateFieldSpecificConfig(subField.type, subField.config)
      if (subField.type === 'formula') this.validateFormula(subField.config?.formula)
    }
  }

  private validateSubFieldLinkageConfig(config?: FieldConfig | null): void {
    if (
      config?.showControlRules !== undefined ||
      config?.linkProp !== undefined ||
      config?.combineSearch !== undefined ||
      config?.showFields !== undefined ||
      config?.linkFields !== undefined ||
      config?.childLinkFields !== undefined
    ) {
      throw new BadRequestException('子表子字段暂不支持显隐、字段联动或数据源联动配置')
    }
  }

  private validateSubTableColumns(
    config: FieldConfig | null,
    subFields: StoredSubFieldProp[],
  ): void {
    const sumColumns = config?.sumColumns ?? []
    if (!sumColumns.length) return
    const sumCandidates = new Set(
      subFields
        .filter((field) => ['number', 'currency', 'percent', 'formula'].includes(field.type))
        .map((field) => field.id),
    )
    if (new Set(sumColumns).size !== sumColumns.length) {
      throw new BadRequestException('子表汇总列不能重复')
    }
    const invalid = sumColumns.find((id) => !sumCandidates.has(id))
    if (invalid) throw new BadRequestException('子表汇总列必须选择数值或计算字段')
  }

  private async reconcileSubFieldValues(
    tx: DatabaseClient,
    current: StoredSubFieldProp[],
    next: StoredSubFieldProp[],
  ): Promise<void> {
    const currentById = new Map(current.map((field) => [field.id, field]))
    const nextById = new Map(next.map((field) => [field.id, field]))
    for (const [id, oldField] of currentById) {
      const nextField = nextById.get(id)
      if (!nextField) {
        await this.deleteFieldValues(tx, id)
        continue
      }
      if (nextField.type !== oldField.type) {
        const count = await this.countFieldValues(tx, id)
        if (count > 0) {
          throw new BadRequestException(`子字段「${oldField.label}」已有数据，不能修改字段类型`)
        }
      }
    }
  }

  private normalizeSubFields(
    input: CreateFieldDto['subFields'],
    current: StoredSubFieldProp[] | null = null,
  ): StoredSubFieldProp[] | null {
    if (!input) return null
    const currentById = new Map((current ?? []).map((field) => [field.id, field]))
    const result = input.map((field, index) => {
      const existing = field.id ? currentById.get(field.id) : undefined
      return {
        id: existing?.id ?? field.id ?? `sf_${randomBytes(8).toString('hex')}`,
        key: existing?.key ?? field.key ?? `cf_${randomBytes(6).toString('hex')}`,
        label: field.label.trim(),
        type: field.type,
        required: field.type === 'formula' ? false : (field.required ?? false),
        options: field.options ?? null,
        config: field.config ?? null,
        sort: index,
      }
    })
    this.validateStoredSubFields(result)
    return result
  }

  private parseStoredSubFields(value: unknown): StoredSubFieldProp[] | null {
    if (!Array.isArray(value)) return null
    const result = value.flatMap((item, index) => {
      if (!this.isRecord(item)) return []
      const id = item['id']
      const key = item['key']
      const label = item['label']
      const type = item['type']
      if (
        typeof id !== 'string' ||
        typeof key !== 'string' ||
        typeof label !== 'string' ||
        typeof type !== 'string'
      ) {
        return []
      }
      const fieldType = type as FieldType
      if (!isSubTableFieldType(fieldType)) return []
      return [
        {
          id,
          key,
          label,
          type: fieldType,
          required: item['required'] === true,
          options: this.parseFieldOptions(item['options']),
          config: this.isRecord(item['config']) ? (item['config'] as FieldConfig) : null,
          sort: typeof item['sort'] === 'number' ? item['sort'] : index,
        },
      ]
    })
    return result.length ? result.sort((a, b) => a.sort - b.sort) : []
  }

  private subFieldToVO(subField: StoredSubFieldProp, formKey: string): FieldVO {
    return {
      id: subField.id,
      module: formKey,
      key: subField.key,
      label: subField.label,
      type: subField.type,
      required: subField.required,
      system: false,
      hidden: false,
      options: subField.options,
      config: subField.config,
      sort: subField.sort,
      span: 24,
      showInList: true,
      listWidth: null,
      subFields: null,
    }
  }

  private validateOptions(options: FieldOption[]): void {
    const labels = options.map((option) => option.label.trim())
    const values = options.map((option) => option.value.trim())
    if (labels.some((label) => !label) || values.some((value) => !value)) {
      throw new BadRequestException('选项名称和值不能为空')
    }
    if (new Set(labels).size !== labels.length || new Set(values).size !== values.length) {
      throw new BadRequestException('同一字段的选项名称和值不能重复')
    }
  }

  private parseFieldOptions(value: unknown): FieldOption[] | null {
    if (!Array.isArray(value)) return null
    return value.flatMap((option) => {
      if (!this.isRecord(option)) return []
      const label = option['label']
      const optionValue = option['value']
      if (typeof label !== 'string' || typeof optionValue !== 'string') return []
      const color = option['color']
      return [
        {
          label,
          value: optionValue,
          ...(typeof color === 'string' ? { color } : {}),
        },
      ]
    })
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
      tx.followUpPlanField.count({ where: { fieldId } }),
      tx.followUpPlanFieldBlob.count({ where: { fieldId } }),
      tx.followUpRecordField.count({ where: { fieldId } }),
      tx.followUpRecordFieldBlob.count({ where: { fieldId } }),
      tx.customFormDataField.count({ where: { fieldId } }),
      tx.customFormDataFieldBlob.count({ where: { fieldId } }),
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
      tx.followUpPlanField.deleteMany({ where: { fieldId } }),
      tx.followUpPlanFieldBlob.deleteMany({ where: { fieldId } }),
      tx.followUpRecordField.deleteMany({ where: { fieldId } }),
      tx.followUpRecordFieldBlob.deleteMany({ where: { fieldId } }),
      tx.customFormDataField.deleteMany({ where: { fieldId } }),
      tx.customFormDataFieldBlob.deleteMany({ where: { fieldId } }),
    ])
  }

  private isBlobType(type: FieldType): boolean {
    return [
      'textarea',
      'multiselect',
      'checkbox',
      'picture',
      'attachment',
      'data_source_multiple',
    ].includes(type)
  }

  private async validateFormPropLinkage(
    organizationId: string,
    targetFormKey: string,
    formProp: Record<string, unknown>,
  ): Promise<void> {
    const linkProp = this.parseFormLinkProp(formProp['linkProp'])
    const sourceKeys = Object.keys(linkProp)
    if (!sourceKeys.length) return
    const targetFields = await this.listFields(organizationId, targetFormKey)
    for (const sourceFormKey of sourceKeys) {
      const sourceFields = await this.listFields(organizationId, sourceFormKey)
      const scenarios = linkProp[sourceFormKey] ?? []
      if (new Set(scenarios.map((scenario) => scenario.key)).size !== scenarios.length) {
        throw new BadRequestException(`表单联动场景重复：${sourceFormKey}`)
      }
      scenarios.forEach((scenario) =>
        this.validateFormLinkScenario(targetFields, sourceFields, scenario),
      )
    }
  }

  private validateFormLinkScenario(
    targetFields: FieldVO[],
    sourceFields: FieldVO[],
    scenario: FormLinkScenario,
  ): void {
    const targetById = new Map(targetFields.map((field) => [field.id, field]))
    const sourceById = new Map(sourceFields.map((field) => [field.id, field]))
    const targetIds = scenario.linkFields.map((link) => link.current)
    if (new Set(targetIds).size !== targetIds.length) {
      throw new BadRequestException(`表单联动「${scenario.key}」不能重复填充同一目标字段`)
    }
    for (const link of scenario.linkFields) {
      const target = targetById.get(link.current)
      const source = sourceById.get(link.link)
      if (!target) throw new BadRequestException(`表单联动目标字段不存在：${link.current}`)
      if (!source) throw new BadRequestException(`表单联动来源字段不存在：${link.link}`)
      if (!isFormLinkFieldCompatible(target, source)) {
        throw new BadRequestException(`「${source.label}」不能填充到「${target.label}」`)
      }
    }
  }

  private parseFormLinkProp(value: unknown): FormLinkProp {
    if (value === undefined || value === null) return {}
    if (!this.isRecord(value)) throw new BadRequestException('表单联动配置格式错误')
    const result: FormLinkProp = {}
    for (const [sourceFormKey, rawScenarios] of Object.entries(value)) {
      if (!sourceFormKey.trim() || !Array.isArray(rawScenarios)) {
        throw new BadRequestException('表单联动来源表单配置格式错误')
      }
      result[sourceFormKey] = rawScenarios.map((rawScenario) => {
        if (!this.isRecord(rawScenario)) throw new BadRequestException('表单联动场景格式错误')
        const key = rawScenario['key']
        const rawLinks = rawScenario['linkFields']
        if (
          typeof key !== 'string' ||
          !(FORM_LINK_SCENARIO_KEYS as readonly string[]).includes(key) ||
          !Array.isArray(rawLinks)
        ) {
          throw new BadRequestException('表单联动场景格式错误')
        }
        const linkFields = rawLinks.map((rawLink) => {
          if (!this.isRecord(rawLink)) throw new BadRequestException('表单联动字段格式错误')
          const current = rawLink['current']
          const link = rawLink['link']
          const enable = rawLink['enable']
          if (
            typeof current !== 'string' ||
            typeof link !== 'string' ||
            typeof enable !== 'boolean'
          ) {
            throw new BadRequestException('表单联动字段格式错误')
          }
          return { current, link, enable }
        })
        return { key: key as FormLinkScenarioKey, linkFields }
      })
    }
    return result
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
