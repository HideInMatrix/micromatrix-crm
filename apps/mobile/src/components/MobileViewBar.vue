<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { userViewApi, type UserViewVO } from '@/api/user-views'
import { useAuthStore } from '@/stores/auth'
import type { MobileViewSelection } from '@/types/mobile-view'

const props = withDefaults(
  defineProps<{
    module: string
    systemViews?: Array<{ id: string; label: string }>
    systemView?: string
    defaultLabel?: string
  }>(),
  {
    systemViews: () => [],
    systemView: '',
    defaultLabel: '默认视图',
  },
)

const emit = defineEmits<{
  change: [selection: MobileViewSelection]
  ready: [selection: MobileViewSelection]
}>()

const auth = useAuthStore()
const views = ref<UserViewVO[]>([])
const selectedKey = ref('')

function storageKey() {
  return `micromatrix:active:${auth.user?.id ?? 'anonymous'}:${props.module}`
}

function setStoredView(id?: string) {
  if (id) localStorage.setItem(storageKey(), id)
  else localStorage.removeItem(storageKey())
}

function initialSystemSelection(): MobileViewSelection {
  const id =
    props.systemViews.find((item) => item.id === props.systemView)?.id ??
    props.systemViews[0]?.id
  return id ? { type: 'system', id } : { type: 'default' }
}

function applySelection(selection: MobileViewSelection, notify: 'change' | 'ready') {
  if (selection.type === 'saved') {
    selectedKey.value = 'saved:' + selection.id
    setStoredView(selection.id)
  } else if (selection.type === 'system') {
    selectedKey.value = 'system:' + selection.id
    setStoredView()
  } else {
    selectedKey.value = 'default'
    setStoredView()
  }
  if (notify === 'change') emit('change', selection)
  else emit('ready', selection)
}

async function loadViews() {
  try {
    const { data } = await userViewApi.list(props.module)
    views.value = data.filter((view) => view.enable)
  } catch (error) {
    views.value = []
    showFailToast(extractErrorMessage(error))
  }

  const stored = localStorage.getItem(storageKey()) ?? ''
  const saved = views.value.find((view) => view.id === stored)
  applySelection(saved ? { type: 'saved', id: saved.id } : initialSystemSelection(), 'ready')
}

function selectSystem(id: string) {
  applySelection({ type: 'system', id }, 'change')
}

function selectDefault() {
  applySelection({ type: 'default' }, 'change')
}

function selectSaved(id: string) {
  applySelection({ type: 'saved', id }, 'change')
}

onMounted(loadViews)
</script>

<template>
  <div
    class="flex min-h-12 gap-2 overflow-x-auto whitespace-nowrap border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-1 py-2"
  >
    <template v-if="systemViews.length">
      <van-button
        v-for="view in systemViews"
        :key="view.id"
        round
        size="small"
        :type="selectedKey === 'system:' + view.id ? 'primary' : 'default'"
        :plain="selectedKey !== 'system:' + view.id"
        @click="selectSystem(view.id)"
      >
        {{ view.label }}
      </van-button>
    </template>
    <van-button
      v-else
      round
      size="small"
      :type="selectedKey === 'default' ? 'primary' : 'default'"
      :plain="selectedKey !== 'default'"
      @click="selectDefault"
    >
      {{ defaultLabel }}
    </van-button>

    <van-button
      v-for="view in views"
      :key="view.id"
      round
      size="small"
      :type="selectedKey === 'saved:' + view.id ? 'primary' : 'default'"
      :plain="selectedKey !== 'saved:' + view.id"
      @click="selectSaved(view.id)"
    >
      {{ view.name }}
    </van-button>
  </div>
</template>
