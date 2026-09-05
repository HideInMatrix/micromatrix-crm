<script setup lang="ts">
import {
  BUILTIN_DATA_SOURCE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  type DataSourceType,
  type FieldOption,
  type FieldVO,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, reactive, ref, watch } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'
import type { FieldForm } from '@/api/metadata'

const props = defineProps<{
  currentFormId: string
  editingField: FieldVO | null
  saving: boolean
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ save: [payload: FieldForm] }>()

const formRef = ref<FormInstance>()
const customDataSources = ref<Array<{ id: string; name: string }>>([])
const sourceLoading = ref(false)
const form = reactive<FieldForm & { options: FieldOption[] }>({
  label: '',
  type: 'text',
  required: false,
  options: [],
  config: {},
  span: 12,
  showInList: true,
  listWidth: undefined,
  hidden: false,
})

const rules: FormRules = {
  label: [{ required: true, message: '请输入字段名称', trigger: 'blur' }],
}

function reset() {
  Object.assign(form, {
    label: '',
    type: 'text',
    required: false,
    options: [],
    config: {},
    span: 12,
    showInList: true,
    listWidth: undefined,
    hidden: false,
  })
}

function loadEditingField() {
  reset()
  const field = props.editingField
  if (!field) return
  Object.assign(form, {
    label: field.label,
    type: field.type,
    required: field.required,
    options: (field.options ?? []).map((option) => ({ ...option })),
    config: { ...(field.config ?? {}) },
    span: field.span,
    showInList: field.showInList,
    listWidth: field.listWidth ?? undefined,
    hidden: field.hidden,
  })
}

watch(visible, (open) => {
  if (open) {
    loadEditingField()
    void loadCustomDataSources()
  }
})

function handleTypeChange(type: FieldVO['type']) {
  if (type === 'location') {
    form.config = { ...(form.config ?? {}), scope: 'ALL', locationType: 'PCD' }
  } else if (type === 'attachment') {
    form.config = { ...(form.config ?? {}), onlyOne: false, accept: '', limitSize: '' }
    form.showInList = false
  } else if (type === 'data_source' || type === 'data_source_multiple') {
    form.config = { ...(form.config ?? {}), dataSourceType: 'CUSTOMER' }
  }
}

const isDataSourceField = computed(
  () => form.type === 'data_source' || form.type === 'data_source_multiple',
)

const isSavedDataSourceField = computed(
  () =>
    Boolean(props.editingField) &&
    (props.editingField?.type === 'data_source' ||
      props.editingField?.type === 'data_source_multiple'),
)

async function loadCustomDataSources() {
  sourceLoading.value = true
  try {
    const { data } = await customFormApi.options()
    customDataSources.value = data.filter((item) => item.id !== props.currentFormId)
  } catch (error) {
    customDataSources.value = []
    ElMessage.error(extractErrorMessage(error))
  } finally {
    sourceLoading.value = false
  }
}

function updateDataSourceType(value: string) {
  if (!form.config) form.config = {}
  form.config.dataSourceType = value as DataSourceType
}

