<script setup lang="ts">
import type {
  FieldVO,
  ModuleQuickSearchConfig,
  QuickSearchItem,
  QuickSearchPresetOption,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { metadataApi } from '@/api/metadata'
import { extractErrorMessage } from '@/api/http'
import FilterConditionEditor from '@/components/form-engine/FilterConditionEditor.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ module: 'lead' | 'customer' }>()
const fieldRefs = useFieldRefs()
const loading = ref(false)
const saving = ref(false)
const fields = ref<FieldVO[]>([])
function defaultConfig(): ModuleQuickSearchConfig {
  return { enabled: false, showAdvancedFilter: true, showSavedViews: true, items: [] }
}
const config = ref<ModuleQuickSearchConfig>(defaultConfig())
const conditionFields = computed(() =>
  fields.value.filter((field) => !field.hidden && field.type !== 'formula' && field.type !== 'sub_product'),
)
const supported = computed(() =>
  fields.value.filter((field) =>
    !field.hidden && [
      'text', 'textarea', 'phone', 'email', 'number', 'currency', 'percent',
      'date', 'datetime', 'select', 'radio',
    ].includes(field.type),
  ),
)

function operators(item: QuickSearchItem) {
  const type = fields.value.find((field) => field.key === item.fieldKey)?.type
  if (type === 'date' || type === 'datetime') {
    return [{ value: 'gte', label: '不早于' }, { value: 'lte', label: '不晚于' }]
  }
  if (['text', 'textarea', 'phone', 'email'].includes(type ?? '')) {
    return [{ value: 'contains', label: '包含' }, { value: 'eq', label: '等于' }]
  }
  return [{ value: 'eq', label: '等于' }]
}

function changedField(item: QuickSearchItem) {
  item.operator = operators(item)[0]?.value as QuickSearchItem['operator']
}

async function load() {
  loading.value = true
  try {
    const [{ data }] = await Promise.all([
      metadataApi.formConfig(props.module),
      fieldRefs.load(),
    ])
    fields.value = data.fields
    config.value = data.formProp.quickSearch
      ? JSON.parse(JSON.stringify(data.formProp.quickSearch)) as ModuleQuickSearchConfig
      : defaultConfig()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function add(kind: 'field' | 'preset_select') {
  if (config.value.items.length >= 12) return
  const first = supported.value.find((field) => field.key === 'name') ?? supported.value[0]
  if (kind === 'field' && !first) return
  if (kind === 'preset_select') {
    config.value.items.push({
      id: crypto.randomUUID(), kind, label: '快捷筛选', placeholder: '全部', options: [],
    })
  } else {
    const item: QuickSearchItem = {
      id: crypto.randomUUID(), kind, label: first!.label, fieldKey: first!.key,
    }
    changedField(item)
    config.value.items.push(item)
  }
}

function addOption(item: QuickSearchItem) {
  if (!item.options) item.options = []
  if (item.options.length >= 30) return
  item.options.push({
    id: crypto.randomUUID(), label: '', searchMode: 'AND', conditions: [],
  })
}

function removeOption(item: QuickSearchItem, option: QuickSearchPresetOption) {
  item.options = (item.options ?? []).filter((value) => value.id !== option.id)
}

function move(index: number, offset: number) {
  const next = index + offset
  if (next < 0 || next >= config.value.items.length) return
  const items = config.value.items
  ;[items[index], items[next]] = [items[next]!, items[index]!]
}

async function save() {
  for (const item of config.value.items) {
    if (item.kind !== 'preset_select') continue
    if (!item.options?.length) {
      ElMessage.warning(`请为「${item.label}」配置至少一个下拉选项`)
      return
    }
    if (item.options.some((option) => !option.label.trim() || option.conditions.length === 0 ||
      option.conditions.some((condition) => !['isEmpty', 'notEmpty'].includes(condition.op) &&
        (condition.value === undefined || condition.value === null || condition.value === '')))) {
      ElMessage.warning(`请补全「${item.label}」选项的名称及搜索条件`)
      return
    }
  }
  saving.value = true
  try {
    await metadataApi.updateFormProp(props.module, { quickSearch: config.value })
    ElMessage.success('搜索设置已保存')
    visible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, (open) => { if (open) void load() })
watch(() => props.module, () => { if (visible.value) void load() })
</script>

<template>
  <el-drawer v-model="visible" :title="module === 'lead' ? '线索搜索设置' : '客户搜索设置'" size="920px" destroy-on-close>
    <div v-loading="loading">
      <el-form label-width="150px">
        <el-form-item label="快捷搜索"><el-switch v-model="config.enabled" /></el-form-item>
        <el-form-item label="高级筛选"><el-switch v-model="config.showAdvancedFilter" /></el-form-item>
        <el-form-item label="显示视图"><el-switch v-model="config.showSavedViews" /></el-form-item>
      </el-form>
      <div class="mb-3 flex items-center justify-between">
        <span class="font-medium">快捷搜索控件（最多 12 个）</span>
        <div class="flex gap-2">
          <el-button @click="add('field')">添加文字搜索</el-button>
          <el-button type="primary" @click="add('preset_select')">添加下拉框搜索</el-button>
        </div>
      </div>

      <div v-for="(item, index) in config.items" :key="item.id" class="mb-3 rounded border p-4">
        <div class="mb-3 flex items-center justify-between">
          <span class="font-medium">
            {{ item.kind === 'preset_select' ? '下拉框搜索' : '文字搜索' }}
          </span>
          <div>
            <el-button link :disabled="index === 0" @click="move(index, -1)">上移</el-button>
            <el-button link :disabled="index === config.items.length - 1" @click="move(index, 1)">下移</el-button>
            <el-button link type="danger" @click="config.items.splice(index, 1)">删除</el-button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <el-input v-model="item.label" placeholder="搜索项显示名称" maxlength="40" />
          <el-input v-model="item.placeholder" placeholder="输入/选择提示" maxlength="100" />
          <template v-if="item.kind === 'field'">
            <el-select v-model="item.fieldKey" filterable placeholder="关联字段" @change="changedField(item)">
              <el-option v-for="field in supported" :key="field.key" :label="field.label" :value="field.key" />
            </el-select>
            <el-select v-model="item.operator" placeholder="匹配方式">
              <el-option v-for="operator in operators(item)" :key="operator.value" :value="operator.value" :label="operator.label" />
            </el-select>
          </template>
        </div>

        <div v-if="item.kind === 'preset_select'" class="mt-4 border-t pt-3">
          <div class="mb-3 flex items-center justify-between">
            <span class="text-sm text-[var(--el-text-color-secondary)]">
              每个选项可以预设多条 AND/OR 条件；不选时为全部数据
            </span>
            <el-button type="primary" plain @click="addOption(item)">新增选项</el-button>
          </div>
          <el-collapse>
            <el-collapse-item v-for="option in (item.options ?? [])" :key="option.id" :name="option.id">
              <template #title>
                <span class="mr-2">{{ option.label || '未命名选项' }}</span>
                <span class="text-xs text-[var(--el-text-color-secondary)]">
                  {{ option.searchMode === 'AND' ? '全部满足' : '任一满足' }} · {{ option.conditions.length }} 条条件
                </span>
              </template>
              <div class="mb-3 flex items-center gap-2">
                <el-input v-model="option.label" placeholder="下拉选项名称，如：小学" class="!w-64" maxlength="40" />
                <el-button type="danger" link @click="removeOption(item, option)">删除选项</el-button>
              </div>
              <FilterConditionEditor
                v-model="option.conditions"
                v-model:search-mode="option.searchMode"
                :fields="conditionFields"
                :members="fieldRefs.members.value"
                :dept-tree="fieldRefs.deptTree.value"
                :show-search-mode="true"
                :teleported="true"
              />
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>
