<script setup lang="ts">
import type { FieldVO, HomeAnalyticsConfig, HomeAnalyticsWidgetConfig, HomeWidgetModule } from '@micromatrix/shared'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'

const props = defineProps<{ module: HomeWidgetModule }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()
const loading = ref(false)
const saving = ref(false)
const formFields = ref<Record<HomeWidgetModule, FieldVO[]>>({ lead: [], customer: [] })
const persistedWidgets = ref<HomeAnalyticsWidgetConfig[]>([])
const moduleLabel = computed(() => props.module === 'lead' ? '线索' : '客户')
const otherWidgetCount = computed(() => persistedWidgets.value.filter((item) => item.module !== props.module).length)
const canAdd = computed(() => widgets.value.length + otherWidgetCount.value < 12)
const widgets = ref<HomeAnalyticsWidgetConfig[]>([])
const supportedTypes = new Set(['text', 'select', 'radio'])
const fieldOptions = computed(() => ({
  lead: formFields.value.lead.filter((field) => !field.system && !field.hidden && supportedTypes.has(field.type)),
  customer: formFields.value.customer.filter((field) => !field.system && !field.hidden && supportedTypes.has(field.type)),
}))
const chartOptions = [
  { label: '南丁格尔玫瑰图', value: 'donut' },
  { label: '柱状图', value: 'bar' },
  { label: '排行列表', value: 'list' },
]

// 兼容已存在的线索来源默认统计：客户模块的配置不能把它意外覆盖。
function effectiveWidgets(config: HomeAnalyticsConfig, leadFields: FieldVO[]): HomeAnalyticsWidgetConfig[] {
  if (config.widgets !== undefined) return config.widgets.map((item) => ({ ...item }))
  const field = leadFields.find((item) =>
    item.key === config.leadSourceFieldKey &&
    !item.system && !item.hidden && supportedTypes.has(item.type),
  ) ?? leadFields.find((item) =>
    item.key === 'cf_source' && !item.system && !item.hidden && supportedTypes.has(item.type),
  )
  return field ? [{
    id: 'default-lead-source',
    title: '渠道来源分析',
    module: 'lead',
    fieldKey: field.key,
    chartType: 'donut',
  }] : []
}

