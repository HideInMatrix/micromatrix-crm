<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import type { MemberOption } from '@/api/system'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'

const props = defineProps<{
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
  selectedCount: number
  title?: string
}>()

const emit = defineEmits<{
  confirm: [payload: { fieldId: string; fieldValue: unknown }]
}>()

const visible = defineModel<boolean>({ required: true })
const fieldId = ref('')
const model = ref<Record<string, unknown>>({})
const formRef = ref<InstanceType<typeof DynamicForm>>()

const editableFields = computed(() =>
  props.fields.filter((field) => !field.hidden && field.type !== 'formula'),
)
const selectedField = computed(() => editableFields.value.find((field) => field.id === fieldId.value) ?? null)
const singleField = computed(() => (selectedField.value ? [selectedField.value] : []))

watch(fieldId, () => {
  model.value = {}
})

watch(visible, (value) => {
  if (!value) {
    fieldId.value = ''
    model.value = {}
  }
})

async function submit() {
  const field = selectedField.value
  if (!field) {
    ElMessage.warning('请选择要修改的字段')
    return
  }
  if (!(await formRef.value?.validate())) return
  emit('confirm', { fieldId: field.id, fieldValue: model.value[field.key] })
}
</script>

<template>
  <el-dialog v-model="visible" :title="title ?? '批量修改字段'" width="520px" destroy-on-close>
    <el-alert
      :title="`将同时修改已选择的 ${selectedCount} 条数据`"
      type="warning"
      :closable="false"
      class="mb-4"
    />
    <el-form label-position="top">
      <el-form-item label="修改字段" required>
        <el-select v-model="fieldId" class="!w-full" filterable placeholder="选择字段">
          <el-option
            v-for="field in editableFields"
            :key="field.id"
            :label="field.label"
            :value="field.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <DynamicForm
      v-if="selectedField"
      ref="formRef"
      v-model="model"
      :fields="singleField"
      :members="members"
      :dept-tree="deptTree"
    />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!selectedField" @click="submit">确认修改</el-button>
    </template>
  </el-dialog>
</template>
