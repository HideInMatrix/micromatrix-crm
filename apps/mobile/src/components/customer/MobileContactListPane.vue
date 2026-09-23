<script setup lang="ts">
import type { ContactVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { contactApi } from '@/api/sales'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import MobileViewBar from '@/components/MobileViewBar.vue'
import { useAuthStore } from '@/stores/auth'
import type { MobileViewSelection } from '@/types/mobile-view'

const auth = useAuthStore()
const router = useRouter()

const keyword = ref('')
const items = ref<ContactVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
type ContactSystemView = 'ALL' | 'SELF' | 'DEPT'
const activeView = ref<ContactSystemView>('SELF')
const activeSavedViewId = ref('')
const systemViews = ref<{ id: ContactSystemView; label: string }[]>([])
const systemViewsReady = ref(false)
const savedViewsReady = ref(false)
const viewsReady = computed(() => systemViewsReady.value && savedViewsReady.value)

async function loadMore() {
  if (!viewsReady.value) return
  loading.value = true
  try {
    const { data } = await contactApi.page({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
      scopeView: activeView.value,
      viewId: activeSavedViewId.value || undefined,
    })
    items.value.push(...data.items)
    finished.value = items.value.length >= data.total
    page.value += 1
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    finished.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  items.value = []
  finished.value = false
  loadMore()
}

async function handleRefresh() {
  page.value = 1
  items.value = []
  finished.value = false
  try {
    await loadMore()
  } finally {
    refreshing.value = false
  }
}

async function loadSystemViews() {
  try {
    const { data } = await contactApi.tab()
    systemViews.value = [
      { id: 'SELF', label: '我的联系人' },
      ...(data.dept ? [{ id: 'DEPT' as const, label: '部门联系人' }] : []),
      ...(data.all ? [{ id: 'ALL' as const, label: '全部联系人' }] : []),
    ]
    if (!systemViews.value.some((item) => item.id === activeView.value)) {
      activeView.value = 'SELF'
    }
  } catch (error) {
    systemViews.value = [{ id: 'SELF', label: '我的联系人' }]
    activeView.value = 'SELF'
    showFailToast(extractErrorMessage(error))
  } finally {
    systemViewsReady.value = true
  }
}

function applyViewSelection(selection: MobileViewSelection) {
  if (selection.type === 'saved') {
    activeSavedViewId.value = selection.id
    return
  }
  if (selection.type === 'system') {
    activeSavedViewId.value = ''
    activeView.value = selection.id as ContactSystemView
  }
}

function handleViewReady(selection: MobileViewSelection) {
  applyViewSelection(selection)
  savedViewsReady.value = true
}

function handleViewChange(selection: MobileViewSelection) {
  applyViewSelection(selection)
  reload()
}

async function copyPhone(phone: string) {
  try {
    await navigator.clipboard.writeText(phone)
    showSuccessFeedback('手机号已复制')
  } catch {
    showFailToast('当前环境不支持复制')
  }
}

async function removeContact(item: ContactVO) {
  const confirmed = await showActionConfirm({
    title: '删除联系人',
    message: `确认删除「${item.name}」？`,
    confirmButtonText: '删除',
  })
  if (!confirmed) return
  try {
    await contactApi.remove(item.id)
    showSuccessFeedback('联系人已删除')
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function openCreate() {
  router.push('/contacts/create')
}

function openEdit(item: ContactVO) {
  router.push('/contacts/' + item.id + '/edit')
}

function openDetail(item: ContactVO) {
  router.push({
    path: '/contacts/detail',
    query: { id: item.id, name: item.name },
  })
}

defineExpose({ reload })

onMounted(() => {
  void loadSystemViews()
})
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div
      class="flex items-center gap-3 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 py-2"
    >
      <van-button
        v-if="auth.hasPerm('contact:create')"
        plain
        icon="plus"
        type="primary"
        size="small"
        @click="openCreate"
      />
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入联系人名称或手机号"
        class="min-w-0 flex-1 !p-0"
        @search="reload"
        @clear="reload"
      />
    </div>
    <MobileViewBar
      v-if="systemViewsReady"
      module="contact"
      :system-views="systemViews"
      :system-view="activeView"
      @ready="handleViewReady"
      @change="handleViewChange"
    />

    <div class="min-h-0 flex-1 overflow-auto">
      <van-pull-refresh
        v-if="viewsReady"
        v-model="refreshing"
        class="min-h-full"
        @refresh="handleRefresh"
      >
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="已经到底部啦~"
          class="flex flex-col gap-4 p-4"
          @load="loadMore"
        >
          <div
            v-for="item in items"
            :key="item.id"
            class="flex w-full items-center gap-4 overflow-hidden rounded-[6px] bg-white p-4 active:opacity-70"
            @click="openDetail(item)"
          >
            <div class="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[var(--text-n9)] text-xl text-[var(--text-n2)]">
              {{ item.name?.slice(0, 1) || '?' }}
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="truncate text-base text-[var(--text-n1)]">{{ item.name }}</div>
                  <van-tag
                    v-if="item.enable !== false"
                    color="var(--success-5)"
                    text-color="var(--success-green)"
                    class="rounded-[6px] !px-2 !py-0.5"
                  >正常</van-tag>
                  <van-tag v-else type="warning" plain>已停用</van-tag>
                </div>
                <div class="flex items-center gap-1">
                  <van-button
                    v-if="auth.hasPerm('contact:update')"
                    icon="edit"
                    size="small"
                    type="primary"
                    plain
                    class="!border-0 !px-1"
                    @click.stop="openEdit(item)"
                  />
                  <van-button
                    v-if="auth.hasPerm('contact:delete')"
                    icon="delete-o"
                    size="small"
                    type="danger"
                    plain
                    class="!border-0 !px-1"
                    @click.stop="removeContact(item)"
                  />
                </div>
              </div>
              <div class="flex items-center gap-1 text-xs text-[var(--primary-8)]">
                <a v-if="item.phone" :href="'tel:' + item.phone" class="flex items-center gap-1" @click.stop>
                  <van-icon name="phone-o" size="15" />
                  <span>{{ item.phone }}</span>
                </a>
                <van-icon v-if="item.phone" name="description-o" size="14" @click.stop="copyPhone(item.phone)" />
              </div>
            </div>
          </div>
        </van-list>
      </van-pull-refresh>
      <van-loading v-else class="!flex !justify-center !py-10" />
    </div>
  </div>
</template>
