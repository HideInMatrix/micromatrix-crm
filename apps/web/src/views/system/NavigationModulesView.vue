<script setup lang="ts">
import {
  NAVIGATION_MODULES,
  TOP_NAVIGATION_DEFINITIONS,
  type ModuleConfigVO,
  type NavigationModuleKey,
  type TopNavigationConfigVO,
  type TopNavigationKey,
} from '@micromatrix/shared'
import { GripVertical } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { extractErrorMessage } from '@/api/http'
import { moduleIconOf, topNavigationIconOf } from '@/router/navigation-icons'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import LeadCapacitySettingsDrawer from './components/LeadCapacitySettingsDrawer.vue'
import LeadPoolReasonSettingsDrawer from './components/LeadPoolReasonSettingsDrawer.vue'
import LeadPoolSettingsDrawer from './components/LeadPoolSettingsDrawer.vue'
import CustomerCapacitySettingsDrawer from './components/CustomerCapacitySettingsDrawer.vue'
import CustomerPoolReasonSettingsDrawer from './components/CustomerPoolReasonSettingsDrawer.vue'
import CustomerPoolSettingsDrawer from './components/CustomerPoolSettingsDrawer.vue'
import OpportunityCloseRuleSettingsDrawer from './components/OpportunityCloseRuleSettingsDrawer.vue'
import OpportunityFailureReasonSettingsDrawer from './components/OpportunityFailureReasonSettingsDrawer.vue'
import OpportunityStageSettingsDrawer from './components/OpportunityStageSettingsDrawer.vue'

interface ModuleAction {
  label: string
  path?: string
  query?: Record<string, string>
  drawer?:
    | 'lead-pool'
    | 'lead-capacity'
    | 'lead-reason'
    | 'customer-pool'
    | 'customer-capacity'
    | 'customer-reason'
    | 'opportunity-stage'
    | 'opportunity-rule'
    | 'opportunity-reason'
}

interface ModuleActionGroup {
  primary: ModuleAction[]
  more?: ModuleAction[]
}

const moduleActions: Partial<Record<NavigationModuleKey, ModuleActionGroup>> = {
  lead: {
    primary: [
      { label: '线索表单设置', path: '/system/modules/fields', query: { module: 'lead' } },
      { label: '线索池设置', drawer: 'lead-pool' },
      { label: '线索库容设置', drawer: 'lead-capacity' },
    ],
    more: [{ label: '移入线索池原因设置', drawer: 'lead-reason' }],
  },
  customer: {
    primary: [
      { label: '客户表单设置', path: '/system/modules/fields', query: { module: 'customer' } },
      { label: '联系人表单设置', path: '/system/modules/fields', query: { module: 'contact' } },
      { label: '公海设置', drawer: 'customer-pool' },
    ],
    more: [
      { label: '客户库容设置', drawer: 'customer-capacity' },
      { label: '移入公海原因设置', drawer: 'customer-reason' },
    ],
  },
  contract: {
    primary: [
      { label: '合同表单设置', path: '/system/modules/fields', query: { module: 'contract' } },
      { label: '回款计划表单设置' },
      { label: '回款记录表单设置' },
    ],
    more: [{ label: '工商抬头表单必填设置' }, { label: '发票表单设置' }, { label: '合同阶段设置' }],
  },
  opportunity: {
    primary: [
      { label: '商机表单设置', path: '/system/modules/fields', query: { module: 'opportunity' } },
      { label: '报价表单设置', path: '/system/modules/fields', query: { module: 'quote' } },
      { label: '商机阶段设置', drawer: 'opportunity-stage' },
    ],
    more: [
      { label: '商机关闭规则', drawer: 'opportunity-rule' },
      { label: '商机失败原因设置', drawer: 'opportunity-reason' },
    ],
  },
  order: {
    primary: [
      { label: '订单表单设置', path: '/system/modules/fields', query: { module: 'order' } },
      { label: '订单状态流设置' },
    ],
  },
  product: {
    primary: [
      { label: '产品表单设置', path: '/system/modules/fields', query: { module: 'product' } },
      { label: '价格表表单设置', path: '/system/modules/fields', query: { module: 'price' } },
    ],
  },
}

const router = useRouter()
const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()
const loading = ref(false)
const savingOrder = ref(false)
const savingTopNavigationOrder = ref(false)
const orderedConfigs = ref<ModuleConfigVO[]>([])
const orderedTopNavigationConfigs = ref<TopNavigationConfigVO[]>([])
const leadPoolVisible = ref(false)
const leadCapacityVisible = ref(false)
const leadReasonVisible = ref(false)
const customerPoolVisible = ref(false)
const customerCapacityVisible = ref(false)
const customerReasonVisible = ref(false)
const opportunityStageVisible = ref(false)
const opportunityRuleVisible = ref(false)
const opportunityReasonVisible = ref(false)

