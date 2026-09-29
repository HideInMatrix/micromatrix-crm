<script setup lang="ts">
import type { FieldVO, HomeAnalyticsConfig } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ section: 'lead' | 'customer' }>()

const loading = ref(false)
const saving = ref(false)
const leadFields = ref<FieldVO[]>([])
const customerFields = ref<FieldVO[]>([])
const leadPersisted = ref<HomeAnalyticsConfig>({})
const customerPersisted = ref<HomeAnalyticsConfig>({})
const config = reactive<HomeAnalyticsConfig>({})

const title = computed(() => props.section === 'lead' ? '首页渠道统计设置' : '首页结果统计设置')
const leadSourceFields = computed(() =>
  leadFields.value.filter((field) => !field.system && ['text', 'select', 'radio'].includes(field.type)),
)
const customerResultFields = computed(() =>
  customerFields.value.filter(
    (field) => !field.system && ['text', 'number', 'currency', 'percent', 'date', 'datetime', 'select', 'radio', 'switch', 'phone', 'email', 'data_source'].includes(field.type),
  ),
)
const customerTimeFields = computed(() =>
  customerFields.value.filter((field) => !field.system && ['date', 'datetime'].includes(field.type)),
)
const customerAmountFields = computed(() =>
  customerFields.value.filter((field) => !field.system && ['number', 'currency'].includes(field.type)),
)
const selectedResultField = computed(() =>
  customerResultFields.value.find((field) => field.key === config.customerResultFieldKey) ?? null,
)

function apply(value: HomeAnalyticsConfig | undefined) {
  Object.assign(config, {
    leadSourceFieldKey: value?.leadSourceFieldKey ?? '',
    customerResultFieldKey: value?.customerResultFieldKey ?? '',
    customerResultValues: [...(value?.customerResultValues ?? [])],
    customerResultTimeFieldKey: value?.customerResultTimeFieldKey ?? '',
    customerResultAmountFieldKey: value?.customerResultAmountFieldKey ?? '',
  })
}

async function load() {
  loading.value = true
  try {
    const [{ data: lead }, { data: customer }] = await Promise.all([
      metadataApi.formConfig('lead'),
      metadataApi.formConfig('customer'),
    ])
    leadFields.value = lead.fields
    customerFields.value = customer.fields
    leadPersisted.value = { ...(lead.formProp.homeAnalytics ?? {}) }
    customerPersisted.value = { ...(customer.formProp.homeAnalytics ?? {}) }
    if (props.section === 'lead') {
      apply(leadPersisted.value)
    } else {
      apply(customer.formProp.homeAnalytics ?? lead.formProp.homeAnalytics)
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function handleResultFieldChange() {
  config.customerResultValues = []
  if (!config.customerResultFieldKey) {
    config.customerResultTimeFieldKey = ''
    config.customerResultAmountFieldKey = ''
  }
}

async function save() {
  let module: 'lead' | 'customer'
  let next: HomeAnalyticsConfig
  if (props.section === 'lead') {
    module = 'lead'
    // 保留历史版本误存于 Lead 的 Customer 配置，避免用户只改 Lead 设置时丢失旧统计。
    next = { ...leadPersisted.value }
    if (config.leadSourceFieldKey) next.leadSourceFieldKey = config.leadSourceFieldKey
    else delete next.leadSourceFieldKey
  } else {
    module = 'customer'
    next = {}
    if (config.customerResultFieldKey) {
      next.customerResultFieldKey = config.customerResultFieldKey
      next.customerResultValues = [...(config.customerResultValues ?? [])]
      if (config.customerResultTimeFieldKey) next.customerResultTimeFieldKey = config.customerResultTimeFieldKey
      else delete next.customerResultTimeFieldKey
      if (config.customerResultAmountFieldKey) next.customerResultAmountFieldKey = config.customerResultAmountFieldKey
      else delete next.customerResultAmountFieldKey
    } else {
      delete next.customerResultFieldKey
      delete next.customerResultValues
      delete next.customerResultTimeFieldKey
      delete next.customerResultAmountFieldKey
    }
  }

  saving.value = true
  try {
    await metadataApi.updateFormProp(module, { homeAnalytics: next })
    ElMessage.success(`${title.value}已保存`)
    visible.value = false
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
  <el-drawer v-model="visible" :title="title" size="640px" destroy-on-close>
    <div v-loading="loading" class="space-y-6">
      <template v-if="section === 'lead'">
        <el-alert type="info" :closable="false" title="只引用线索模块已有动态字段，不固定任何招生渠道名称。" />
        <section>
          <div class="mb-2 text-sm font-medium">渠道统计字段</div>
          <el-select v-model="config.leadSourceFieldKey" clearable filterable class="w-full" placeholder="请选择线索动态字段">
            <el-option v-for="field in leadSourceFields" :key="field.id" :label="field.label" :value="field.key" />
          </el-select>
        </section>
      </template>

      <template v-else>
        <el-alert type="info" :closable="false" title="只引用客户模块已有动态字段，不固定“缴费”“报名”等业务语义。" />
        <section>
          <div class="mb-2 text-sm font-medium">结果字段</div>
          <el-select v-model="config.customerResultFieldKey" clearable filterable class="w-full" placeholder="请选择客户动态字段" @change="handleResultFieldChange">
            <el-option v-for="field in customerResultFields" :key="field.id" :label="field.label" :value="field.key" />
          </el-select>
        </section>
        <section>
          <div class="mb-2 text-sm font-medium">结果命中值</div>
          <el-select v-model="config.customerResultValues" multiple clearable filterable class="w-full" :disabled="!config.customerResultFieldKey || !(selectedResultField?.options?.length)" placeholder="留空表示字段非空即计入结果">
            <el-option v-for="item in selectedResultField?.options ?? []" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </section>
        <section>
          <div class="mb-2 text-sm font-medium">结果时间字段</div>
          <el-select v-model="config.customerResultTimeFieldKey" clearable filterable class="w-full" :disabled="!config.customerResultFieldKey" placeholder="可选，用于结果趋势">
            <el-option v-for="field in customerTimeFields" :key="field.id" :label="field.label" :value="field.key" />
          </el-select>
        </section>
        <section>
          <div class="mb-2 text-sm font-medium">结果金额字段</div>
          <el-select v-model="config.customerResultAmountFieldKey" clearable filterable class="w-full" :disabled="!config.customerResultFieldKey" placeholder="可选，用于金额汇总">
            <el-option v-for="field in customerAmountFields" :key="field.id" :label="field.label" :value="field.key" />
          </el-select>
        </section>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>
