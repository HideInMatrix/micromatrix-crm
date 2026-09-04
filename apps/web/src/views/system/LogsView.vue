<script setup lang="ts">
import type {
  LoginLogVO,
  OperationLogDetailVO,
  OperationLogSettingVO,
  OperationLogVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { logApi } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

interface ChangeRow {
  field: string
  before: unknown
  after: unknown
}

const auth = useAuthStore()
const canManagePolicy = computed(() => auth.hasPerm('system:log:update'))
const activeTab = ref('operations')

const opLoading = ref(false)
const opItems = ref<OperationLogVO[]>([])
const opTotal = ref(0)
const opQuery = reactive({ page: 1, pageSize: 10, keyword: '' })

const loginLoading = ref(false)
const loginItems = ref<LoginLogVO[]>([])
const loginTotal = ref(0)
const loginQuery = reactive({ page: 1, pageSize: 10, keyword: '' })

const detailVisible = ref(false)
const detailLoading = ref(false)
const operationDetail = ref<OperationLogDetailVO | null>(null)

const policyVisible = ref(false)
const policyLoading = ref(false)
const policySaving = ref(false)
const cleanupRunning = ref(false)
const policy = ref<OperationLogSettingVO | null>(null)
const policyForm = reactive({ permanent: false, retentionDays: 180 })

const detailChanges = computed<ChangeRow[]>(() => {
  const detail = operationDetail.value?.detail
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return []
  const changes = (detail as { changes?: unknown }).changes
  if (!Array.isArray(changes)) return []
  return changes.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as { field?: unknown; before?: unknown; after?: unknown }
    if (typeof row.field !== 'string') return []
    return [{ field: row.field, before: row.before, after: row.after }]
  })
})

const detailJson = computed(() => JSON.stringify(operationDetail.value?.detail ?? null, null, 2))

async function loadOperations() {
  opLoading.value = true
  try {
    const { data } = await logApi.operations({
      page: opQuery.page,
      pageSize: opQuery.pageSize,
      keyword: opQuery.keyword.trim() || undefined,
    })
    opItems.value = data.items
    opTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    opLoading.value = false
  }
}

async function loadLogins() {
  loginLoading.value = true
  try {
    const { data } = await logApi.logins({
      page: loginQuery.page,
      pageSize: loginQuery.pageSize,
      keyword: loginQuery.keyword.trim() || undefined,
    })
    loginItems.value = data.items
    loginTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loginLoading.value = false
  }
}

