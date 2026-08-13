<script setup lang="ts">
import { evaluateFormula, type DepartmentVO, type FieldVO } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, ref } from 'vue'
import type { MemberOption } from '@/api/system'
import DynamicFormItem from './DynamicFormItem.vue'

const props = defineProps<{
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
}>()

/** 扁平模型：系统字段键 + cf_* 自定义字段键 */
const model = defineModel<Record<string, unknown>>({ required: true })

const formRef = ref<FormInstance>()

const visibleFields = computed(() => props.fields.filter((f) => !f.hidden))

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

async function validate(): Promise<boolean> {
  return (await formRef.value?.validate().catch(() => false)) ?? false
}

defineExpose({ validate })
</script>

<template>
  <el-form ref="formRef" :model="model" :rules="rules" label-position="top">
    <el-row :gutter="16">
      <el-col v-for="field in visibleFields" :key="field.key" :span="field.span">
        <el-form-item :label="field.label" :prop="field.key">
          <DynamicFormItem
            v-model="model[field.key]"
            :field="field"
            :members="members"
            :dept-tree="deptTree"
            :formula-value="formulaValues[field.key]"
          />
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>
