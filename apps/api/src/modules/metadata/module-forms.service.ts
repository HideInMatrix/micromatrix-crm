import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {
  applyFormLinkScenario,
  dynamicFieldCapabilities,
  evaluateFormula,
  FORM_LINK_SCENARIO_KEYS,
  formulaVariables,
  isFormLinkFieldCompatible,
  isSubTableFieldType,
  MOBILE_SELECT_MODES,
  supportsMobileSearchSelect,
  type DataSourceSubFieldLinkField,
  type FieldConfig,
  type FieldCapabilities,
  type FieldLinkOption,
  type FieldOption,
  type FieldOrigin,
  type FieldType,
  type FieldVO,
  type FormLinkProp,
  type FormLinkScenario,
  type FormLinkScenarioKey,
  type HomeAnalyticsConfig,
  type ModuleFormProp,
} from '@micromatrix/shared'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import type { PrismaClient } from '../../prisma/db.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { PrismaService } from '../../prisma.service.js'
import { CreateFieldDto, type SaveFormFieldDto, UpdateFieldDto } from './dto/field.dto'
import { MODULE_SYSTEM_FIELDS, type SystemFieldTemplate } from './system-fields'

const SYSTEM_ACTOR = 'SYSTEM'
const CACHE_TTL_SECONDS = 10 * 60
const HOME_ANALYTICS_DIMENSION_TYPES = new Set<FieldType>(['text', 'select', 'radio'])
const HOME_ANALYTICS_RESULT_TYPES = new Set<FieldType>([
  'text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'select',
  'radio',
  'switch',
  'phone',
  'email',
  'data_source',
])
const HOME_ANALYTICS_TIME_TYPES = new Set<FieldType>(['date', 'datetime'])
const HOME_ANALYTICS_AMOUNT_TYPES = new Set<FieldType>(['number', 'currency'])

export type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

interface FieldWithBlob {
  id: string
  formId: string
  internalKey: string | null
  name: string
  type: string
  mobile: boolean
  pos: bigint
  createUser: string
  createTime: bigint
  updateUser: string
  updateTime: bigint
  blob: { id: string; prop: string | null } | null
}

