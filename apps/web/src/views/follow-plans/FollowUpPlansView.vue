<script setup lang="ts">
import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  type FollowUpPlanStatus,
  type FollowUpPlanVO,
} from '@micromatrix/shared'
import { CalendarClock, CheckCheck, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { followUpPlanApi } from '@/api/sales'
import FollowUpPlanDialog from '@/components/follow-plans/FollowUpPlanDialog.vue'

const loading = ref(false)
const route = useRoute()
const router = useRouter()
const items = ref<FollowUpPlanVO[]>([])
const total = ref(0)
const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
  status: '' as FollowUpPlanStatus | '',
  mine: false,
})
const dialogVisible = ref(false)
const editing = ref<FollowUpPlanVO | null>(null)

const statusTypes: Record<FollowUpPlanStatus, 'info' | 'primary' | 'success' | 'warning'> = {
  PREPARED: 'info',
  UNDERWAY: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'warning',
}
const targetLabels = { lead: '线索', customer: '客户', opportunity: '商机' } as const

function asPlan(value: unknown): FollowUpPlanVO {
  return value as FollowUpPlanVO
}

function targetLabel(value: unknown) {
  return targetLabels[value as FollowUpPlanVO['targetType']]
}

function statusLabel(value: unknown) {
  return FOLLOW_UP_PLAN_STATUS_LABELS[value as FollowUpPlanStatus]
}

function statusType(value: unknown) {
  return statusTypes[value as FollowUpPlanStatus]
}

async function load() {
  loading.value = true
  try {
    const { data } = await followUpPlanApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      status: query.status || undefined,
      mine: query.mine || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  load()
}

function create() {
  editing.value = null
  dialogVisible.value = true
}

function edit(plan: FollowUpPlanVO) {
  editing.value = plan
  dialogVisible.value = true
}

async function consumeRoutePlan() {
  const id = typeof route.query.id === 'string' ? route.query.id : ''
  if (!id) return
  try {
    const { data } = await followUpPlanApi.get(id)
    editing.value = data
    dialogVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    const query = { ...route.query }
    delete query.id
    await router.replace({ path: route.path, query })
  }
}

async function updateStatus(plan: FollowUpPlanVO, status: FollowUpPlanStatus) {
  try {
    await followUpPlanApi.updateStatus(plan.id, status)
    ElMessage.success('状态已更新')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function convert(plan: FollowUpPlanVO) {
  const confirmed = await ElMessageBox.confirm('确认生成跟进记录？该操作不可重复。', '转跟进记录', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await followUpPlanApi.convert(plan.id)
    ElMessage.success('已生成跟进记录')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(plan: FollowUpPlanVO) {
  const confirmed = await ElMessageBox.confirm('确认删除该跟进计划？', '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await followUpPlanApi.remove(plan.id)
    ElMessage.success('计划已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  query.mine = route.query.mine === '1'
  await load()
  await consumeRoutePlan()
})
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex items-center flex-wrap gap-2">
        <el-input
          v-model="query.keyword"
          clearable
          placeholder="搜索对象或计划内容"
          class="!w-60"
          @keyup.enter="search"
          @clear="search"
        >
          <template #prefix><Search :size="16" aria-hidden="true" /></template>
        </el-input>
        <el-select
          v-model="query.status"
          clearable
          placeholder="全部状态"
          class="!w-32"
          @change="search"
        >
          <el-option
            v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS"
            :key="key"
            :label="label"
            :value="key"
          />
        </el-select>
        <el-checkbox v-model="query.mine" @change="search">我的计划</el-checkbox>
        <el-button @click="load"><RefreshCw :size="16" aria-hidden="true" />刷新</el-button>
      </div>
      <el-button type="primary" @click="create"
        ><Plus :size="16" aria-hidden="true" />新建计划</el-button
      >
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="计划对象" min-width="180">
        <template #default="{ row }">
          <div class="font-medium">{{ row.targetName }}</div>
          <div class="text-xs text-[var(--el-text-color-secondary)]">
            {{ targetLabel(row.targetType) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="content" label="计划内容" min-width="260" show-overflow-tooltip />
      <el-table-column prop="method" label="方式" width="90" />
      <el-table-column label="计划时间" width="170">
        <template #default="{ row }">
          <span class="inline-flex items-center gap-1">
            <CalendarClock :size="15" aria-hidden="true" />
            {{ row.estimatedAt ? new Date(row.estimatedAt).toLocaleString() : '-' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="ownerName" label="负责人" width="120" />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          <div v-if="row.converted" class="text-xs text-[var(--el-color-success)] mt-1">
            已转记录
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <template v-if="row.canManage">
            <el-dropdown
              :disabled="row.status === 'COMPLETED' && row.converted"
              @command="updateStatus(asPlan(row), $event as FollowUpPlanStatus)"
            >
              <el-button link type="primary">状态</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS"
                    :key="key"
                    :command="key"
                  >
                    {{ label }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              v-if="row.status === 'COMPLETED' && !row.converted"
              link
              type="success"
              @click="convert(asPlan(row))"
            >
              <CheckCheck :size="15" aria-hidden="true" />转记录
            </el-button>
            <el-button link type="primary" @click="edit(asPlan(row))"
              ><Pencil :size="15" aria-hidden="true" />编辑</el-button
            >
            <el-button link type="danger" @click="remove(asPlan(row))"
              ><Trash2 :size="15" aria-hidden="true" />删除</el-button
            >
          </template>
          <span v-else class="text-xs text-[var(--el-text-color-secondary)]">只读</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        layout="total, sizes, prev, pager, next"
        :total="total"
        @change="load"
      />
    </div>

    <FollowUpPlanDialog v-model="dialogVisible" :plan="editing" @saved="load" />
  </el-card>
</template>
