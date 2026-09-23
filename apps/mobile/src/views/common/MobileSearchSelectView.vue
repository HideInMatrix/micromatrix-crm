<script setup lang="ts">
import { onMounted } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useMobileSearchSelect } from '@/composables/useMobileSearchSelect'
import type { MobileSearchSelectOption } from '@/utils/search-select'

const router = useRouter()
const select = useMobileSearchSelect()

function choose(item: MobileSearchSelectOption) {
  if (select.select(item)) {
    select.confirm()
    router.back()
  }
}

function confirm() {
  select.confirm()
  router.back()
}

onMounted(() => {
  if (!select.store.context) router.back()
})

onBeforeRouteLeave(() => {
  if (select.store.context) select.cancel()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n10)]">
    <div class="shrink-0 px-4 py-3">
      <van-search
        v-model="select.keyword.value"
        shape="round"
        :placeholder="select.placeholder.value"
        class="!p-0"
        @search="select.search"
        @clear="select.search"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <van-list
        v-model:loading="select.loading.value"
        :finished="select.finished.value"
        finished-text="已经到底部啦~"
        @load="select.loadMore"
      >
        <van-empty
          v-if="select.finished.value && select.items.value.length === 0"
          image-size="64"
          description="暂无可选数据"
          class="!py-10"
        />

        <van-cell
          v-for="item in select.items.value"
          :key="item.id"
          clickable
          center
          class="!px-4 !py-3"
          @click="choose(item)"
        >
          <template #title>
            <div class="flex min-w-0 items-center justify-between gap-3">
              <span class="truncate text-base text-[var(--text-n1)]">{{ item.name }}</span>
              <van-checkbox
                v-if="select.multiple.value"
                :model-value="select.selectedIds.value.includes(item.id)"
                @click.stop="choose(item)"
              />
              <van-icon
                v-else-if="select.selectedIds.value.includes(item.id)"
                name="success"
                size="18"
                color="var(--primary-8)"
              />
            </div>
          </template>
          <template v-if="item.description" #label>
            <div class="mt-1 truncate text-xs text-[var(--text-n4)]">
              {{ item.description }}
            </div>
          </template>
        </van-cell>
      </van-list>
    </div>

    <div
      v-if="select.multiple.value"
      class="shrink-0 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
    >
      <van-button type="primary" block @click="confirm">
        确定<span v-if="select.selectedIds.value.length">（{{ select.selectedIds.value.length }}）</span>
      </van-button>
    </div>
  </div>
</template>