const canUpdate = computed(() => auth.hasPerm('system:module:update'))
const definitionMap = new Map(NAVIGATION_MODULES.map((item) => [item.key, item]))
const topNavigationDefinitionMap = new Map(
  TOP_NAVIGATION_DEFINITIONS.map((item) => [item.key, item]),
)
const moduleCardConfigs = computed(() =>
  orderedConfigs.value.filter((item) => item.moduleKey !== 'system'),
)

function labelOf(moduleKey: NavigationModuleKey) {
  return definitionMap.get(moduleKey)?.label ?? moduleKey
}

function topNavigationLabel(key: TopNavigationKey) {
  return topNavigationDefinitionMap.get(key)?.label ?? key
}

function actionsOf(moduleKey: NavigationModuleKey) {
  return moduleActions[moduleKey] ?? { primary: [] }
}

function unavailableActionTip(action: ModuleAction) {
  return `「${action.label}」将在对应 Cordys 业务模块执行单元中继续对齐`
}

async function load() {
  loading.value = true
  try {
    await moduleConfig.load(true)
    orderedConfigs.value = moduleConfig.configs
      .map((item) => ({ ...item }))
      .sort((a, b) => a.sort - b.sort)
    orderedTopNavigationConfigs.value = moduleConfig.topNavigationConfigs
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
    enabled ? '模块开启后，模块出现在主导航菜单' : '关闭后，成员在主导航找不到该模块，请谨慎操作！',
    `确认${enabled ? '开启' : '关闭'}${label}模块吗`,
    {
      type: enabled ? 'info' : 'warning',
      confirmButtonText: enabled ? '确认开启' : '确认关闭',
      cancelButtonText: '取消',
    },
  )
    .then(() => true)
    .catch(() => false)

  if (!confirmed) return

  try {
    const updated = await moduleConfig.update(config.moduleKey, enabled)
    Object.assign(config, updated)
    ElMessage.success(enabled ? '已开启' : '已关闭')
  } catch (error) {
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
    ElMessage.success('操作成功')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  } finally {
    savingOrder.value = false
  }
}

async function handleTopNavigationDragEnd() {
  if (!canUpdate.value) {
    await load()
    return
  }
  savingTopNavigationOrder.value = true
  try {
    await moduleConfig.reorderTopNavigation(
      orderedTopNavigationConfigs.value.map((item) => item.navigationKey),
    )
    orderedTopNavigationConfigs.value = moduleConfig.topNavigationConfigs
      .map((item) => ({ ...item }))
      .sort((a, b) => a.sort - b.sort)
    ElMessage.success('操作成功')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  } finally {
    savingTopNavigationOrder.value = false
  }
}

