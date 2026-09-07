import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  evaluateFormRuntime,
  evaluateFormula,
  isCustomFieldKey,
  isEmptyFormValue,
  isLocationCodeAllowed,
  splitLocationValue,
  valueWithinOptionRange,
  type FieldVO,
  type ModuleFormProp,
} from '@micromatrix/shared'
import { CreateFieldDto, UpdateFieldDto } from './dto/field.dto'
import { ModuleFormsService } from './module-forms.service'

/**
 * 现有 Web/业务模块的稳定 FieldVO 适配器。
 * 数据真相已经切换为 sys_module_form/sys_module_field 及其 Blob 表。
 */
@Injectable()
export class MetadataService {
  constructor(private readonly moduleForms: ModuleFormsService) {}

  listFields(organizationId: string, module: string): Promise<FieldVO[]> {
    return this.moduleForms.listFields(organizationId, module)
  }

  getFormConfig(organizationId: string, module: string) {
    return this.moduleForms.getConfig(organizationId, module)
  }

  async updateFormProp(
    organizationId: string,
    module: string,
    patch: Pick<ModuleFormProp, 'labelPos' | 'viewSize'>,
    actorId: string,
  ) {
    const current = await this.moduleForms.getConfig(organizationId, module)
    return this.moduleForms.saveFormProp(
      organizationId,
      module,
      { ...current.formProp, ...patch },
      actorId,
    )
  }

  async fieldsMap(organizationId: string, module: string): Promise<Map<string, FieldVO>> {
    const fields = await this.listFields(organizationId, module)
    return new Map(fields.map((field) => [field.key, field]))
  }

  async hasUniqueRule(organizationId: string, module: string, key: string): Promise<boolean> {
    const field = (await this.fieldsMap(organizationId, module)).get(key)
    return Boolean(field?.config?.unique)
  }

  async resolveEditableField(
    organizationId: string,
    module: string,
    fieldIdOrKey: string,
  ): Promise<FieldVO> {
    const fields = await this.listFields(organizationId, module)
    const field = fields.find((item) => item.id === fieldIdOrKey || item.key === fieldIdOrKey)
    if (!field) throw new NotFoundException('字段不存在')
    if (field.hidden) throw new BadRequestException(`「${field.label}」当前不可编辑`)
    if (field.type === 'formula') throw new BadRequestException('计算字段不支持批量修改')
    if (field.type === 'sub_product') throw new BadRequestException('子表格不支持批量修改')
    return field
  }

