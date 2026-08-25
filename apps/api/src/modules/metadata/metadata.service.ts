import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { evaluateFormula, isCustomFieldKey, type FieldVO } from '@micromatrix/shared'
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
      ['text', 'textarea', 'phone', 'email', 'select', 'radio', 'member', 'dept'].includes(
        field.type,
      ) &&
      typeof value !== 'string'
    ) {
      throw new BadRequestException(`「${field.label}」字段值格式不正确`)
    }
    if (['multiselect', 'checkbox'].includes(field.type) && !Array.isArray(value)) {
      throw new BadRequestException(`「${field.label}」字段值格式不正确`)
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
    const fields = await this.fieldsMap(organizationId, module)
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input ?? {})) {
      const field = fields.get(key)
      if (!field || !isCustomFieldKey(key) || field.type === 'formula') continue
      this.validateBatchFieldValue(field, value)
      result[key] = value
    }
    if (options.requireAll) {
      for (const field of fields.values()) {
        if (!isCustomFieldKey(field.key) || field.system || !field.required || field.hidden)
          continue
        const value = result[field.key]
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        ) {
          throw new BadRequestException(`「${field.label}」为必填项`)
        }
      }
    }
    return result
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
