<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  type GlobalSearchGroupKey,
  type GlobalSearchItem,
  useGlobalSearch,
} from '@/composables/useGlobalSearch'

const route = useRoute()
const router = useRouter()
const globalSearch = useGlobalSearch()
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
const activeNames = globalSearch.activeNames
let timer: ReturnType<typeof setTimeout> | undefined

async function syncKeywordQuery(value: string) {
  const nextKeyword = value.trim()
  const currentKeyword = typeof route.query.keyword === 'string' ? route.query.keyword : ''
  if (currentKeyword === nextKeyword) return

  const nextQuery = { ...route.query }
  if (nextKeyword) nextQuery.keyword = nextKeyword
  else delete nextQuery.keyword
  await router.replace({ name: 'mobile-global-search', query: nextQuery })
}

function scheduleSearch(value: string) {
  if (timer) clearTimeout(timer)
  void syncKeywordQuery(value)
  if (!value.trim()) {
    globalSearch.clear()
    return
  }
  timer = setTimeout(() => {
    void globalSearch.search(value)
  }, 500)
}

async function openResult(group: GlobalSearchGroupKey, item: GlobalSearchItem) {
  await syncKeywordQuery(keyword.value)

  if (group === 'lead') {
    router.push({
      path: '/leads/detail',
      query: { id: item.id, name: item.name },
    })
    return
  }
  if (group === 'leadPool') {
    router.push({
      path: '/leads/pool-detail',
      query: { id: item.id, name: item.name },
    })
    return
  }
  if (group === 'customer') {
    router.push({
      path: '/customers/detail',
      query: { id: item.id, name: item.name },
    })
    return
  }
  if (group === 'customerPool') {
    router.push({
      path: '/customers/detail',
      query: { id: item.id, name: item.name, source: 'openSea' },
    })
    return
  }
  if (group === 'contact') {
    router.push({
      path: '/contacts/detail',
      query: { id: item.id, name: item.name },
    })
  }
}

watch(keyword, scheduleSearch, { immediate: true })
watch(
  () => route.query.keyword,
  (value) => {
    const nextKeyword = typeof value === 'string' ? value : ''
    if (nextKeyword !== keyword.value) keyword.value = nextKeyword
  },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n10)]">
    <div class="shrink-0 px-4 py-3">
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入搜索内容"
        autofocus
        class="!p-0"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-4 pb-4">
      <van-loading
        v-if="globalSearch.loading.value"
        class="!flex !justify-center !py-8"
      />

      <van-empty
        v-else-if="keyword.trim() && globalSearch.visibleGroups.value.every((group) => group.count === 0)"
        image-size="64"
        description="无搜索结果"
        class="!py-16"
      />

      <van-collapse
        v-else-if="keyword.trim()"
        v-model="activeNames"
        :border="false"
      >
        <van-collapse-item
          v-for="group in globalSearch.visibleGroups.value"
          :key="group.key"
          :name="group.key"
          :border="false"
        >
          <template #title>
            <div class="text-base font-semibold text-[var(--text-n1)]">
              {{ group.label }}相关
              <span class="text-[var(--text-n4)]">({{ group.count }})</span>
            </div>
          </template>

          <van-empty
            v-if="group.items.length === 0"
            image-size="48"
            description="暂无结果"
            class="!py-6"
          />
          <div v-else class="flex flex-col gap-3">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="rounded-[6px] bg-[var(--text-n9)] px-4 py-3 active:opacity-70"
              @click="openResult(group.key, item)"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-n1)]">
                  {{ item.name }}
                </div>
                <van-icon name="arrow" class="shrink-0 text-[var(--text-n5)]" />
              </div>
              <div
                v-if="item.description"
                class="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-n4)]"
              >
                {{ item.description }}
              </div>
            </div>
          </div>
        </van-collapse-item>
      </van-collapse>
    </div>
  </div>
</template>

