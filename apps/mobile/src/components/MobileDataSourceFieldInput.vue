<script setup lang="ts">
import type { DataSourceOptionVO, DataSourceType, FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import { dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  field: FieldVO
  modelValue?: string | string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | string[] | undefined] }>()

const show = ref(false)
const keyword = ref('')
const options = ref<DataSourceOptionVO[]>([])
const selectedOptions = ref<DataSourceOptionVO[]>([])
const loading = ref(false)
const finished = ref(false)
const page = ref(1)
const pageSize = 30

const multiple = computed(() => props.field.type === 'data_source_multiple')
const sourceType = computed<DataSourceType>(() => props.field.config?.dataSourceType ?? 'CUSTOMER')
const selectedIds = computed(() => {
  if (multiple.value) {
    return Array.isArray(props.modelValue)
      ? props.modelValue.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : []
  }
  return typeof props.modelValue === 'string' && props.modelValue ? [props.modelValue] : []
})
const displayText = computed(() => selectedOptions.value.map((item) => item.name).join('、'))

async function resolveSelected() {
  if (!selectedIds.value.length) {
    selectedOptions.value = []
    return
  }
  try {
    selectedOptions.value = await dataSourceApi.resolve(sourceType.value, selectedIds.value)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function loadMore() {
  if (loading.value || finished.value) return
  loading.value = true
  try {
    const result = await dataSourceApi.page(sourceType.value, {
      current: page.value,
      pageSize,
      keyword: keyword.value.trim() || undefined,
    })
    const existing = new Set(options.value.map((item) => item.id))
    options.value.push(...result.list.filter((item) => !existing.has(item.id)))
    page.value += 1
    finished.value = options.value.length >= result.total || result.list.length < pageSize
  } catch (error) {
    finished.value = true
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function reload() {
  options.value = []
  page.value = 1
  finished.value = false
  void loadMore()
}

function open() {
  show.value = true
  keyword.value = ''
  reload()
}

function select(option: DataSourceOptionVO) {
  if (!multiple.value) {
    selectedOptions.value = [option]
    emit('update:modelValue', option.id)
    show.value = false
    return
  }
  const ids = new Set(selectedIds.value)
  if (ids.has(option.id)) ids.delete(option.id)
  else ids.add(option.id)
  const next = [...ids]
  emit('update:modelValue', next)
  const optionMap = new Map([...selectedOptions.value, ...options.value].map((item) => [item.id, item]))
  selectedOptions.value = next.flatMap((id) => {
    const item = optionMap.get(id)
    return item ? [item] : []
  })
}

function clear() {
  selectedOptions.value = []
  emit('update:modelValue', multiple.value ? [] : undefined)
}

watch(
  () => [sourceType.value, JSON.stringify(selectedIds.value)] as const,
  () => void resolveSelected(),
  { immediate: true },
)
</script>

<template>
  <van-field
    :model-value="displayText"
    :label="field.label"
    :placeholder="`请选择${field.label}`"
    :required="field.required"
    readonly
    is-link
    clearable
    @clear="clear"
    @click="open"
  />

  <van-popup v-model:show="show" position="bottom" round :style="{ height: '72%' }">
    <div class="h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 text-center font-medium">选择{{ field.label }}</div>
      <van-search v-model="keyword" placeholder="搜索" @search="reload" @clear="reload" />
      <div class="flex-1 overflow-auto">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          @load="loadMore"
        >
          <van-cell
            v-for="option in options"
            :key="option.id"
            :title="option.name"
            clickable
            @click="select(option)"
          >
            <template #right-icon>
              <van-checkbox
                v-if="multiple"
                :model-value="selectedIds.includes(option.id)"
                @click.stop="select(option)"
              />
            </template>
          </van-cell>
        </van-list>
      </div>
      <div v-if="multiple" class="p-4 border-t border-[var(--text-n8)]">
        <van-button type="primary" block @click="show = false">
          确定{{ selectedIds.length ? `（${selectedIds.length}）` : '' }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>