interface FieldWithForm extends FieldWithBlob {
  form: { id: string; formKey: string; organizationId: string }
}

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
  formProp: ModuleFormProp
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
    return this.prisma.client.transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey)
      const [blob, fields] = await Promise.all([
        tx.orm.public.SysModuleFormBlob.where({ id: form.id }).first(),
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
    tx: PrismaTransaction,
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
    formProp: ModuleFormProp,
    actorId: string,
  ): Promise<ModuleFormConfigVO> {
    this.validateFormPropInput(formProp)
    await this.validateLeadStageUsage(organizationId, formKey, formProp)
    await this.validateHomeAnalyticsUsage(organizationId, formKey, formProp)
    await this.validateFormPropLinkage(organizationId, formKey, formProp)
    await this.prisma.client.transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const now = BigInt(Date.now())
      await tx.orm.public.SysModuleForm.where({ id: form.id }).update({
        updateUser: actorId,
        updateTime: now,
      })
      await tx.orm.public.SysModuleFormBlob.upsert({
        create: { id: form.id, prop: JSON.stringify(formProp) },
        update: { prop: JSON.stringify(formProp) },
        conflictOn: { id: form.id },
      })
    })
    await this.invalidateForm(organizationId, formKey)
    return this.getConfig(organizationId, formKey)
  }

  async saveDesign(
    organizationId: string,
    formKey: string,
    fields: SaveFormFieldDto[],
    formProp: ModuleFormProp,
    actorId: string,
  ): Promise<ModuleFormConfigVO> {
    this.validateFormPropInput(formProp)
    await this.validateLeadStageUsage(organizationId, formKey, formProp)
    await this.validateHomeAnalyticsDesignChange(organizationId, formKey, fields, formProp)
    const labels = fields.map((field) => field.label.trim())
    if (labels.some((label) => !label)) throw new BadRequestException('字段名称不能为空')
    if (new Set(labels).size !== labels.length) throw new BadRequestException('字段名称不能重复')
    const requestedIds = fields.flatMap((field) => (field.id ? [field.id] : []))
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('字段 ID 不能重复')
    }
    fields.forEach((field) => this.validateFieldInput(field, formKey))

    const result = await this.prisma.client.transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const currentFields = await this.findFields(tx, form.id)
      const currentById = new Map(currentFields.map((field) => [field.id, field]))
      const requestedIdSet = new Set(requestedIds)

      for (const fieldId of requestedIds) {
        if (!currentById.has(fieldId)) throw new BadRequestException('表单包含不存在的字段')
      }
      for (const current of currentFields) {
        const prop = this.parseProp(current)
        const key = prop.key || current.internalKey || current.id
        if (this.fieldOrigin(formKey, key) === 'SYSTEM' && !requestedIdSet.has(current.id)) {
          throw new BadRequestException('系统字段不可删除')
        }
      }

      const now = BigInt(Date.now())
      for (const [index, dto] of fields.entries()) {
        if (!dto.id) {
          const key = `cf_${randomBytes(6).toString('hex')}`
          const storedProp = this.dtoToProp(key, dto, false)
          if (dto.type === 'sub_product') {
            this.validateStoredSubFields(storedProp.subFields ?? [])
            this.validateSubTableColumns(storedProp.config, storedProp.subFields ?? [])
          }
          const id = createLegacyId32()
          await tx.orm.public.SysModuleField.create({
            id,
            formId: form.id,
            internalKey: key,
            name: dto.label.trim(),
            _type: dto.type,
            mobile: dto.mobile ?? true,
            pos: BigInt(index),
            createUser: actorId,
            updateUser: actorId,
            createTime: now,
            updateTime: now,
          })
          await tx.orm.public.SysModuleFieldBlob.create({
            id,
            prop: JSON.stringify(storedProp),
          })
          continue
        }

        const currentField = currentById.get(dto.id)
        if (!currentField) throw new BadRequestException('表单包含不存在的字段')
        const current = this.parseProp(currentField)
        this.validateFieldCapabilityChange(formKey, currentField, current, dto)
        if (
          dto.type !== currentField.type &&
          this.isBlobType(dto.type) !== this.isBlobType(currentField.type as FieldType)
        ) {
          const count = await this.countFieldValues(tx, dto.id)
          if (count > 0)
            throw new BadRequestException('字段已有数据，不能切换普通值与大字段存储类型')
        }
        if (dto.type !== currentField.type && dto.type === 'sub_product') {
          const count = await this.countFieldValues(tx, dto.id)
          if (count > 0) throw new BadRequestException('字段已有数据，不能切换为子表格类型')
        }
        if (dto.type !== currentField.type && currentField.type === 'sub_product') {
          const subIds = current.subFields?.map((subField) => subField.id) ?? []
          const counts = await Promise.all(subIds.map((subId) => this.countFieldValues(tx, subId)))
          if (counts.some((count) => count > 0)) {
            throw new BadRequestException('子表格已有数据，不能修改父字段类型')
          }
        }

        const next: StoredFieldProp = {
          ...current,
          required: dto.type === 'sub_product' ? false : (dto.required ?? current.required),
          hidden: dto.hidden ?? current.hidden,
          options: dto.options === undefined ? current.options : dto.options,
          config: dto.config === undefined ? current.config : dto.config,
          span: dto.type === 'sub_product' ? 24 : (dto.span ?? current.span),
          showInList: dto.type === 'sub_product' ? false : (dto.showInList ?? current.showInList),
          listWidth:
            dto.type === 'sub_product'
              ? null
              : dto.listWidth === undefined
                ? current.listWidth
                : dto.listWidth,
          subFields:
            dto.subFields === undefined
              ? current.subFields
              : this.normalizeSubFields(dto.subFields, current.subFields),
        }
        if (
          ['data_source', 'data_source_multiple'].includes(currentField.type) &&
          current.config?.dataSourceType &&
          next.config?.dataSourceType !== current.config.dataSourceType
        ) {
          throw new BadRequestException('已保存的数据源字段不能修改数据源类型，请删除字段后重建')
        }
        this.validateFieldSpecificConfig(dto.type, next.config)
        if (dto.type === 'sub_product') {
          this.validateStoredSubFields(next.subFields ?? [])
          this.validateSubTableColumns(next.config, next.subFields ?? [])
          await this.reconcileSubFieldValues(tx, current.subFields ?? [], next.subFields ?? [])
        } else {
          next.subFields = null
        }

        const updateData: Parameters<
          ReturnType<typeof tx.orm.public.SysModuleField.where>['update']
        >[0] = {
          name: dto.label.trim(),
          mobile: dto.mobile ?? currentField.mobile,
          pos: BigInt(index),
          updateUser: actorId,
          updateTime: now,
        }
        const currentKey = current.key || currentField.internalKey || currentField.id
        if (this.fieldOrigin(formKey, currentKey) !== 'SYSTEM') updateData._type = dto.type
        await tx.orm.public.SysModuleField.where({ id: dto.id }).update(updateData)
        await tx.orm.public.SysModuleFieldBlob.upsert({
          create: { id: dto.id, prop: JSON.stringify(next) },
          update: { prop: JSON.stringify(next) },
          conflictOn: { id: dto.id },
        })
      }

      for (const currentField of currentFields) {
        if (requestedIdSet.has(currentField.id)) continue
        const current = this.parseProp(currentField)
        const currentKey = current.key || currentField.internalKey || currentField.id
        if (this.fieldOrigin(formKey, currentKey) === 'SYSTEM') {
          throw new BadRequestException('系统字段不可删除')
        }
        if (currentField.type === 'sub_product') {
          const childIds = current.subFields?.map((subField) => subField.id) ?? []
          await Promise.all([
            this.deleteCustomSubFieldValues(tx, false, currentField.id, childIds),
            this.deleteCustomSubFieldValues(tx, true, currentField.id, childIds),
          ])
        }
        await this.deleteFieldValues(tx, currentField.id)
        await tx.orm.public.SysModuleField.where({ id: currentField.id }).delete()
      }

      await tx.orm.public.SysModuleForm.where({ id: form.id }).update({
        updateUser: actorId,
        updateTime: now,
      })
      await tx.orm.public.SysModuleFormBlob.upsert({
        create: { id: form.id, prop: JSON.stringify(formProp) },
        update: { prop: JSON.stringify(formProp) },
        conflictOn: { id: form.id },
      })

      const savedFields = (await this.findFields(tx, form.id)).map((field) =>
        this.toVO(field, formKey),
      )
      this.validateFormLinkage(savedFields)
      await this.validateFormPropLinkageInTransaction(
        tx,
        organizationId,
        formKey,
        savedFields,
        formProp,
      )
      return { formKey, formProp, fields: savedFields }
    })
    await this.invalidateForm(organizationId, formKey)
    return result
  }

  async createField(
    organizationId: string,
    formKey: string,
    dto: CreateFieldDto,
    actorId = SYSTEM_ACTOR,
  ): Promise<FieldVO> {
    this.validateFieldInput(dto, formKey)
    const result = await this.prisma.client.transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const duplicated = await tx.orm.public.SysModuleField.where({
        formId: form.id,
        name: dto.label.trim(),
      })
        .select('id')
        .first()
      if (duplicated) throw new BadRequestException('字段名称不能重复')

      const max = await tx.orm.public.SysModuleField.where({ formId: form.id })
        .select('pos')
        .orderBy((field) => field.pos.desc())
        .first()
      const key = `cf_${randomBytes(6).toString('hex')}`
      const now = BigInt(Date.now())
      const storedProp = this.dtoToProp(key, dto, false)
      if (dto.type === 'sub_product') {
        this.validateStoredSubFields(storedProp.subFields ?? [])
        this.validateSubTableColumns(storedProp.config, storedProp.subFields ?? [])
      }
      const fieldId = createLegacyId32()
      const createdRow = await tx.orm.public.SysModuleField.create({
        id: fieldId,
        formId: form.id,
        internalKey: key,
        name: dto.label.trim(),
        _type: dto.type,
        mobile: dto.mobile ?? true,
        pos: (max?.pos ?? -1n) + 1n,
        createUser: actorId,
        updateUser: actorId,
        createTime: now,
        updateTime: now,
      })
      const blob = await tx.orm.public.SysModuleFieldBlob.create({
        id: fieldId,
        prop: JSON.stringify(storedProp),
      })
      const created = this.fieldWithBlob(createdRow, blob)
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
    const result = await this.prisma.client.transaction(async (tx) => {
      const field = await this.ensureField(tx, organizationId, id)
      const current = this.parseProp(field)
      if (dto.label && dto.label.trim() !== field.name) {
        const duplicated = await tx.orm.public.SysModuleField.where({
          formId: field.formId,
          name: dto.label.trim(),
        })
          .where((candidate) => candidate.id.neq(id))
          .select('id')
          .first()
        if (duplicated) throw new BadRequestException('字段名称不能重复')
      }

      this.validateFieldCapabilityChange(field.form.formKey, field, current, dto)
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
      const updateData: Parameters<
        ReturnType<typeof tx.orm.public.SysModuleField.where>['update']
      >[0] = {
        updateUser: actorId,
        updateTime: BigInt(Date.now()),
      }
      if (dto.label !== undefined) updateData.name = dto.label.trim()
      const currentKey = current.key || field.internalKey || field.id
      if (this.fieldOrigin(field.form.formKey, currentKey) !== 'SYSTEM' && dto.type !== undefined) {
        updateData._type = dto.type
      }
      if (dto.mobile !== undefined) updateData.mobile = dto.mobile
      const updatedRow = await tx.orm.public.SysModuleField.where({
        id: id,
      }).update(updateData)
      if (!updatedRow) throw new NotFoundException('字段不存在')
      const updatedBlob = await tx.orm.public.SysModuleFieldBlob.upsert({
        create: { id: id, prop: JSON.stringify(next) },
        update: { prop: JSON.stringify(next) },
        conflictOn: { id: id },
      })
      const updated = this.fieldWithBlob(updatedRow, updatedBlob)
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
    const deleted = await this.prisma.client.transaction(async (tx) => {
      const field = await this.ensureField(tx, organizationId, id)
      const prop = this.parseProp(field)
      const key = prop.key || field.internalKey || field.id
      if (this.fieldOrigin(field.form.formKey, key) === 'SYSTEM') {
        throw new BadRequestException('系统字段不可删除')
      }
      await this.assertHomeAnalyticsFieldNotReferenced(tx, organizationId, field.form.formKey, key)
      if (field.type === 'sub_product') {
        const childIds = prop.subFields?.map((subField) => subField.id) ?? []
        await Promise.all([
          this.deleteCustomSubFieldValues(tx, false, id, childIds),
          this.deleteCustomSubFieldValues(tx, true, id, childIds),
        ])
      }
      await this.deleteFieldValues(tx, id)
      await tx.orm.public.SysModuleField.where({ id: id }).delete()
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
    const result = await this.prisma.client.transaction(async (tx) => {
      const form = await this.ensureForm(tx, organizationId, formKey, actorId)
      const fields = await tx.orm.public.SysModuleField.where({ formId: form.id })
        .select('id')
        .all()
      const existing = new Set<string>(fields.map((field) => String(field.id)))
      const uniqueIds = [...new Set(orderedIds)]
      if (uniqueIds.length !== fields.length || uniqueIds.some((id) => !existing.has(id))) {
        throw new BadRequestException('字段排序必须包含当前表单的全部字段且不能重复')
      }
      const now = BigInt(Date.now())
      await Promise.all(
        uniqueIds.map((id, index) =>
          tx.orm.public.SysModuleField.where({ id: id }).update({
            pos: BigInt(index),
            updateTime: now,
            updateUser: actorId,
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
    const key = prop.key || field.internalKey || field.id
    const origin = this.fieldOrigin(formKey, key)
    const template = this.fieldTemplate(formKey, key)
    return {
      id: field.id,
      module: formKey,
      key,
      label: field.name,
      type: field.type as FieldType,
      origin,
      templateLabel: template?.label ?? null,
      capabilities: this.fieldCapabilities(formKey, key, field.type as FieldType, prop.required),
      mobile: field.mobile,
      required: prop.required,
      system: origin === 'SYSTEM',
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

  private fieldTemplate(formKey: string, key: string): SystemFieldTemplate | undefined {
    return MODULE_SYSTEM_FIELDS[formKey]?.find((template) => template.key === key)
  }

  private fieldOrigin(formKey: string, key: string): FieldOrigin {
    const template = this.fieldTemplate(formKey, key)
    if (!template) return 'CUSTOM'
    return template.system === false ? 'PRESET' : 'SYSTEM'
  }

  private fieldCapabilities(
    formKey: string,
    key: string,
    type: FieldType,
    required = false,
  ): FieldCapabilities {
    const origin = this.fieldOrigin(formKey, key)
    const base = dynamicFieldCapabilities(type, formKey)
    if (origin !== 'SYSTEM') return base

    const template = this.fieldTemplate(formKey, key)
    const fixedRequired = template?.required === true
    const overrides = template?.capabilities ?? {}
    return {
      ...base,
      ...overrides,
      copy: false,
      delete: false,
      changeType: false,
      changeRequired: overrides.changeRequired ?? !fixedRequired,
      hide: overrides.hide ?? (!fixedRequired && !required),
      unique: overrides.unique ?? false,
    }
  }

  private validateFieldCapabilityChange(
    formKey: string,
    field: FieldWithBlob,
    current: StoredFieldProp,
    dto: Partial<CreateFieldDto>,
  ): void {
    const key = current.key || field.internalKey || field.id
    const currentType = field.type as FieldType
    const currentCapabilities = this.fieldCapabilities(formKey, key, currentType, current.required)
    const nextType = (dto.type ?? currentType) as FieldType
    const nextRequired = dto.required ?? current.required
    const nextHidden = dto.hidden ?? current.hidden
    const nextCapabilities = this.fieldCapabilities(formKey, key, nextType, nextRequired)

    if (dto.type !== undefined && dto.type !== currentType && !currentCapabilities.changeType) {
      throw new BadRequestException('系统字段不可修改类型')
    }
    if (
      dto.required !== undefined &&
      dto.required !== current.required &&
      !currentCapabilities.changeRequired
    ) {
      throw new BadRequestException('该系统字段的必填属性不可修改')
    }
    if (nextHidden && !nextCapabilities.hide) {
      throw new BadRequestException('该系统字段不可隐藏')
    }
    const nextUnique = dto.config?.unique ?? current.config?.unique ?? false
    if (nextUnique && !nextCapabilities.unique) {
      throw new BadRequestException('当前字段不支持唯一值约束')
    }
  }

  private async ensureForm(
    tx: PrismaTransaction,
    organizationId: string,
    formKey: string,
    actorId = SYSTEM_ACTOR,
  ) {
    const now = BigInt(Date.now())
    let created = false
    let form = await tx.orm.public.SysModuleForm.where({
      organizationId: organizationId,
      formKey: formKey,
    }).first()
    if (!form) {
      try {
        form = await tx.orm.public.SysModuleForm.create({
          id: createLegacyId32(),
          organizationId: organizationId,
          formKey: formKey,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        })
        created = true
      } catch (error) {
        if ((error as { sqlState?: string }).sqlState !== '23505') throw error
        form = await tx.orm.public.SysModuleForm.where({
          organizationId: organizationId,
          formKey: formKey,
        }).first()
        if (!form) throw error
      }
    }
    await tx.orm.public.SysModuleFormBlob.upsert({
      create: { id: form.id, prop: '{}' },
      update: {},
      conflictOn: { id: form.id },
    })
    await this.ensureSystemFields(tx, form.id, formKey, actorId, created)
    return form
  }

  private cacheNamespace(formKey: string): string {
    return `metadata:v2:${formKey}`
  }

  private async invalidateForm(organizationId: string, formKey: string): Promise<void> {
    await this.cache?.invalidate(organizationId, this.cacheNamespace(formKey))
  }

  private async ensureSystemFields(
    tx: PrismaTransaction,
    formId: string,
    formKey: string,
    actorId: string,
    includePresets: boolean,
  ): Promise<void> {
    const templates = MODULE_SYSTEM_FIELDS[formKey]?.filter(
      (template) => includePresets || template.system !== false,
    )
    if (!templates?.length) return
    const existing = await tx.orm.public.SysModuleField.where({ formId: formId })
      .where((field) => field.internalKey.in(templates.map((template) => template.key)))
      .select('id', 'internalKey', 'mobile', 'createUser', 'updateUser', 'createTime', 'updateTime')
      .all()
    const existingByKey = new Map(existing.map((field) => [String(field.internalKey), field]))
    const now = BigInt(Date.now())
    for (const template of templates) {
      const current = existingByKey.get(template.key)
      if (current) {
        const untouched =
          current.createUser === current.updateUser && current.createTime === current.updateTime
        if (template.mobile !== false && current.mobile === false && untouched) {
          await tx.orm.public.SysModuleField.where({ id: current.id }).update({
            mobile: true,
            updateTime: now,
          })
        }
        continue
      }
      const id = createLegacyId32()
      await tx.orm.public.SysModuleField.create({
        id,
        formId: formId,
        internalKey: template.key,
        name: template.label,
        _type: template.type,
        mobile: template.mobile ?? true,
        pos: BigInt(template.sort),
        createUser: actorId,
        updateUser: actorId,
        createTime: now,
        updateTime: now,
      })
      await tx.orm.public.SysModuleFieldBlob.create({
        id,
        prop: JSON.stringify(this.templateToProp(template)),
      })
    }
  }

  private async findFields(tx: PrismaTransaction, formId: string): Promise<FieldWithBlob[]> {
    const rows = await tx.orm.public.SysModuleField.where({ formId: formId })
      .orderBy([(field) => field.pos.asc(), (field) => field.createTime.asc()])
      .all()
    if (!rows.length) return []
    const blobs = await tx.orm.public.SysModuleFieldBlob.where((blob) =>
      blob.id.in(rows.map((row) => row.id)),
    ).all()
    const blobMap = new Map(blobs.map((blob) => [blob.id, blob]))
    return rows.map((row) => this.fieldWithBlob(row, blobMap.get(row.id) ?? null))
  }

  private async ensureField(
    tx: PrismaTransaction,
    organizationId: string,
    id: string,
  ): Promise<FieldWithForm> {
    const row = await tx.orm.public.SysModuleField.where({ id: id }).first()
    if (!row) throw new NotFoundException('字段不存在')
    const [form, blob] = await Promise.all([
      tx.orm.public.SysModuleForm.where({
        id: row.formId,
        organizationId: organizationId,
      }).first(),
      tx.orm.public.SysModuleFieldBlob.where({ id: row.id }).first(),
    ])
    if (!form) throw new NotFoundException('字段不存在')
    return {
      ...this.fieldWithBlob(row, blob),
      form: { id: form.id, formKey: form.formKey, organizationId: form.organizationId },
    }
  }

  private fieldWithBlob(
    row: NonNullable<
      Awaited<ReturnType<PrismaService['client']['orm']['public']['SysModuleField']['first']>>
    >,
    blob: { id: string; prop: string | null } | null,
  ): FieldWithBlob {
    return {
      id: row.id,
      formId: row.formId,
      internalKey: row.internalKey,
      name: row.name,
      type: row._type,
      mobile: row.mobile,
      pos: row.pos,
      createUser: row.createUser,
      createTime: row.createTime,
      updateUser: row.updateUser,
      updateTime: row.updateTime,
      blob,
    }
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

  private validateFieldInput(dto: Partial<CreateFieldDto>, formKey?: string): void {
    if (dto.type && dto.config?.unique && !dynamicFieldCapabilities(dto.type, formKey).unique) {
      throw new BadRequestException('当前字段类型不支持唯一值约束')
    }
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

  private async validateLeadStageUsage(
    organizationId: string,
    formKey: string,
    formProp: ModuleFormProp,
  ): Promise<void> {
    if (formKey !== 'lead' || !formProp.leadStages) return
    const configuredKeys = new Set(formProp.leadStages.map((stage) => stage.key))
    const used = await this.prisma.client.orm.public.Clue.where({
      organizationId,
    })
      .select('stage')
      .all()
    const removedInUse = [
      ...new Set(used.map((item) => item.stage).filter((key) => !configuredKeys.has(key))),
    ]
    if (removedInUse.length) {
      throw new BadRequestException(
        `仍有线索使用状态 ${removedInUse.join('、')}，请先迁移这些线索或停用状态，不能直接删除状态 key`,
      )
    }
  }

  private async validateHomeAnalyticsUsage(
    organizationId: string,
    formKey: string,
    formProp: ModuleFormProp,
  ): Promise<void> {
    const config = formProp.homeAnalytics
    if (config === undefined) return
    if (formKey !== 'lead' && formKey !== 'customer') {
      throw new BadRequestException('首页分析配置只能保存在 Lead 或 Customer 表单属性中')
    }
    const fields = await this.listFields(organizationId, formKey)
    this.validateHomeAnalyticsModuleFields(formKey, config, fields)
  }

  private async validateHomeAnalyticsDesignChange(
    organizationId: string,
    formKey: string,
    fields: SaveFormFieldDto[],
    formProp: ModuleFormProp,
  ): Promise<void> {
    if (formKey !== 'lead' && formKey !== 'customer') return
    let config = formProp.homeAnalytics
    if (config === undefined && formKey === 'customer') {
      const legacyLeadConfig = await this.getConfig(organizationId, 'lead')
      config = legacyLeadConfig.formProp.homeAnalytics
    }
    if (!config) return

    const currentFields = await this.listFields(organizationId, formKey)
    const requestedById = new Map(
      fields.flatMap((field) => (field.id ? [[field.id, field] as const] : [])),
    )
    const referenced: Array<{
      key: string | undefined
      label: string
      allowed: Set<FieldType>
    }> =
      formKey === 'lead'
        ? [
            {
              key: config.leadSourceFieldKey,
              label: '渠道字段',
              allowed: HOME_ANALYTICS_DIMENSION_TYPES,
            },
          ]
        : [
            {
              key: config.customerResultFieldKey,
              label: '结果字段',
              allowed: HOME_ANALYTICS_RESULT_TYPES,
            },
            {
              key: config.customerResultTimeFieldKey,
              label: '结果时间字段',
              allowed: HOME_ANALYTICS_TIME_TYPES,
            },
            {
              key: config.customerResultAmountFieldKey,
              label: '结果金额字段',
              allowed: HOME_ANALYTICS_AMOUNT_TYPES,
            },
          ]

    for (const item of referenced) {
      if (!item.key) continue
      const current = currentFields.find((field) => field.key === item.key)
      if (!current) {
        throw new BadRequestException(`首页分析${item.label}不存在：${item.key}`)
      }
      const requested = requestedById.get(current.id)
      if (!requested) {
        throw new BadRequestException(`「${current.label}」正在被首页分析使用，不能删除`)
      }
      if (!item.allowed.has(requested.type)) {
        throw new BadRequestException(
          `「${current.label}」正在被首页分析使用，不能修改为当前字段类型`,
        )
      }
    }
  }

  private validateHomeAnalyticsModuleFields(
    formKey: 'lead' | 'customer',
    config: HomeAnalyticsConfig,
    fields: FieldVO[],
  ): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new BadRequestException('首页分析配置格式不正确')
    }

    if (formKey === 'lead') {
      const source = this.resolveHomeAnalyticsField(
        fields,
        config.leadSourceFieldKey,
        '渠道字段',
        HOME_ANALYTICS_DIMENSION_TYPES,
      )
      if (source?.system) {
        throw new BadRequestException('首页渠道字段必须使用可配置的 Lead 动态字段')
      }
      return
    }

    const result = this.resolveHomeAnalyticsField(
      fields,
      config.customerResultFieldKey,
      '结果字段',
      HOME_ANALYTICS_RESULT_TYPES,
    )
    if (result?.system) {
      throw new BadRequestException('首页结果字段必须使用 Customer 动态字段')
    }

    const resultValues = config.customerResultValues
    if (resultValues !== undefined) {
      if (
        !Array.isArray(resultValues) ||
        resultValues.length > 50 ||
        resultValues.some((value) => typeof value !== 'string' || !value.trim())
      ) {
        throw new BadRequestException('首页结果命中值配置不正确')
      }
      if (new Set(resultValues).size !== resultValues.length) {
        throw new BadRequestException('首页结果命中值不能重复')
      }
      if (!result && resultValues.length) {
        throw new BadRequestException('配置结果命中值前必须先选择 Customer 结果字段')
      }
      if (result?.options?.length && resultValues.length) {
        const allowed = new Set(result.options.map((option) => option.value))
        if (resultValues.some((value) => !allowed.has(value))) {
          throw new BadRequestException('首页结果命中值包含字段选项以外的值')
        }
      }
    }

    const resultTime = this.resolveHomeAnalyticsField(
      fields,
      config.customerResultTimeFieldKey,
      '结果时间字段',
      HOME_ANALYTICS_TIME_TYPES,
    )
    if (resultTime?.system) {
      throw new BadRequestException('首页结果时间字段必须使用 Customer 动态字段')
    }
    const resultAmount = this.resolveHomeAnalyticsField(
      fields,
      config.customerResultAmountFieldKey,
      '结果金额字段',
      HOME_ANALYTICS_AMOUNT_TYPES,
    )
    if (resultAmount?.system) {
      throw new BadRequestException('首页结果金额字段必须使用 Customer 动态字段')
    }
    if ((resultTime || resultAmount) && !result) {
      throw new BadRequestException('配置结果时间或金额字段前必须先选择 Customer 结果字段')
    }
  }

  private resolveHomeAnalyticsField(
    fields: FieldVO[],
    key: string | undefined,
    label: string,
    allowed: Set<FieldType>,
  ): FieldVO | null {
    if (key === undefined) return null
    const normalized = key.trim()
    if (!normalized || normalized.length > 100) {
      throw new BadRequestException(`首页分析${label}配置不正确`)
    }
    const field = fields.find((item) => item.key === normalized)
    if (!field) throw new BadRequestException(`首页分析${label}不存在：${normalized}`)
    if (!allowed.has(field.type)) {
      throw new BadRequestException(`「${field.label}」不能作为首页分析${label}`)
    }
    return field
  }

  private async assertHomeAnalyticsFieldNotReferenced(
    tx: PrismaTransaction,
    organizationId: string,
    formKey: string,
    fieldKey: string,
  ): Promise<void> {
    if (formKey !== 'lead' && formKey !== 'customer') return
    const form = await this.ensureForm(tx, organizationId, formKey)
    const blob = await tx.orm.public.SysModuleFormBlob.where({ id: form.id }).first()
    const formProp = this.parseObject(blob?.prop)
    const raw = formProp['homeAnalytics']
    let config = this.isRecord(raw) ? raw : null
    // 兼容此前错误存放在 Lead formProp 中的 Customer 首页分析引用。
    if (!config && formKey === 'customer') {
      const leadForm = await this.ensureForm(tx, organizationId, 'lead')
      const leadBlob = await tx.orm.public.SysModuleFormBlob.where({ id: leadForm.id }).first()
      const legacy = this.parseObject(leadBlob?.prop)['homeAnalytics']
      config = this.isRecord(legacy) ? legacy : null
    }
    if (!config) return
    const references =
      formKey === 'lead'
        ? [config?.['leadSourceFieldKey']]
        : [
            config?.['customerResultFieldKey'],
            config?.['customerResultTimeFieldKey'],
            config?.['customerResultAmountFieldKey'],
          ]
    if (references.some((value) => value === fieldKey)) {
      throw new BadRequestException('该字段正在被首页分析使用，请先修改首页分析设置')
    }
  }

  private validateFormPropInput(formProp: ModuleFormProp): void {
    if (formProp.layout !== undefined && ![1, 2, 3, 4].includes(formProp.layout)) {
      throw new BadRequestException('表单布局配置不正确')
    }
    if (formProp.labelPos !== undefined && !['top', 'left'].includes(formProp.labelPos)) {
      throw new BadRequestException('字段标题位置配置不正确')
    }
    if (
      formProp.viewSize !== undefined &&
      !['small', 'medium', 'large'].includes(formProp.viewSize)
    ) {
      throw new BadRequestException('PC 表单尺寸配置不正确')
    }
    if (
      formProp.leadUniqueScope !== undefined &&
      !['RESOURCE_POOL', 'ORGANIZATION'].includes(formProp.leadUniqueScope)
    ) {
      throw new BadRequestException('线索判重范围配置不正确')
    }
    if (formProp.leadStages !== undefined) {
      if (!Array.isArray(formProp.leadStages) || formProp.leadStages.length === 0) {
        throw new BadRequestException('线索状态至少需要配置一项')
      }
      if (formProp.leadStages.length > 50) throw new BadRequestException('线索状态最多配置 50 项')
      const keys = new Set<string>()
      const names = new Set<string>()
      let enabledCount = 0
      for (const stage of formProp.leadStages) {
        if (!stage || typeof stage !== 'object') throw new BadRequestException('线索状态配置不正确')
        if (typeof stage.key !== 'string' || !/^[A-Za-z0-9_-]{1,30}$/.test(stage.key)) {
          throw new BadRequestException(
            '线索状态 key 只能包含字母、数字、下划线或短横线，且最长 30 位',
          )
        }
        const name = typeof stage.name === 'string' ? stage.name.trim() : ''
        if (!name || name.length > 100) {
          throw new BadRequestException('线索状态名称不能为空且最长 100 字')
        }
        if (!['ACTIVE', 'SUCCESS', 'FAILURE'].includes(stage.kind)) {
          throw new BadRequestException('线索状态类型配置不正确')
        }
        if (stage.enabled !== undefined && typeof stage.enabled !== 'boolean') {
          throw new BadRequestException('线索状态启用配置不正确')
        }
        if (keys.has(stage.key)) throw new BadRequestException('线索状态 key 不能重复')
        if (names.has(name)) throw new BadRequestException('线索状态名称不能重复')
        keys.add(stage.key)
        names.add(name)
        if (stage.enabled !== false) enabledCount++
      }
      if (enabledCount === 0) throw new BadRequestException('至少需要保留一个启用的线索状态')
    }
  }

  private validateFieldSpecificConfig(type: FieldType, config?: FieldConfig | null): void {
    if (config?.mobileSelectMode !== undefined) {
      if (!supportsMobileSearchSelect(type)) {
        throw new BadRequestException('当前字段类型不支持配置移动端选择方式')
      }
      if (!(MOBILE_SELECT_MODES as readonly string[]).includes(config.mobileSelectMode)) {
        throw new BadRequestException('移动端选择方式不正确')
      }
    }
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
    tx: PrismaTransaction,
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
      origin: 'CUSTOM',
      templateLabel: null,
      capabilities: { ...dynamicFieldCapabilities(subField.type, formKey), unique: false },
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

  private async countFieldValues(tx: PrismaTransaction, fieldId: string): Promise<number> {
    const id = fieldId
    const counts = await Promise.all([
      tx.orm.public.ClueField.where({ fieldId: id }).aggregate((agg) => ({ count: agg.count() })),
      tx.orm.public.ClueFieldBlob.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.CustomerField.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.CustomerFieldBlob.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.CustomerContactField.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.CustomerContactFieldBlob.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.FollowUpPlanField.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.FollowUpPlanFieldBlob.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.FollowUpRecordField.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.FollowUpRecordFieldBlob.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.CustomFormDataField.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      tx.orm.public.CustomFormDataFieldBlob.where({ fieldId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
    ])
    return counts.reduce((sum, item) => sum + item.count, 0)
  }

  private async deleteFieldValues(tx: PrismaTransaction, fieldId: string): Promise<void> {
    const id = fieldId
    await Promise.all([
      tx.orm.public.ClueField.where({ fieldId: id }).deleteAll(),
      tx.orm.public.ClueFieldBlob.where({ fieldId: id }).deleteAll(),
      tx.orm.public.CustomerField.where({ fieldId: id }).deleteAll(),
      tx.orm.public.CustomerFieldBlob.where({ fieldId: id }).deleteAll(),
      tx.orm.public.CustomerContactField.where({ fieldId: id }).deleteAll(),
      tx.orm.public.CustomerContactFieldBlob.where({ fieldId: id }).deleteAll(),
      tx.orm.public.FollowUpPlanField.where({ fieldId: id }).deleteAll(),
      tx.orm.public.FollowUpPlanFieldBlob.where({ fieldId: id }).deleteAll(),
      tx.orm.public.FollowUpRecordField.where({ fieldId: id }).deleteAll(),
      tx.orm.public.FollowUpRecordFieldBlob.where({ fieldId: id }).deleteAll(),
      tx.orm.public.CustomFormDataField.where({ fieldId: id }).deleteAll(),
      tx.orm.public.CustomFormDataFieldBlob.where({ fieldId: id }).deleteAll(),
    ])
  }

  private async deleteCustomSubFieldValues(
    tx: PrismaTransaction,
    blob: boolean,
    parentId: string,
    childIds: string[],
  ): Promise<void> {
    if (blob) {
      await tx.orm.public.CustomFormDataFieldBlob.where({
        refSubId: parentId,
      }).deleteAll()
      if (childIds.length) {
        await tx.orm.public.CustomFormDataFieldBlob.where((row) =>
          row.fieldId.in(childIds),
        ).deleteAll()
      }
      return
    }
    await tx.orm.public.CustomFormDataField.where({
      refSubId: parentId,
    }).deleteAll()
    if (childIds.length) {
      await tx.orm.public.CustomFormDataField.where((row) => row.fieldId.in(childIds)).deleteAll()
    }
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

  private async validateFormPropLinkageInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    targetFormKey: string,
    targetFields: FieldVO[],
    formProp: Record<string, unknown>,
  ): Promise<void> {
    const linkProp = this.parseFormLinkProp(formProp['linkProp'])
    const sourceKeys = Object.keys(linkProp)
    if (!sourceKeys.length) return
    for (const sourceFormKey of sourceKeys) {
      const sourceFields =
        sourceFormKey === targetFormKey
          ? targetFields
          : await this.listFieldsInTransaction(tx, organizationId, sourceFormKey)
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
