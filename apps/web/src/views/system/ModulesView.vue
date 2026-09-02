<script setup lang="ts">
import {
  FIELD_TYPE_OPTIONS,
  MODULE_LABELS,
  formulaVariables,
  type FieldOption,
  type FieldVO,
  type ModuleKey,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { extractErrorMessage } from '@/api/http'
import { metadataApi, type FieldForm } from '@/api/metadata'

const AVAILABLE_MODULES: ModuleKey[] = [
  'lead',
  'customer',
  'contact',
  'opportunity',
  'product',
  'price',
  'quote',
  'contract',
  'contractPaymentPlan',
  'contractPaymentRecord',
  'invoice',
  'order',
]

const route = useRoute()
const routeModule = () =>
  AVAILABLE_MODULES.includes(route.query.module as ModuleKey)
    ? (route.query.module as ModuleKey)
    : 'customer'
const activeModule = ref<ModuleKey>(routeModule())
const loading = ref(false)
const fields = ref<FieldVO[]>([])

const drawerVisible = ref(false)
const editingField = ref<FieldVO | null>(null)
const saving = ref(false)
const formRef = ref<FormInstance>()
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

const needOptions = computed(() =>
  ['select', 'multiselect', 'radio', 'checkbox'].includes(form.type),
)
const isFormula = computed(() => form.type === 'formula')
const supportsUnique = computed(() => {
  if (!['lead', 'customer', 'contact'].includes(activeModule.value)) return false
  if (!['text', 'phone', 'email'].includes(form.type)) return false
  const key = editingField.value?.key
  if (!editingField.value?.system) return true
  if (activeModule.value === 'customer') return key === 'name'
  if (activeModule.value === 'contact') return ['name', 'phone'].includes(key ?? '')
  return false
})

/** 公式可引用的数字类字段 */
const numericFieldKeys = computed(() =>
  fields.value
    .filter((f) => ['number', 'currency', 'percent'].includes(f.type))
    .map((f) => `${f.key}（${f.label}）`),
)

const typeLabel = (type: string) =>
  FIELD_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type

function normalizeFieldOptions(options: FieldOption[] | null | undefined): FieldOption[] {
  return ((options ?? []) as unknown[]).flatMap((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return []
    const record = option as Record<string, unknown>
    if (typeof record.label !== 'string' || typeof record.value !== 'string') return []
    return [
      {
        label: record.label,
        value: record.value,
        ...(typeof record.color === 'string' ? { color: record.color } : {}),
      },
    ]
  })
}

async function loadFields() {
  loading.value = true
  try {
    const { data } = await metadataApi.fields(activeModule.value)
    fields.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingField.value = null
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
  drawerVisible.value = true
}

function openEdit(field: FieldVO) {
  editingField.value = field
  Object.assign(form, {
    label: field.label,
    type: field.type,
    required: field.required,
    // 深拷贝并丢弃异常 option 元素，避免历史的 [] 元素在编辑后再次被 JSON 序列化成 []。
    options: normalizeFieldOptions(field.options),
    config: { ...(field.config ?? {}) },
    span: field.span,
    showInList: field.showInList,
    listWidth: field.listWidth ?? undefined,
    hidden: field.hidden,
  })
  drawerVisible.value = true
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const normalizedOptions = needOptions.value
    ? normalizeFieldOptions(form.options)
        .map((option) => ({ ...option, label: option.label.trim(), value: option.value.trim() }))
        .filter((option) => option.label && option.value)
    : undefined
  if (needOptions.value && normalizedOptions?.length === 0) {
    ElMessage.warning('请至少配置一个选项')
    return
  }
  if (isFormula.value && !form.config?.formula?.trim()) {
    ElMessage.warning('请输入公式表达式')
    return
  }

  saving.value = true
  try {
    const payload: FieldForm = {
      label: form.label.trim(),
      type: form.type,
      required: form.required,
      options: normalizedOptions,
      config: form.config,
      span: form.span,
      showInList: form.showInList,
      listWidth: form.listWidth,
      hidden: form.hidden,
    }
    if (editingField.value) {
      await metadataApi.updateField(editingField.value.id, payload)
      ElMessage.success('字段已更新')
    } else {
      await metadataApi.createField(activeModule.value, payload)
      ElMessage.success('字段已创建')
    }
    await loadFields()
    drawerVisible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleDelete(field: FieldVO) {
  const confirmed = await ElMessageBox.confirm(
    `删除字段「${field.label}」会同时删除该字段已经保存的业务值，且无法恢复。确定删除？`,
    '删除确认',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await metadataApi.deleteField(field.id)
    ElMessage.success('已删除')
    await loadFields()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDragEnd() {
  try {
    await metadataApi.reorder(
      activeModule.value,
      fields.value.map((f) => f.id),
    )
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    loadFields()
  }
}

function addOption() {
  form.options.push({ label: '', value: '' })
}

onMounted(loadFields)
watch(
  () => route.query.module,
  () => {
    activeModule.value = routeModule()
    loadFields()
  },
)
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between mb-4">
      <el-radio-group v-model="activeModule" @change="loadFields">
        <el-radio-button v-for="m in AVAILABLE_MODULES" :key="m" :value="m">
          {{ MODULE_LABELS[m] }}
        </el-radio-button>
      </el-radio-group>
      <el-button type="primary" @click="openCreate">新增自定义字段</el-button>
    </div>

    <div v-loading="loading">
      <div
        class="grid grid-cols-[24px_1fr_110px_70px_70px_70px_60px_140px] gap-2 px-3 py-2 text-xs text-[var(--el-text-color-secondary)] border-b border-[var(--el-border-color)]"
      >
        <span />
        <span>字段名称</span>
        <span>类型</span>
        <span>必填</span>
        <span>列表显示</span>
        <span>栅格</span>
        <span>属性</span>
        <span>操作</span>
      </div>

      <draggable
        v-model="fields"
        item-key="id"
        handle=".drag-handle"
        @end="handleDragEnd"
      >
        <template #item="{ element: field }">
          <div
            class="grid grid-cols-[24px_1fr_110px_70px_70px_70px_60px_140px] gap-2 items-center px-3 py-2.5 border-b border-[var(--el-border-color-lighter)] hover:bg-[var(--el-fill-color-light)] text-sm"
          >
            <span class="drag-handle cursor-move text-[var(--el-text-color-placeholder)]">⠿</span>
            <span>
              {{ field.label }}
              <span class="text-xs text-[var(--el-text-color-placeholder)] ml-1">{{ field.key }}</span>
            </span>
            <span>{{ typeLabel(field.type) }}</span>
            <span>
              <el-tag v-if="field.required" type="danger" size="small">必填</el-tag>
              <span v-else class="text-[var(--el-text-color-placeholder)]">-</span>
            </span>
            <span>
              <el-tag v-if="field.showInList" size="small">是</el-tag>
              <span v-else class="text-[var(--el-text-color-placeholder)]">否</span>
            </span>
            <span>{{ field.span }}/24</span>
            <span>
              <el-tag v-if="field.system" size="small" type="info">系统</el-tag>
              <el-tag v-else-if="field.hidden" size="small" type="warning">隐藏</el-tag>
              <span v-else class="text-[var(--el-text-color-placeholder)]">-</span>
            </span>
            <span>
              <el-button link type="primary" @click="openEdit(field)">编辑</el-button>
              <el-button link type="danger" :disabled="field.system" @click="handleDelete(field)">
                删除
              </el-button>
            </span>
          </div>
        </template>
      </draggable>
    </div>

    <el-drawer
      v-model="drawerVisible"
      :title="editingField ? `编辑字段：${editingField.label}` : '新增自定义字段'"
      size="440px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="字段名称" prop="label">
          <el-input v-model="form.label" />
        </el-form-item>
        <el-form-item label="字段类型">
          <el-select
            v-model="form.type"
            :disabled="Boolean(editingField?.system)"
            class="w-full"
          >
            <el-option
              v-for="opt in FIELD_TYPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div v-if="editingField?.system" class="text-xs text-[var(--el-text-color-placeholder)] mt-1">
            系统字段不可修改类型
          </div>
        </el-form-item>

        <el-form-item v-if="needOptions" label="选项配置">
          <div class="w-full space-y-2">
            <div v-for="(opt, index) in form.options" :key="index" class="flex gap-2">
              <el-input v-model="opt.label" placeholder="显示名" />
              <el-input v-model="opt.value" placeholder="值" />
              <el-button link type="danger" @click="form.options.splice(index, 1)">删除</el-button>
            </div>
            <el-button link type="primary" @click="addOption">+ 添加选项</el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="isFormula" label="公式表达式">
          <el-input
            v-model="form.config!.formula"
            placeholder="如：cf_amount * cf_discount / 100"
          />
          <div class="text-xs text-[var(--el-text-color-placeholder)] mt-1 leading-5">
            支持 + - * / 与括号，变量为字段 key。
            <template v-if="numericFieldKeys.length">
              可引用：{{ numericFieldKeys.join('、') }}
            </template>
            <template v-if="form.config?.formula">
              <br />引用了：{{ formulaVariables(form.config.formula).join('、') || '（无）' }}
            </template>
          </div>
        </el-form-item>

        <el-form-item v-if="isFormula" label="小数位数">
          <el-input-number v-model="form.config!.precision" :min="0" :max="6" />
        </el-form-item>

        <el-form-item label="占位提示">
          <el-input v-model="form.config!.placeholder" placeholder="输入框占位文案" />
        </el-form-item>

        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="必填">
            <el-switch v-model="form.required" :disabled="form.type === 'formula'" />
          </el-form-item>
          <el-form-item label="唯一值">
            <el-switch
              v-model="form.config!.unique"
              :disabled="!supportsUnique"
            />
          </el-form-item>
          <el-form-item label="隐藏">
            <el-switch v-model="form.hidden" :disabled="Boolean(editingField?.system && editingField.required)" />
          </el-form-item>
          <el-form-item label="列表显示">
            <el-switch v-model="form.showInList" />
          </el-form-item>
          <el-form-item label="表单宽度">
            <el-select v-model="form.span">
              <el-option label="半行 (12/24)" :value="12" />
              <el-option label="整行 (24/24)" :value="24" />
              <el-option label="1/4 行 (6/24)" :value="6" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="列表列宽（px，留空自适应）">
          <el-input-number v-model="form.listWidth" :min="60" :max="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-drawer>
  </el-card>
</template>