function openAction(action: ModuleAction) {
  if (action.path) {
    router.push({ path: action.path, query: action.query })
    return
  }
  if (action.drawer === 'lead-pool') leadPoolVisible.value = true
  if (action.drawer === 'lead-capacity') leadCapacityVisible.value = true
  if (action.drawer === 'lead-reason') leadReasonVisible.value = true
  if (action.drawer === 'customer-pool') customerPoolVisible.value = true
  if (action.drawer === 'customer-capacity') customerCapacityVisible.value = true
  if (action.drawer === 'customer-reason') customerReasonVisible.value = true
  if (action.drawer === 'opportunity-stage') opportunityStageVisible.value = true
  if (action.drawer === 'opportunity-rule') opportunityRuleVisible.value = true
  if (action.drawer === 'opportunity-reason') opportunityReasonVisible.value = true
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="overflow-x-auto">
    <div
      class="grid min-h-[calc(100vh-104px)] min-w-[980px] grid-cols-[minmax(280px,24%)_minmax(620px,1fr)] gap-4"
      data-testid="module-settings-layout"
    >
      <el-card shadow="never" body-class="!p-6" class="h-fit">
        <div class="mb-4 font-medium text-[var(--el-text-color-primary)]">主导航配置</div>
        <draggable
          v-model="orderedConfigs"
          item-key="moduleKey"
          handle=".module-drag-handle"
          ghost-class="module-drag-ghost"
          :disabled="!canUpdate || savingOrder"
          data-testid="main-navigation-list"
          @end="handleDragEnd"
        >
          <template #item="{ element: item }">
            <div
              class="module-nav-item module-drag-handle"
              :class="canUpdate ? 'cursor-move' : 'cursor-not-allowed'"
              :data-module-key="item.moduleKey"
            >
              <GripVertical :size="16" class="shrink-0 text-[var(--el-text-color-placeholder)]" />
              <component
                :is="moduleIconOf(item.moduleKey)"
                :size="18"
                class="shrink-0 text-[var(--el-text-color-primary)]"
              />
              <span class="min-w-0 flex-1 truncate">{{ labelOf(item.moduleKey) }}</span>
            </div>
          </template>
        </draggable>

        <el-divider />

        <div class="mb-4 font-medium text-[var(--el-text-color-primary)]">顶部导航配置</div>
        <draggable
          v-model="orderedTopNavigationConfigs"
          item-key="navigationKey"
          handle=".top-navigation-drag-handle"
          ghost-class="module-drag-ghost"
          :disabled="!canUpdate || savingTopNavigationOrder"
          data-testid="top-navigation-list"
          @end="handleTopNavigationDragEnd"
        >
          <template #item="{ element: item }">
            <div
              class="module-nav-item top-navigation-drag-handle"
              :class="canUpdate ? 'cursor-move' : 'cursor-not-allowed'"
              :data-top-navigation-key="item.navigationKey"
            >
              <GripVertical :size="16" class="shrink-0 text-[var(--el-text-color-placeholder)]" />
              <component
                :is="topNavigationIconOf(item.navigationKey)"
                :size="18"
                class="shrink-0 text-[var(--el-text-color-primary)]"
              />
              <span class="min-w-0 flex-1 truncate">
                {{ topNavigationLabel(item.navigationKey) }}
              </span>
            </div>
          </template>
        </draggable>
      </el-card>

      <el-card shadow="never" body-class="!p-6" class="h-fit">
        <div class="space-y-4" data-testid="module-config-list">
          <div
            v-for="item in moduleCardConfigs"
            :key="item.moduleKey"
            class="module-config-row"
            :data-module-config-key="item.moduleKey"
          >
            <div class="flex min-w-0 items-center gap-2 font-medium">
              <span class="module-config-icon">
                <component :is="moduleIconOf(item.moduleKey)" :size="20" />
              </span>
              <span class="truncate">{{ labelOf(item.moduleKey) }}</span>
            </div>

            <div class="flex min-w-0 items-center justify-end gap-2">
              <div class="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <el-tooltip
                  v-for="action in actionsOf(item.moduleKey).primary"
                  :key="action.label"
                  :disabled="Boolean(action.path || action.drawer)"
                  :content="unavailableActionTip(action)"
                  placement="top"
                >
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="(!action.path && !action.drawer) || !canUpdate"
                      @click="openAction(action)"
                    >
                      {{ action.label }}
                    </el-button>
                  </span>
                </el-tooltip>

                <el-dropdown
                  v-if="actionsOf(item.moduleKey).more?.length"
                  trigger="hover"
                  @command="openAction"
                >
                  <el-button link type="primary" :disabled="!canUpdate">更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-for="action in actionsOf(item.moduleKey).more"
                        :key="action.label"
                        :command="action"
                        :disabled="!action.path && !action.drawer"
                      >
                        {{ action.label }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>

              <el-divider
                v-if="actionsOf(item.moduleKey).primary.length"
                direction="vertical"
                class="!mx-1"
              />

              <el-switch
                :model-value="item.enabled"
                :data-module-key="item.moduleKey"
                :data-module-enabled="String(item.enabled)"
                :disabled="!item.configurable || !canUpdate"
                @change="handleToggle(item, $event as boolean)"
              />
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <LeadPoolSettingsDrawer v-model="leadPoolVisible" />
    <LeadCapacitySettingsDrawer v-model="leadCapacityVisible" />
    <LeadPoolReasonSettingsDrawer v-model="leadReasonVisible" />
    <CustomerPoolSettingsDrawer v-model="customerPoolVisible" />
    <CustomerCapacitySettingsDrawer v-model="customerCapacityVisible" />
    <CustomerPoolReasonSettingsDrawer v-model="customerReasonVisible" />
    <OpportunityStageSettingsDrawer v-model="opportunityStageVisible" />
    <OpportunityCloseRuleSettingsDrawer v-model="opportunityRuleVisible" />
    <OpportunityFailureReasonSettingsDrawer v-model="opportunityReasonVisible" />
  </div>
</template>

<style scoped>
.module-nav-item {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  font-size: 14px;
  transition: border-color 0.2s ease;
}

.module-nav-item:hover {
  border-color: var(--el-color-primary);
}

.module-drag-ghost {
  opacity: 0.55;
  border-color: var(--el-color-primary);
}

.module-config-row {
  display: flex;
  min-height: 80px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
}

.module-config-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: white;
}

:deep(.el-button.is-link){
  height: unset;
}
</style>