async function openOperationDetail(id: string) {
  detailVisible.value = true
  detailLoading.value = true
  operationDetail.value = null
  try {
    const { data } = await logApi.operationDetail(id)
    operationDetail.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

function applyPolicy(data: OperationLogSettingVO) {
  policy.value = data
  policyForm.permanent = data.permanent
  policyForm.retentionDays = data.retentionDays ?? data.defaultRetentionDays
}

async function loadPolicy() {
  policyLoading.value = true
  try {
    const { data } = await logApi.settings()
    applyPolicy(data)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    policyLoading.value = false
  }
}

async function openPolicy() {
  policyVisible.value = true
  await loadPolicy()
}

async function savePolicy() {
  policySaving.value = true
  try {
    const { data } = await logApi.updateSettings({
      retentionDays: policyForm.permanent ? null : policyForm.retentionDays,
    })
    applyPolicy(data)
    ElMessage.success('日志保留策略已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    policySaving.value = false
  }
}

async function runCleanup() {
  if (policy.value?.permanent) return
  try {
    await ElMessageBox.confirm(
      `将立即删除当前组织超过 ${policy.value?.retentionDays ?? policyForm.retentionDays} 天的操作日志，单次清理仍受系统批次上限保护。是否继续？`,
      '立即清理操作日志',
      { confirmButtonText: '开始清理', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  cleanupRunning.value = true
  try {
    const { data } = await logApi.cleanup()
    applyPolicy(data.setting)
    ElMessage.success(
      data.skipped ? '当前策略为永久保留，未执行删除' : `已清理 ${data.deleted} 条过期日志`,
    )
    opQuery.page = 1
    await loadOperations()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    cleanupRunning.value = false
  }
}

function handleTabChange() {
  if (activeTab.value === 'operations') loadOperations()
  else loadLogins()
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-'
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function cleanupSourceLabel(source: OperationLogSettingVO['lastCleanupSource']) {
  if (source === 'AUTO') return '自动清理'
  if (source === 'MANUAL') return '手工清理'
  return '-'
}

onMounted(loadOperations)
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="操作日志" name="operations">
        <div class="mb-3 flex items-center justify-between gap-3">
          <el-input
            v-model="opQuery.keyword"
            placeholder="搜索操作人 / 对象名称"
            clearable
            class="!w-64"
            @keyup.enter="((opQuery.page = 1), loadOperations())"
            @clear="((opQuery.page = 1), loadOperations())"
          />
          <el-button @click="openPolicy">日志策略</el-button>
        </div>
        <el-table v-loading="opLoading" :data="opItems" stripe>
          <el-table-column label="操作人" width="120">
            <template #default="{ row }">{{ row.userName || '-' }}</template>
          </el-table-column>
          <el-table-column prop="module" label="模块" width="120" />
          <el-table-column prop="action" label="动作" width="130" />
          <el-table-column label="操作对象" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.targetName || '-' }}</template>
          </el-table-column>
          <el-table-column label="IP" width="150">
            <template #default="{ row }">{{ row.ip || '-' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="详情" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openOperationDetail(row.id)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="mt-4 flex justify-end">
          <el-pagination
            v-model:current-page="opQuery.page"
            :total="opTotal"
            :page-size="opQuery.pageSize"
            layout="total, prev, pager, next"
            @current-change="loadOperations"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="登录日志" name="logins">
        <div class="mb-3 flex">
          <el-input
            v-model="loginQuery.keyword"
            placeholder="搜索邮箱"
            clearable
            class="!w-64"
            @keyup.enter="((loginQuery.page = 1), loadLogins())"
            @clear="((loginQuery.page = 1), loadLogins())"
          />
        </div>
        <el-table v-loading="loginLoading" :data="loginItems" stripe>
          <el-table-column prop="email" label="账号" min-width="200" />
          <el-table-column label="登录方式" width="140">
            <template #default="{ row }">
              <el-tag :type="row.authType.startsWith('WECOM') ? 'primary' : 'info'" effect="plain">
                {{
                  row.authType === 'WECOM_OAUTH2'
                    ? '企业微信工作台'
                    : row.authType === 'WECOM'
                      ? '企业微信扫码'
                      : '密码'
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="100">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                {{ row.success ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明" width="160">
            <template #default="{ row }">{{ row.message || '-' }}</template>
          </el-table-column>
          <el-table-column label="IP" width="150">
            <template #default="{ row }">{{ row.ip || '-' }}</template>
          </el-table-column>
          <el-table-column label="UA" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.userAgent || '-' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <div class="mt-4 flex justify-end">
          <el-pagination
            v-model:current-page="loginQuery.page"
            :total="loginTotal"
            :page-size="loginQuery.pageSize"
            layout="total, prev, pager, next"
            @current-change="loadLogins"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-drawer v-model="detailVisible" title="操作日志详情" size="640px">
    <div v-loading="detailLoading" class="min-h-40">
      <template v-if="operationDetail">
        <el-descriptions :column="1" border class="mb-5">
          <el-descriptions-item label="操作人">{{
            operationDetail.userName || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="模块 / 动作">
            {{ operationDetail.module }} / {{ operationDetail.action }}
          </el-descriptions-item>
          <el-descriptions-item label="操作对象">
            {{ operationDetail.targetName || operationDetail.targetId || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="客户端 IP">{{
            operationDetail.ip || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="时间">{{
            formatTime(operationDetail.createdAt)
          }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="detailChanges.length">
          <div class="mb-2 text-sm font-600">字段变化</div>
          <el-table :data="detailChanges" border>
            <el-table-column prop="field" label="字段" min-width="150" />
            <el-table-column label="修改前" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDetailValue(row.before) }}</template>
            </el-table-column>
            <el-table-column label="修改后" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDetailValue(row.after) }}</template>
            </el-table-column>
          </el-table>
        </template>
        <template v-else-if="operationDetail.detail !== null">
          <div class="mb-2 text-sm font-600">扩展详情</div>
          <pre
            class="m-0 overflow-auto rounded bg-[var(--el-fill-color-light)] p-3 text-xs leading-5"
            >{{ detailJson }}</pre>
        </template>
        <el-empty v-else description="该操作没有扩展详情" :image-size="72" />
      </template>
    </div>
  </el-drawer>

  <el-drawer v-model="policyVisible" title="操作日志策略" size="520px">
    <div v-loading="policyLoading" class="min-h-56">
      <template v-if="policy">
        <el-descriptions :column="1" border class="mb-5">
          <el-descriptions-item label="当前策略">
            {{ policy.permanent ? '永久保留' : `${policy.retentionDays} 天` }}
          </el-descriptions-item>
          <el-descriptions-item label="策略来源">
            {{
              policy.configured ? '当前组织自定义' : `部署默认（${policy.defaultRetentionDays} 天）`
            }}
          </el-descriptions-item>
          <el-descriptions-item label="最近清理">{{
            formatTime(policy.lastCleanupAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="最近删除"
            >{{ policy.lastCleanupDeleted }} 条</el-descriptions-item
          >
          <el-descriptions-item label="触发方式">
            {{ cleanupSourceLabel(policy.lastCleanupSource) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          title="系统每天 04:15（服务端时区）自动检查过期操作日志。单批数量和单轮批次数由部署环境控制，网页端不可修改。"
          type="info"
          :closable="false"
          class="mb-5"
        />

        <template v-if="canManagePolicy">
          <el-form label-position="top">
            <el-form-item label="保留模式">
              <el-radio-group v-model="policyForm.permanent">
                <el-radio-button :value="false">按天保留</el-radio-button>
                <el-radio-button :value="true">永久保留</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="!policyForm.permanent" label="保留天数">
              <el-input-number
                v-model="policyForm.retentionDays"
                :min="30"
                :max="3650"
                :step="30"
                controls-position="right"
              />
              <span class="ml-3 text-xs text-[var(--el-text-color-secondary)]">30～3650 天</span>
            </el-form-item>
          </el-form>

          <el-alert
            v-if="policyForm.permanent"
            title="永久保留会持续增加 PostgreSQL 占用，请确保已有外部归档或明确的审计要求。"
            type="warning"
            :closable="false"
            class="mb-5"
          />

          <div class="flex items-center justify-between gap-3">
            <el-button
              type="danger"
              plain
              :disabled="policy.permanent"
              :loading="cleanupRunning"
              @click="runCleanup"
            >
              立即清理
            </el-button>
            <el-button type="primary" :loading="policySaving" @click="savePolicy"
              >保存策略</el-button
            >
          </div>
        </template>

        <el-alert
          v-else
          title="当前账号只有日志查看权限，无法修改保留策略或执行清理。"
          type="info"
          :closable="false"
        />
      </template>
    </div>
  </el-drawer>
</template>
