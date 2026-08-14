<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  dashboardApi,
  type DashboardSummary,
  type FunnelStage,
  type RankingData,
} from '@/api/dashboard'
import { checkDuplicate } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { settingApi } from '@/api/system'
import EChart from '@/components/EChart.vue'
import { useAuthStore } from '@/stores/auth'
import {
  DUPLICATE_SOURCE_LABELS,
  type DuplicateHitVO,
} from '@micromatrix/shared'

const auth = useAuthStore()
const router = useRouter()

const summary = ref<DashboardSummary | null>(null)
const funnel = ref<FunnelStage[]>([])
const ranking = ref<RankingData | null>(null)
const announcement = ref('')
const loading = ref(false)

const dupForm = reactive({ name: '', phone: '' })
const dupHits = ref<DuplicateHitVO[]>([])
const dupLoading = ref(false)
const dupSearched = ref(false)

const statCards = computed(() => [
  { label: '本月新增线索', value: summary.value?.newLeads ?? '-', link: '/leads' },
  { label: '本月新增客户', value: summary.value?.newCustomers ?? '-', link: '/customers' },
  { label: '本月新增商机', value: summary.value?.newOpportunities ?? '-', link: '/opportunities' },
  {
    label: '本月赢单金额',
    value: summary.value ? `¥${summary.value.wonAmount.toLocaleString('zh-CN')}` : '-',
    link: '/opportunities',
  },
  {
    label: '本月回款金额',
    value: summary.value ? `¥${summary.value.receivedAmount.toLocaleString('zh-CN')}` : '-',
    link: '/contracts',
  },
])

const todoItems = computed(() => [
  { label: '待我审批', value: summary.value?.pendingApprovals ?? 0, link: '/approvals' },
  { label: '近期待跟进', value: summary.value?.upcomingFollows ?? 0, link: '/customers' },
  { label: '逾期回款计划', value: summary.value?.overduePlans ?? 0, link: '/contracts', danger: true },
])

const funnelOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (p: { name: string; data: { count: number; value: number } }) =>
      `${p.name}<br/>数量：${p.data.count} 个<br/>金额：¥${p.data.value.toLocaleString('zh-CN')}`,
  },
  series: [
    {
      type: 'funnel',
      left: '5%',
      width: '90%',
      minSize: '20%',
      sort: 'none',
      label: { show: true, formatter: '{b}\n{c@count}个' },
      data: funnel.value.map((s) => ({ name: s.name, value: s.amount, count: s.count })),
    },
  ],
}))

