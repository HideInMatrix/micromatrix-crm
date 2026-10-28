<script setup lang="ts">
import type { AttachmentVO, CustomFormDataVO, DepartmentVO, FieldVO } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, ref } from 'vue'
import type { MemberOption } from '@/api/system'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'

const visible = defineModel<boolean>({ required: true })
const name = defineModel<string>('name', { required: true })
const ownerId = defineModel<string>('ownerId', { required: true })
const values = defineModel<Record<string, unknown>>('values', { required: true })

const emit = defineEmits<{ save: [] }>()

const baseFormRef = ref<FormInstance>()
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const props = defineProps<{
  activeFormName: string
  nameFieldLabel: string
  referenceMode?: boolean
  editingData: CustomFormDataVO | null
  saving: boolean
  ownerOptions: MemberOption[]
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
  attachmentMap: Record<string, AttachmentVO[]>
  attachmentDownload: (file: AttachmentVO) => Promise<void>
  beforeClose: (done: () => void) => void | Promise<void>
}>()
const baseRules = computed<FormRules>(() => ({
  name: [{ required: true, message: `请输入${props.nameFieldLabel}`, trigger: 'blur' }],
  ...(!props.referenceMode
    ? { ownerId: [{ required: true, message: '请选择负责人', trigger: 'change' }] }
    : {}),
}))

async function validate() {
  const [baseValid, dynamicValid] = await Promise.all([
    baseFormRef.value?.validate().catch(() => false),
    props.fields.length ? dynamicFormRef.value?.validate() : true,
  ])
  return Boolean(baseValid && dynamicValid)
}

async function submit() {
  if (await validate()) emit('save')
}

defineExpose({ validate })
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="editingData ? `编辑 · ${editingData.name}` : `新建 · ${activeFormName}`"
    size="720px"
    destroy-on-close
    :before-close="beforeClose"
  >
    <div class="pb-16">
      <el-form ref="baseFormRef" :model="{ name, ownerId }" :rules="baseRules" label-position="top">
        <el-row :gutter="16">
          <el-col :span="referenceMode ? 24 : 12">
            <el-form-item :label="nameFieldLabel" prop="name">
              <el-input v-model="name" maxlength="255" />
            </el-form-item>
          </el-col>
          <el-col v-if="!referenceMode" :span="12">
            <el-form-item label="负责人" prop="ownerId">
              <el-select v-model="ownerId" filterable class="w-full">
                <el-option
                  v-for="member in ownerOptions"
                  :key="member.id"
                  :label="member.name"
                  :value="member.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <DynamicForm
        v-if="fields.length"
        ref="dynamicFormRef"
        v-model="values"
        :fields="fields"
        :members="members"
        :dept-tree="deptTree"
        :attachment-map="attachmentMap"
        :attachment-download="attachmentDownload"
      />
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </div>
    </template>
  </el-drawer>
</template>
