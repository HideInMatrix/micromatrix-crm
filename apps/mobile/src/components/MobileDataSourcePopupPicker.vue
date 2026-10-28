<script setup lang="ts">
import type { DataSourceOptionVO, DataSourceType } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import { dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  label: string
  sourceType: DataSourceType
  selectedIds: string[]
  multiple?: boolean
}>()
const emit = defineEmits<{ select: [ids: string[], option?: DataSourceOptionVO] }>()
const show = defineModel<boolean>('show', { required: true })
const keyword = ref('')
const appliedKeyword = ref('')
const options = ref<DataSourceOptionVO[]>([])
const draftIds = ref<string[]>([])
const loading = ref(false)
const finished = ref(false)
const page = ref(1)
const pageSize = 30
let generation = 0
let requesting = false

const placeholder = computed(() =>
  /学校|院校/.test(props.label) ? '请输入学校名称' : `请输入${props.label}`,
)

async function loadMore() {
  if (!show.value || requesting || finished.value) return
  const requestId = generation
  const requestPage = page.value
  requesting = true
  loading.value = true
  try {
    const result = await dataSourceApi.page(props.sourceType, {
      current: requestPage,
      pageSize,
      keyword: appliedKeyword.value || undefined,
    })
    if (requestId !== generation) return
    const existing = new Set(options.value.map((item) => item.id))
    options.value.push(...result.list.filter((item) => !existing.has(item.id)))
    page.value = requestPage + 1
    finished.value = options.value.length >= result.total || result.list.length < pageSize
  } catch (error) {
    if (requestId !== generation) return
    finished.value = true
    showFailToast(extractErrorMessage(error))
  } finally {
    if (requestId === generation) {
      requesting = false
      loading.value = false
    }
  }
}

function reload() {
  generation++
  requesting = false
  loading.value = false
  finished.value = false
  options.value = []
  page.value = 1
  void loadMore()
}

function search() {
  appliedKeyword.value = keyword.value.trim()
  reload()
}

function isSelected(optionId: string) {
  return draftIds.value.includes(optionId)
}

function select(option: DataSourceOptionVO) {
  if (!props.multiple) {
    draftIds.value = [option.id]
    emit('select', [option.id], option)
    show.value = false
    return
  }
  draftIds.value = isSelected(option.id)
    ? draftIds.value.filter((id) => id !== option.id)
    : [...draftIds.value, option.id]
}

function confirm() {
  emit('select', [...draftIds.value])
  show.value = false
}

watch(show, (opened) => {
  if (!opened) {
    generation++
    return
  }
  draftIds.value = [...props.selectedIds]
  keyword.value = ''
  appliedKeyword.value = ''
  reload()
})
</script>

<template>
  <van-popup
    v-model:show="show"
    position="bottom"
    round
    class="bg-white"
    style="
      height: min(480px, 60dvh);
      max-height: calc(100dvh - 88px);
      overflow: hidden;
      --van-popup-round-radius: 12px;
      --van-popup-background: #ffffff;
    "
  >
    <div class="flex h-full min-h-0 flex-col bg-white">
      <div
        class="relative flex h-[50px] shrink-0 items-center justify-center bg-[#F5F5F5] px-[12px]"
      >
        <span
          class="max-w-[calc(100%-96px)] truncate text-[16px] leading-[22px] font-semibold text-[#000000]"
        >
          {{ label }}
        </span>
        <van-button
          type="default"
          class="!absolute right-[12px] !border-0 !bg-transparent !p-0 !text-[14px] !text-[#777777]"
          @click="show = false"
          >取消</van-button
        >
      </div>

      <!-- 蓝湖节点：搜索框 x=12/309×34，搜索按钮 x=331/32×16，右侧留白 12px。 -->
      <div class="flex shrink-0 items-center gap-[10px] bg-white px-[12px] pt-[12px] pb-[6px]">
        <van-search
          v-model="keyword"
          shape="square"
          :placeholder="placeholder"
          class="min-w-0 flex-1"
          style="
            --van-search-padding: 0;
            --van-search-background: #ffffff;
            --van-search-content-background: #f3f4f8;
            --van-search-input-height: 34px;
            --van-search-left-icon-color: #999999;
            --van-radius-sm: 6px;
            --van-field-placeholder-text-color: #c6cbd4;
          "
          @search="search"
          @clear="search"
        />
        <van-button
          type="default"
          size="small"
          class="shrink-0"
          style="
            --van-button-border-width: 0px;
            --van-button-small-height: 34px;
            --van-button-small-padding: 0;
            --van-button-small-font-size: 16px;
            --van-button-default-background: transparent;
            --van-button-default-color: var(--van-primary-color);
          "
          @click="search"
          >搜索</van-button
        >
      </div>

      <div
        class="min-h-0 flex-1 overflow-y-auto bg-white"
        style="
          --van-cell-horizontal-padding: 10px;
          --van-cell-vertical-padding: 0px;
          --van-cell-line-height: 40px;
          --van-cell-font-size: 14px;
          --van-cell-text-color: #333333;
          --van-cell-background: #ffffff;
        "
      >
        <van-list v-model:loading="loading" :finished="finished" @load="loadMore">
          <van-cell
            v-for="option in options"
            :key="option.id"
            clickable
            :border="false"
            center
            @click="select(option)"
          >
            <template #title>
              <span
                class="block truncate text-[14px] leading-[40px]"
                :class="
                  isSelected(option.id)
                    ? 'font-medium text-[var(--van-primary-color)]'
                    : 'text-[#333333]'
                "
              >
                {{ option.name }}
              </span>
            </template>
            <template v-if="isSelected(option.id)" #right-icon>
              <van-icon name="success" :size="20" color="var(--van-primary-color)" />
            </template>
          </van-cell>
          <van-empty
            v-if="finished && !options.length"
            image-size="72"
            description="暂无可选数据"
            class="!py-[50px]"
          />
        </van-list>
      </div>

      <div
        v-if="multiple"
        class="shrink-0 border-t border-[#F0F0F0] bg-white px-[12px] pt-[8px]"
        style="--van-button-default-height: 44px; --van-button-border-radius: 8px"
      >
        <van-button type="primary" block @click="confirm">
          确定{{ draftIds.length ? `（${draftIds.length}）` : '' }}
        </van-button>
      </div>
      <div class="shrink-0 bg-white pb-[env(safe-area-inset-bottom)]" />
    </div>
  </van-popup>
</template>
