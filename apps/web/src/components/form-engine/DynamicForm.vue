<script setup lang="ts">
import {
  applyDataSourceRecordLinks,
  evaluateFormRuntime,
  evaluateFormula,
  type AttachmentVO,
  type DataSourceRecordVO,
  type DepartmentVO,
  type FieldVO,
  type ModuleFormProp,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type { MemberOption } from '@/api/system'
import DynamicFormItem from './DynamicFormItem.vue'
import SubTableFieldInput from './SubTableFieldInput.vue'

const props = defineProps<{
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
  fieldFilter?: (field: FieldVO) => boolean
  formProp?: ModuleFormProp
  attachmentMap?: Record<string, AttachmentVO[]>
  attachmentDownload?: (file: AttachmentVO) => Promise<void>
  attachmentObjectUrl?: (id: string) => Promise<string>
}>()

/** 扁平模型：系统字段键 + cf_* 自定义字段键 */
const model = defineModel<Record<string, unknown>>({ required: true })

const formRef = ref<FormInstance>()

const runtime = computed(() => evaluateFormRuntime(props.fields, model.value))
const visibleFields = computed(() =>
  props.fields.filter(
    (field) =>
      runtime.value.visibleByFieldId[field.id] !== false && (props.fieldFilter?.(field) ?? true),
  ),
)

watch(
  () => runtime.value.values,
  (nextValues) => {
    const changed = Object.entries(nextValues).some(
      ([key, value]) => JSON.stringify(model.value[key]) !== JSON.stringify(value),
    )
    if (changed) model.value = { ...model.value, ...nextValues }
  },
  { deep: true, immediate: true },
)

const rules = computed<FormRules>(() => {
  const result: FormRules = {}
  for (const field of visibleFields.value) {
    const fieldRules = []
    if (field.required && field.type !== 'formula') {
      fieldRules.push({ required: true, message: `请填写${field.label}`, trigger: 'blur' })
    }
    if (field.type === 'email') {
      fieldRules.push({ type: 'email' as const, message: '邮箱格式不正确', trigger: 'blur' })
    }
    if (field.type === 'sub_product') {
      fieldRules.push({
        validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
          if (value === undefined || value === null || value === '') return callback()
          if (!Array.isArray(value)) return callback(new Error(`${field.label}格式不正确`))
          for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
            const row = value[rowIndex]
            if (!row || typeof row !== 'object' || Array.isArray(row)) {
              return callback(new Error(`${field.label}第 ${rowIndex + 1} 行格式不正确`))
            }
            for (const subField of field.subFields ?? []) {
              if (!subField.required || subField.type === 'formula') continue
              const cell = (row as Record<string, unknown>)[subField.key]
              const empty =
                cell === undefined ||
                cell === null ||
                cell === '' ||
                (Array.isArray(cell) && cell.length === 0)
              if (empty) {
                return callback(
                  new Error(`${field.label}第 ${rowIndex + 1} 行「${subField.label}」为必填项`),
                )
              }
            }
          }
          callback()
        },
        trigger: 'change',
      })
    }
    if (fieldRules.length) result[field.key] = fieldRules
  }
  return result
})

/** 公式字段实时求值 */
const formulaValues = computed<Record<string, number | null>>(() => {
  const output: Record<string, number | null> = {}
  for (const field of props.fields) {
    if (field.type === 'formula' && field.config?.formula) {
      output[field.key] = evaluateFormula(field.config.formula, model.value)
    }
  }
  return output
})

function applyDataSourceRecord(field: FieldVO, record: DataSourceRecordVO | null) {
  if (!record || field.type !== 'data_source') return
  model.value = applyDataSourceRecordLinks(props.fields, field, record, model.value)
}

function setFieldValue(field: FieldVO, value: unknown) {
  model.value[field.key] = value
}

async function validate(): Promise<boolean> {
  return (await formRef.value?.validate().catch(() => false)) ?? false
}

defineExpose({ validate })
</script>

<template>
  <el-form
    ref="formRef"
    :model="model"
    :rules="rules"
    :label-position="formProp?.labelPos === 'left' ? 'left' : 'top'"
    :label-width="formProp?.labelPos === 'left' ? 'auto' : undefined"
  >
    <el-row :gutter="16">
      <el-col v-for="field in visibleFields" :key="field.key" :span="field.span">
        <el-form-item :label="field.label" :prop="field.key">
          <slot
            v-if="field.system && $slots['system-field']"
            name="system-field"
            :field="field"
            :value="model[field.key]"
            :set-value="(value: unknown) => setFieldValue(field, value)"
          />
          <template v-else>
            <SubTableFieldInput
              v-if="field.type === 'sub_product'"
              v-model="model[field.key]"
              :field="field"
              :members="members"
              :dept-tree="deptTree"
            />
            <DynamicFormItem
              v-else
              v-model="model[field.key]"
              :field="field"
              :option-range="runtime.optionRangesByFieldId[field.id]"
              :form-fields="fields"
              :form-values="model"
              :members="members"
              :dept-tree="deptTree"
              :attachment-options="attachmentMap?.[field.key] ?? []"
              :attachment-download="attachmentDownload"
              :attachment-object-url="attachmentObjectUrl"
              :formula-value="formulaValues[field.key]"
              @data-source-record="applyDataSourceRecord(field, $event)"
            />
          </template>
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>
