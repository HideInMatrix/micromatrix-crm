<script setup lang="ts">
import type {
  MessageChannelGateVO,
  MessageTaskGroupVO,
  MessageTaskSettingVO,
} from '@micromatrix/shared'
import { Settings } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { messageSettingApi } from '@/api/system'
import { useAuthStore } from '@/stores/auth'
import MessageConfigDrawer from './components/MessageConfigDrawer.vue'
import MessageDeliveryDrawer from './components/MessageDeliveryDrawer.vue'

interface MessageTableRow extends MessageTaskSettingVO {
  moduleRowspan: number
}

const auth = useAuthStore()
const loading = ref(false)
const saving = ref(false)
const groups = ref<MessageTaskGroupVO[]>([])
const configVisible = ref(false)
const activeItem = ref<MessageTaskSettingVO | null>(null)
const deliveryVisible = ref(false)
const weComGate = ref<MessageChannelGateVO | null>(null)
const canUpdate = computed(() => auth.hasPerm('system:message:update'))
const rows = computed<MessageTableRow[]>(() =>
  groups.value.flatMap((group) =>
    group.items.map((item, index) => ({
      ...item,
      moduleRowspan: index === 0 ? group.items.length : 0,
    })),
  ),
)
const allSystemEnabled = computed(
  () => rows.value.length > 0 && rows.value.every((item) => item.systemEnabled),
)
const allEmailEnabled = computed(
  () => rows.value.length > 0 && rows.value.every((item) => item.emailEnabled),
)
const allWeComEnabled = computed(
  () => rows.value.length > 0 && rows.value.every((item) => item.weComEnabled),
)