function needsOptions() {
  return ['select', 'multiselect', 'radio', 'checkbox'].includes(form.type)
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const options = needsOptions()
    ? form.options
        .map((item) => ({ ...item, label: item.label.trim(), value: item.value.trim() }))
        .filter((item) => item.label && item.value)
    : undefined
  if (needsOptions() && !options?.length) {
    ElMessage.warning('请至少配置一个选项')
    return
  }
  if (form.type === 'formula' && !form.config?.formula?.trim()) {
    ElMessage.warning('请输入公式表达式')
    return
  }
  if (isDataSourceField.value && !form.config?.dataSourceType) {
    ElMessage.warning('请选择数据源')
    return
  }
  emit('save', {
    label: form.label.trim(),
    type: form.type,
    required: props.editingField?.system ? true : form.required,
    options,
    config: form.config,
    span: form.span,
    showInList: form.showInList,
    listWidth: form.listWidth,
    hidden: props.editingField?.system ? false : form.hidden,
  })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="editingField ? `编辑字段 · ${editingField.label}` : '新增字段'"
    width="560px"
    destroy-on-close
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="字段名称" prop="label">
        <el-input v-model="form.label" maxlength="30" />
      </el-form-item>
      <el-form-item label="字段类型">
        <el-select
          v-model="form.type"
          class="w-full"
          :disabled="Boolean(editingField?.system)"
          @change="handleTypeChange"
        >
          <el-option
            v-for="option in FIELD_TYPE_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item v-if="needsOptions()" label="选项">
        <div class="w-full space-y-2">
          <div v-for="(option, index) in form.options" :key="index" class="flex gap-2">
            <el-input v-model="option.label" placeholder="显示名称" />
            <el-input v-model="option.value" placeholder="保存值" />
            <el-button text type="danger" @click="form.options.splice(index, 1)">删除</el-button>
          </div>
          <el-button text type="primary" @click="form.options.push({ label: '', value: '' })">
            添加选项
          </el-button>
        </div>
      </el-form-item>

      <el-form-item v-if="isDataSourceField" label="数据源">
        <el-select
          :model-value="form.config?.dataSourceType"
          class="w-full"
          filterable
          :loading="sourceLoading"
          :disabled="isSavedDataSourceField"
          @update:model-value="updateDataSourceType"
        >
          <el-option-group label="业务数据">
            <el-option
              v-for="option in BUILTIN_DATA_SOURCE_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-option-group>
          <el-option-group v-if="customDataSources.length" label="自定义表单">
            <el-option
              v-for="option in customDataSources"
              :key="option.id"
              :label="option.name"
              :value="option.id"
            />
          </el-option-group>
        </el-select>
        <div
          v-if="isSavedDataSourceField"
          class="mt-1 text-xs text-[var(--el-text-color-secondary)]"
        >
          数据源类型保存后不可修改；如需切换，请删除字段后重新创建。
        </div>
      </el-form-item>

      <el-form-item v-if="form.type === 'formula'" label="公式表达式">
        <el-input v-model="form.config!.formula" placeholder="例如：cf_amount * cf_rate / 100" />
      </el-form-item>

      <template v-if="form.type === 'location'">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="地址范围">
            <el-select v-model="form.config!.scope" class="w-full">
              <el-option label="全部国家/地区" value="ALL" />
              <el-option label="中国（含港澳台）" value="CN" />
            </el-select>
          </el-form-item>
          <el-form-item label="地址层级">
            <el-select v-model="form.config!.locationType" class="w-full">
              <el-option v-if="form.config?.scope !== 'CN'" label="国家/地区" value="C" />
              <el-option label="省/州" value="P" />
              <el-option label="省/州 + 城市" value="PC" />
              <el-option label="省/州 + 城市 + 区县" value="PCD" />
              <el-option label="省/州 + 城市 + 区县 + 详细地址" value="detail" />
            </el-select>
          </el-form-item>
        </div>
      </template>

      <el-form-item v-if="form.type === 'attachment'" label="附件上传配置">
        <div class="w-full space-y-3">
          <el-checkbox v-model="form.config!.onlyOne">仅允许单个附件</el-checkbox>
          <el-input
            v-model="form.config!.accept"
            placeholder="允许扩展名，例如 .pdf,.docx；留空表示平台支持的全部类型"
          />
          <el-input
            v-model="form.config!.limitSize"
            placeholder="单文件大小，例如 512KB 或 20MB；留空默认 20MB"
          />
        </div>
      </el-form-item>

      <div class="grid grid-cols-2 gap-4">
        <el-form-item label="栅格宽度">
          <el-select v-model="form.span" class="w-full">
            <el-option :value="6" label="1/4" />
            <el-option :value="8" label="1/3" />
            <el-option :value="12" label="1/2" />
            <el-option :value="24" label="整行" />
          </el-select>
        </el-form-item>
        <el-form-item label="列表列宽">
          <el-input-number v-model="form.listWidth" :min="80" :max="600" class="!w-full" />
        </el-form-item>
      </div>

      <div class="grid grid-cols-3 gap-4">
        <el-form-item label="必填">
          <el-switch v-model="form.required" :disabled="Boolean(editingField?.system)" />
        </el-form-item>
        <el-form-item label="列表显示">
          <el-switch v-model="form.showInList" />
        </el-form-item>
        <el-form-item label="隐藏字段">
          <el-switch v-model="form.hidden" :disabled="Boolean(editingField?.system)" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>