const rankingOption = computed(() => {
  const list = [...(ranking.value?.won ?? [])].reverse()
  return {
    grid: { left: 80, right: 40, top: 10, bottom: 24 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v / 10000}万` } },
    yAxis: { type: 'category', data: list.map((r) => r.name) },
    series: [
      {
        type: 'bar',
        data: list.map((r) => r.amount),
        barMaxWidth: 18,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      },
    ],
  }
})

async function loadData() {
  loading.value = true
  try {
    const [summaryRes, funnelRes, rankingRes, settingsRes] = await Promise.all([
      dashboardApi.summary(),
      dashboardApi.funnel(),
      dashboardApi.ranking(),
      settingApi.get().catch(() => ({ data: {} as Record<string, unknown> })),
    ])
    summary.value = summaryRes.data
    funnel.value = funnelRes.data
    ranking.value = rankingRes.data
    announcement.value = (settingsRes.data.announcement as string) ?? ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

async function handleDuplicateCheck() {
  if (!dupForm.name.trim() && !dupForm.phone.trim()) {
    ElMessage.warning('请输入客户名称或电话')
    return
  }
  dupLoading.value = true
  try {
    const { data } = await checkDuplicate({
      name: dupForm.name.trim() || undefined,
      phone: dupForm.phone.trim() || undefined,
    })
    dupHits.value = data
    dupSearched.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    dupLoading.value = false
  }
}

function sourceLabel(hit: DuplicateHitVO) {
  return DUPLICATE_SOURCE_LABELS[hit.source]
}

function openHit(hit: DuplicateHitVO) {
  if (!hit.inScope) {
    ElMessage.info('该记录不在你的数据范围内')
    return
  }
  if (hit.source === 'customer') router.push(`/customers/${hit.id}`)
  else if (hit.source === 'opportunity') router.push('/opportunities')
  else if (hit.source === 'lead') router.push('/leads')
  else router.push('/customers')
}
</script>

<template>
  <div v-loading="loading">
    <el-alert
      v-if="announcement"
      :title="announcement"
      type="info"
      show-icon
      :closable="false"
      class="mb-4"
    />

    <h2 class="text-lg font-semibold mb-1">你好，{{ auth.user?.name ?? '朋友' }}</h2>
    <p class="text-sm text-[var(--el-text-color-secondary)] mb-4">
      {{ auth.user?.deptName ?? '' }} · {{ auth.user?.roleName ?? '' }}，以下是你数据范围内的销售概况
    </p>

    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
      <el-card
        v-for="card in statCards"
        :key="card.label"
        shadow="never"
        class="cursor-pointer"
        @click="router.push(card.link)"
      >
        <div class="text-sm text-[var(--el-text-color-secondary)]">{{ card.label }}</div>
        <div class="text-2xl font-bold mt-2 truncate">{{ card.value }}</div>
      </el-card>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <el-card shadow="never">
        <div class="font-medium mb-2">我的待办</div>
        <div
          v-for="todo in todoItems"
          :key="todo.label"
          class="flex-between py-3 border-b border-[var(--el-border-color-lighter)] last:border-b-0 cursor-pointer"
          @click="router.push(todo.link)"
        >
          <span class="text-sm">{{ todo.label }}</span>
          <el-badge
            :value="todo.value"
            :type="todo.danger && todo.value > 0 ? 'danger' : 'primary'"
            :hidden="todo.value === 0"
          >
            <span class="w-4" />
          </el-badge>
        </div>
        <el-empty
          v-if="todoItems.every((t) => t.value === 0)"
          description="太棒了，暂无待办"
          :image-size="60"
        />
      </el-card>

      <el-card shadow="never">
        <div class="font-medium mb-2">商机漏斗（金额）</div>
        <EChart :option="funnelOption" height="320px" />
      </el-card>

      <el-card shadow="never">
        <div class="font-medium mb-2">本月赢单排行</div>
        <el-empty
          v-if="(ranking?.won ?? []).length === 0"
          description="本月暂无赢单"
          :image-size="60"
        />
        <EChart v-else :option="rankingOption" height="320px" />
      </el-card>
    </div>

    <el-card shadow="never" class="mt-4">
      <div class="font-medium mb-3">客户查重</div>
      <div class="flex flex-wrap gap-2 mb-3">
        <el-input v-model="dupForm.name" placeholder="客户名称" clearable class="!w-56" />
        <el-input v-model="dupForm.phone" placeholder="电话" clearable class="!w-44" />
        <el-button type="primary" :loading="dupLoading" @click="handleDuplicateCheck">查重</el-button>
      </div>
      <el-table v-if="dupSearched" :data="dupHits" stripe size="small">
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ DUPLICATE_SOURCE_LABELS[(row as DuplicateHitVO).source] }}</template>
        </el-table-column>
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <el-button v-if="row.inScope" link type="primary" @click="openHit(row as DuplicateHitVO)">
              {{ row.name ?? '-' }}
            </el-button>
            <span v-else class="text-[var(--el-text-color-secondary)]">不在你的数据范围内</span>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="电话" width="140">
          <template #default="{ row }">{{ row.inScope ? (row.phone ?? '-') : '-' }}</template>
        </el-table-column>
        <el-table-column label="负责人" width="120">
          <template #default="{ row }">{{ row.ownerName ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="公海/池" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.inSea" size="small" type="warning">是</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-if="dupSearched && dupHits.length === 0"
        description="未发现疑似重复"
        :image-size="48"
      />
    </el-card>
  </div>
</template>