async function load() {
  loading.value = true
  try {
    const [{ data: settings }, { data: gate }] = await Promise.all([
      messageSettingApi.list(),
      messageSettingApi.weComStatus(),
    ])
    groups.value = settings
    weComGate.value = gate
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function confirmDisable(value: boolean): Promise<boolean> {
  if (value) return true
  return ElMessageBox.confirm(
    '关闭后，成员将不再接收该功能的系统消息。确定继续？',
    '关闭系统通知',
    {
      type: 'warning',
    },
  )
    .then(() => true)
    .catch(() => false)
}

function asMessageRow(row: unknown): MessageTableRow {
  return row as MessageTableRow
}

async function toggleSystem(rowValue: unknown, value: boolean | string | number) {
  if (typeof value !== 'boolean') return
  if (!(await confirmDisable(value))) {
    await load()
    return
  }
  const row = asMessageRow(rowValue)
  saving.value = true
  try {
    await messageSettingApi.update(row.event, {
      module: row.module,
      systemEnabled: value,
    })
    ElMessage.success('消息设置已保存')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function toggleAllSystem(value: boolean | string | number) {
  if (typeof value !== 'boolean') return
  if (!(await confirmDisable(value))) {
    await load()
    return
  }
  saving.value = true
  try {
    const { data } = await messageSettingApi.batchUpdate({ systemEnabled: value })
    groups.value = data
    ElMessage.success('全部系统消息设置已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function toggleWeCom(rowValue: unknown, value: boolean | string | number) {
  if (typeof value !== 'boolean') return
  const row = asMessageRow(rowValue)
  saving.value = true
  try {
    await messageSettingApi.update(row.event, {
      module: row.module,
      weComEnabled: value,
    })
    ElMessage.success('企业微信消息设置已保存')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  } finally {
    saving.value = false
  }
}

async function toggleAllWeCom(value: boolean | string | number) {
  if (typeof value !== 'boolean') return
  saving.value = true
  try {
    const { data } = await messageSettingApi.batchUpdate({ weComEnabled: value })
    groups.value = data
    ElMessage.success('全部企业微信消息设置已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  } finally {
    saving.value = false
  }
}

function openConfig(row: unknown) {
  activeItem.value = asMessageRow(row)
  configVisible.value = true
}

function tableSpan({ row, columnIndex }: { row: MessageTableRow; columnIndex: number }) {
  if (columnIndex !== 0) return { rowspan: 1, colspan: 1 }
  return row.moduleRowspan > 0
    ? { rowspan: row.moduleRowspan, colspan: 1 }
    : { rowspan: 0, colspan: 0 }
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading" shadow="never" body-class="!p-0" class="message-settings-card">
    <div
      class="flex items-center justify-between border-b border-[var(--el-border-color-lighter)] px-6 py-4"
    >
      <div>
        <div class="font-medium">消息通知</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          按业务事件控制消息渠道；配置对当前企业内所有成员生效
        </div>
      </div>
      <el-button v-if="weComGate?.configured" @click="deliveryVisible = true">
        企业微信投递记录
      </el-button>
    </div>

    <el-alert class="m-4 !w-auto" type="info" :closable="false" show-icon>
      <template #title>邮件发送通道尚未接入，邮件提醒开关暂只保留配置底座。</template>
    </el-alert>

    <el-alert
      v-if="weComGate?.configured && !weComGate.available"
      class="m-4 !w-auto"
      type="warning"
      :closable="false"
      show-icon
      :title="weComGate.reason || '企业微信消息通道暂不可用'"
    />

    <el-table
      :data="rows"
      :span-method="tableSpan"
      border
      class="message-settings-table"
      row-key="event"
      data-testid="message-settings-table"
    >
      <el-table-column prop="moduleName" label="功能" width="220" class-name="module-cell" />
      <el-table-column prop="eventName" label="通知场景" min-width="280">
        <template #default="{ row }">
          <div class="flex items-center justify-between gap-3">
            <span>{{ row.eventName }}</span>
            <el-tooltip v-if="row.configurable" content="到期与通知范围配置" placement="top">
              <el-button
                link
                type="primary"
                :icon="Settings"
                :disabled="!canUpdate"
                :data-event-config="row.event"
                aria-label="配置通知范围"
                @click="openConfig(row)"
              />
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
      <el-table-column width="220" align="center">
        <template #header>
          <div class="channel-header">
            <span>系统消息</span>
            <el-switch
              :model-value="allSystemEnabled"
              :loading="saving"
              :disabled="!canUpdate"
              data-testid="message-system-toggle-all"
              @change="toggleAllSystem"
            />
          </div>
        </template>
        <template #default="{ row }">
          <el-switch
            :model-value="row.systemEnabled"
            :loading="saving"
            :disabled="!canUpdate"
            :data-event-toggle="row.event"
            @change="(value: boolean | string | number) => toggleSystem(row, value)"
          />
        </template>
      </el-table-column>
      <el-table-column v-if="weComGate?.configured" width="220" align="center">
        <template #header>
          <div class="channel-header">
            <span>企业微信</span>
            <el-tooltip :disabled="weComGate.available" :content="weComGate.reason || ''">
              <span>
                <el-switch
                  :model-value="allWeComEnabled"
                  :loading="saving"
                  :disabled="!canUpdate || !weComGate.available"
                  data-testid="message-wecom-toggle-all"
                  @change="toggleAllWeCom"
                />
              </span>
            </el-tooltip>
          </div>
        </template>
        <template #default="{ row }">
          <el-switch
            :model-value="row.weComEnabled"
            :loading="saving"
            :disabled="!canUpdate || !weComGate.available"
            :data-event-wecom-toggle="row.event"
            @change="(value: boolean | string | number) => toggleWeCom(row, value)"
          />
        </template>
      </el-table-column>
      <el-table-column width="220" align="center">
        <template #header>
          <div class="channel-header">
            <span>邮件提醒</span>
            <el-tooltip content="邮件发送通道待接入">
              <el-switch :model-value="allEmailEnabled" disabled />
            </el-tooltip>
          </div>
        </template>
        <template #default="{ row }">
          <el-tooltip content="邮件发送通道待接入">
            <el-switch :model-value="row.emailEnabled" disabled />
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <MessageConfigDrawer v-model="configVisible" :item="activeItem" @saved="load" />
  <MessageDeliveryDrawer v-model="deliveryVisible" />
</template>

<style scoped>
.message-settings-card {
  min-height: calc(100vh - 112px);
}

.message-settings-table {
  width: calc(100% - 32px);
  margin: 0 16px 16px;
}

.channel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

:deep(.message-settings-table th.el-table__cell),
:deep(.message-settings-table td.module-cell) {
  background: var(--el-fill-color-lighter);
}
</style>