  validateBatchFieldValue(field: FieldVO, value: unknown): void {
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    if (field.required && empty) throw new BadRequestException(`「${field.label}」为必填项`)
    if (empty) return
    if (
      [
        'text',
        'textarea',
        'phone',
        'email',
        'select',
        'radio',
        'member',
        'dept',
        'data_source',
      ].includes(field.type) &&
      typeof value !== 'string'
    ) {
      throw new BadRequestException(`「${field.label}」字段值格式不正确`)
    }
    if (
      ['multiselect', 'checkbox', 'data_source_multiple'].includes(field.type) &&
      !Array.isArray(value)
    ) {
      throw new BadRequestException(`「${field.label}」字段值格式不正确`)
    }
    if (field.type === 'data_source_multiple') {
      const ids = value as unknown[]
      if (ids.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new BadRequestException(`「${field.label}」数据源值格式不正确`)
      }
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException(`「${field.label}」不能包含重复数据源记录`)
      }
    }
    if (['picture', 'attachment'].includes(field.type) && !Array.isArray(value)) {
      throw new BadRequestException(`「${field.label}」字段值格式不正确`)
    }
    if (field.type === 'attachment') {
      const ids = value as unknown[]
      if (ids.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new BadRequestException(`「${field.label}」附件值格式不正确`)
      }
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException(`「${field.label}」不能包含重复附件`)
      }
      const max = field.config?.onlyOne ? 1 : 10
      if (ids.length > max)
        throw new BadRequestException(`「${field.label}」最多上传 ${max} 个附件`)
    }
    if (field.type === 'location') {
      if (typeof value !== 'string') {
        throw new BadRequestException(`「${field.label}」字段值格式不正确`)
      }
      const parsed = splitLocationValue(value)
      const scope = field.config?.scope ?? 'ALL'
      const locationType = field.config?.locationType ?? 'PCD'
      if (!parsed || !isLocationCodeAllowed(parsed.code, scope, locationType)) {
        throw new BadRequestException(`「${field.label}」地区编码不正确`)
      }
      if (locationType !== 'detail' && parsed.detail) {
        throw new BadRequestException(`「${field.label}」当前地址类型不支持详细地址`)
      }
      if (parsed.detail.length > 200) {
        throw new BadRequestException(`「${field.label}」详细地址不能超过 200 个字符`)
      }
    }
    if (['number', 'currency', 'percent'].includes(field.type) && !Number.isFinite(Number(value))) {
      throw new BadRequestException(`「${field.label}」必须是有效数字`)
    }
    if (field.type === 'switch' && typeof value !== 'boolean') {
      throw new BadRequestException(`「${field.label}」必须是布尔值`)
    }
  }

  createField(
    organizationId: string,
    module: string,
    dto: CreateFieldDto,
    actorId?: string,
  ): Promise<FieldVO> {
    return this.moduleForms.createField(organizationId, module, dto, actorId)
  }

  updateField(
    organizationId: string,
    id: string,
    dto: UpdateFieldDto,
    actorId?: string,
  ): Promise<FieldVO> {
    return this.moduleForms.updateField(organizationId, id, dto, actorId)
  }

  deleteField(organizationId: string, id: string) {
    return this.moduleForms.deleteField(organizationId, id)
  }

  reorder(organizationId: string, module: string, orderedIds: string[], actorId?: string) {
    return this.moduleForms.reorder(organizationId, module, orderedIds, actorId)
  }

  /**
   * 图外模块仍使用 customData 时的过渡校验器；字段定义已经来自直接 ModuleForm 表。
   * Clue/Customer/CustomerContact 必须改用 ResourceFieldValueService，不能调用本方法落库。
   */
  async validateCustomData(
    organizationId: string,
    module: string,
    input: Record<string, unknown> | undefined,
    options: { requireAll: boolean },
  ): Promise<Record<string, unknown>> {
    const fieldList = await this.listFields(organizationId, module)
    const fields = new Map(fieldList.map((field) => [field.key, field]))
    const runtime = evaluateFormRuntime(fieldList, input ?? {})
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(runtime.values)) {
      const field = fields.get(key)
      if (!field || !isCustomFieldKey(key) || field.type === 'formula') continue
      if (runtime.visibleByFieldId[field.id] === false) continue
      if (!valueWithinOptionRange(value, runtime.optionRangesByFieldId[field.id])) {
        throw new BadRequestException(`「${field.label}」当前值不在字段联动允许范围内`)
      }
      if (field.type === 'sub_product') {
        result[key] = this.validateSubTableRows(field, value)
        continue
      }
      this.validateBatchFieldValue(field, value)
      result[key] = value
    }
    if (options.requireAll) {
      for (const field of fields.values()) {
        if (
          !isCustomFieldKey(field.key) ||
          field.system ||
          !field.required ||
          runtime.visibleByFieldId[field.id] === false
        )
          continue
        const value = result[field.key]
        if (isEmptyFormValue(value)) {
          throw new BadRequestException(`「${field.label}」为必填项`)
        }
      }
    }
    return result
  }

  private validateSubTableRows(field: FieldVO, value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`「${field.label}」字段值格式不正确`)
    }
    const subFields = field.subFields ?? []
    const byKey = new Map(subFields.map((subField) => [subField.key, subField]))
    return value.map((rawRow, rowIndex) => {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        throw new BadRequestException(`「${field.label}」第 ${rowIndex + 1} 行格式不正确`)
      }
      const inputRow = rawRow as Record<string, unknown>
      const row: Record<string, unknown> = {}
      if (typeof inputRow['id'] === 'string' && inputRow['id'].trim()) {
        row['id'] = inputRow['id'].trim()
      }
      for (const subField of subFields) {
        if (subField.type === 'formula') continue
        const cellValue = inputRow[subField.key]
        const empty =
          cellValue === undefined ||
          cellValue === null ||
          cellValue === '' ||
          (Array.isArray(cellValue) && cellValue.length === 0)
        if (subField.required && empty) {
          throw new BadRequestException(
            `「${field.label}」第 ${rowIndex + 1} 行「${subField.label}」为必填项`,
          )
        }
        if (empty) continue
        this.validateBatchFieldValue(subField, cellValue)
        row[subField.key] = cellValue
      }
      for (const key of Object.keys(inputRow)) {
        if (key === 'id' || byKey.has(key)) continue
        throw new BadRequestException(`「${field.label}」包含未知子字段「${key}」`)
      }
      return row
    })
  }

  computeFormulas(
    fields: FieldVO[],
    record: Record<string, unknown>,
    fieldValues: Record<string, unknown>,
  ): Record<string, number | null> {
    const vars: Record<string, unknown> = { ...record, ...fieldValues }
    const output: Record<string, number | null> = {}
    for (const field of fields) {
      if (field.type !== 'formula' || !field.config?.formula) continue
      output[field.key] = evaluateFormula(field.config.formula, vars)
    }
    return output
  }
}
