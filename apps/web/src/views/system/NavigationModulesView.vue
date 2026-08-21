<script setup lang="ts">
import {
  NAVIGATION_MODULES,
  type ModuleConfigVO,
  type ModuleKey,
  type NavigationModuleKey,
} from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'

interface ModuleAction {
  label: string
  path: string
  module?: ModuleKey
}

const moduleActions: Partial<Record<NavigationModuleKey, ModuleAction[]>> = {
  lead: [
    { label: '线索表单设置', path: '/system/modules/fields', module: 'lead' },
    { label: '线索池设置', path: '/system/sales-settings', module: 'lead' },
    { label: '线索库容设置', path: '/system/sales-settings', module: 'lead' },
  ],
  customer: [
    { label: '客户表单设置', path: '/system/modules/fields', module: 'customer' },
    { label: '联系人表单设置', path: '/system/modules/fields', module: 'contact' },
    { label: '公海设置', path: '/system/sales-settings', module: 'customer' },
  ],
  opportunity: [
    { label: '商机表单设置', path: '/system/modules/fields', module: 'opportunity' },
    { label: '报价表单设置', path: '/system/modules/fields', module: 'quote' },
  ],
  product: [{ label: '产品表单设置', path: '/system/modules/fields', module: 'product' }],
  contract: [{ label: '合同表单设置', path: '/system/modules/fields', module: 'contract' }],
  order: [{ label: '订单表单设置', path: '/system/modules/fields', module: 'order' }],
}

const topNavigation = ['搜索', '待办', '记录/计划', '智能体', '消息通知', '关于', '语言', '帮助中心']

const router = useRouter()
const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()
const loading = ref(false)
const savingOrder = ref(false)
const orderedConfigs = ref<ModuleConfigVO[]>([])

const canUpdate = computed(() => auth.hasPerm('system:module:update'))
const definitionMap = new Map(NAVIGATION_MODULES.map((item) => [item.key, item]))
const cardConfigs = computed(() =>
  orderedConfigs.value.filter((item) => item.moduleKey !== 'system'),
)

function labelOf(moduleKey: NavigationModuleKey) {
  return definitionMap.get(moduleKey)?.label ?? moduleKey
}

async function load() {
  loading.value = true
  try {
    await moduleConfig.load(true)
    orderedConfigs.value = moduleConfig.configs
      .map((item) => ({ ...item }))
      .sort((a, b) => a.sort - b.sort)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleToggle(config: ModuleConfigVO, enabled: boolean) {
  const label = labelOf(config.moduleKey)
  const confirmed = await ElMessageBox.confirm(
    `${enabled ? '开启' : '关闭'}「${label}」模块后，左侧导航将立即${enabled ? '显示' : '隐藏'}该模块。确定继续？`,
    `${enabled ? '开启' : '关闭'}模块`,
    { type: 'warning' },
  ).catch(() => false)

  if (!confirmed) {
    config.enabled = !enabled
    return
  }

  try {
    const updated = await moduleConfig.update(config.moduleKey, enabled)
    Object.assign(config, updated)
    ElMessage.success(`${label}模块已${enabled ? '开启' : '关闭'}`)
  } catch (error) {
    config.enabled = !enabled
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDragEnd() {
  if (!canUpdate.value) {
    await load()
    return
  }
  savingOrder.value = true
  try {
    await moduleConfig.reorder(orderedConfigs.value.map((item) => item.moduleKey))
    orderedConfigs.value = moduleConfig.configs
      .map((item) => ({ ...item }))
      .sort((a, b) => a.sort - b.sort)
    ElMessage.success('主导航顺序已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  } finally {
    savingOrder.value = false
  }
}

function openAction(action: ModuleAction) {
  router.push({ path: action.path, query: action.module ? { module: action.module } : undefined })
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="grid min-h-[620px] grid-cols-[300px_minmax(0,1fr)] gap-4">
    <el-card shadow="never" body-class="!p-0">
      <div class="border-b border-[var(--el-border-color-lighter)] px-5 py-4">
        <div class="font-medium">主导航配置</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          拖拽调整左侧导航顺序
        </div>
      </div>

      <draggable
        v-model="orderedConfigs"
        item-key="moduleKey"
        handle=".module-drag-handle"
        :disabled="!canUpdate || savingOrder"
        @end="handleDragEnd"
      >
        <template #item="{ element: item }">
          <div
            class="flex items-center gap-3 border-b border-[var(--el-border-color-lighter)] px-5 py-3 text-sm"
          >
            <span
              class="module-drag-handle select-none text-lg text-[var(--el-text-color-placeholder)]"
              :class="canUpdate ? 'cursor-move' : 'cursor-not-allowed'"
            >⠿</span>
            <span class="flex-1">{{ labelOf(item.moduleKey) }}</span>
            <el-tag v-if="!item.enabled" size="small" type="info">已关闭</el-tag>
            <el-tag v-if="!item.configurable" size="small" type="info">固定</el-tag>
          </div>
        </template>
      </draggable>

      <div class="border-y border-[var(--el-border-color-lighter)] bg-[var(--el-fill-color-lighter)] px-5 py-4">
        <div class="font-medium">顶部导航配置</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          Cordys 固定公共入口，后续按各入口源码逐项实现
        </div>
      </div>
      <div
        v-for="item in topNavigation"
        :key="item"
        class="border-b border-[var(--el-border-color-lighter)] px-5 py-3 text-sm"
      >
        {{ item }}
      </div>
    </el-card>

    <el-card shadow="never" body-class="!p-0">
      <div class="border-b border-[var(--el-border-color-lighter)] px-6 py-4">
        <div class="font-medium">模块配置</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          模块开关决定主导航是否展示；模块设置入口进入对应业务配置
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 p-5 xl:grid-cols-3">
        <div
          v-for="item in cardConfigs"
          :key="item.moduleKey"
          class="min-h-[150px] rounded border border-[var(--el-border-color)] p-4"
        >
          <div class="flex-between">
            <div class="font-medium">{{ labelOf(item.moduleKey) }}</div>
            <el-switch
              v-model="item.enabled"
              :data-module-key="item.moduleKey"
              :data-module-enabled="String(item.enabled)"
              :disabled="!item.configurable || !canUpdate"
              @change="handleToggle(item, $event as boolean)"
            />
          </div>
          <div class="mt-3 min-h-8 text-xs leading-5 text-[var(--el-text-color-secondary)]">
            <template v-if="item.moduleKey === 'agent'">
              智能体属于 Cordys 固定扩展模块，当前迁移阶段不可配置。
            </template>
            <template v-else>
              {{ item.enabled ? '模块已启用，可从左侧导航访问。' : '模块已关闭，左侧导航不显示。' }}
            </template>
          </div>
          <div class="mt-4 flex flex-wrap gap-x-3 gap-y-1">
            <el-button
              v-for="action in moduleActions[item.moduleKey] ?? []"
              :key="action.label"
              link
              type="primary"
              @click="openAction(action)"
            >
              {{ action.label }}
            </el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>