async function load() {
  loading.value = true
  try {
    const [{ data: lead }, { data: customer }] = await Promise.all([
      metadataApi.formConfig('lead'),
      metadataApi.formConfig('customer'),
    ])
    formFields.value = { lead: lead.fields, customer: customer.fields }
    persistedWidgets.value = effectiveWidgets(lead.formProp.homeAnalytics ?? {}, lead.fields)
    widgets.value = persistedWidgets.value
      .filter((item) => item.module === props.module)
      .map((item) => ({ ...item }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function add() {
  if (!canAdd.value) return
  const field = fieldOptions.value[props.module][0]
  if (!field) {
    ElMessage.warning(`请先在${moduleLabel.value}表单中创建单选、单选框或文本字段`)
    return
  }
  widgets.value.push({
    id: `widget-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: field.label + '分析',
    module: props.module,
    fieldKey: field.key,
    chartType: 'donut',
  })
}

function move(index: number, direction: -1 | 1) {
  const to = index + direction
  if (to < 0 || to >= widgets.value.length) return
  const list = [...widgets.value]
  const current = list[index]!
  list[index] = list[to]!
  list[to] = current
  widgets.value = list
}

async function save() {
  for (const item of widgets.value) {
    if (!item.title.trim() || item.title.length > 60) {
      ElMessage.warning('统计组件名称不能为空且最长 60 字')
      return
    }
    if (!fieldOptions.value[item.module].some((field) => field.key === item.fieldKey)) {
      ElMessage.warning(`「${item.title}」对应字段不存在或不支持分组统计`)
      return
    }
  }
  saving.value = true
  try {
    // 每次保存前重新读取配置，避免两个模块之间相互覆盖。
    const { data: lead } = await metadataApi.formConfig('lead')
    const config = lead.formProp.homeAnalytics ?? {}
    const previous = effectiveWidgets(config, lead.fields)
    const firstIndex = previous.findIndex((item) => item.module === props.module)
    const insertionIndex = firstIndex < 0
      ? previous.filter((item) => item.module !== props.module).length
      : previous.slice(0, firstIndex).filter((item) => item.module !== props.module).length
    const combined = previous.filter((item) => item.module !== props.module)
    combined.splice(insertionIndex, 0, ...widgets.value.map(({ period: _legacyPeriod, ...item }) => ({
      ...item, module: props.module, title: item.title.trim(),
    })))
    // 保存时移除其它模块的旧版时间配置；时间范围只在首页选择。
    const normalized = combined.map(({ period: _legacyPeriod, ...item }) => item)
    if (normalized.length > 12) {
      ElMessage.warning('首页统计组件总数最多 12 个，请先在对应模块中减少组件')
      return
    }
    await metadataApi.updateFormProp('lead', {
      homeAnalytics: { ...config, widgets: normalized },
    })
    persistedWidgets.value = normalized
    ElMessage.success(`${moduleLabel.value}首页统计组件已保存`)
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, (open) => {
  if (open) void load()
})
</script>

<template>
  <el-drawer v-model="visible" :title="`${moduleLabel}首页统计组件设置`" size="760px" destroy-on-close>
    <div v-loading="loading" class="space-y-4">
      <el-alert type="info" :closable="false" :title="`只配置${moduleLabel}表单中的动态字段；统计组件在首页展示，并遵循当前用户的数据权限。`" />
      <div v-for="(item, index) in widgets" :key="item.id" class="rounded-lg border border-[var(--el-border-color-lighter)] p-4" :data-testid="`home-widget-setting-${index}`">
        <div class="mb-3 flex items-center justify-between">
          <span class="font-medium">统计组件 {{ index + 1 }}</span>
          <div class="flex items-center gap-1">
            <el-button link :disabled="index === 0" aria-label="上移统计组件" @click="move(index, -1)"><ArrowUp :size="16" /></el-button>
            <el-button link :disabled="index === widgets.length - 1" aria-label="下移统计组件" @click="move(index, 1)"><ArrowDown :size="16" /></el-button>
            <el-button link type="danger" aria-label="删除统计组件" @click="widgets.splice(index, 1)"><Trash2 :size="16" /></el-button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div class="space-y-1">
            <div class="text-sm text-[var(--el-text-color-regular)]">统计名称</div>
            <el-input v-model="item.title" maxlength="60" placeholder="请输入统计名称" />
          </div>
          <div class="space-y-1">
            <div class="text-sm text-[var(--el-text-color-regular)]">业务模块</div>
            <el-input :model-value="moduleLabel" disabled />
          </div>
          <div class="space-y-1">
            <div class="text-sm text-[var(--el-text-color-regular)]">分组字段</div>
            <el-select v-model="item.fieldKey" class="w-full" filterable placeholder="选择动态表单字段">
              <el-option v-for="field in fieldOptions[item.module]" :key="field.key" :value="field.key" :label="field.label" />
            </el-select>
          </div>
          <div class="col-span-2 space-y-1">
            <div class="text-sm text-[var(--el-text-color-regular)]">图表类型</div>
            <el-radio-group v-model="item.chartType">
              <el-radio-button v-for="chart in chartOptions" :key="chart.value" :label="chart.value" :value="chart.value">{{ chart.label }}</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </div>
      <el-empty v-if="!loading && widgets.length === 0" :description="`暂无${moduleLabel}统计组件，可以在此处添加`" :image-size="68" />
      <el-button type="primary" plain :disabled="!canAdd" data-testid="home-widget-add" @click="add">
        <Plus :size="16" class="mr-1" />添加统计组件
      </el-button>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" data-testid="home-widget-save" @click="save">保存配置</el-button>
    </template>
  </el-drawer>
</template>
