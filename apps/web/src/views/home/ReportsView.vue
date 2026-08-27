<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  dashboardApi,
  type ConversionData,
  type RankingData,
  type TrendData,
} from '@/api/dashboard'
import { extractErrorMessage } from '@/api/http'
import EChart from '@/components/EChart.vue'

const trend = ref<TrendData | null>(null)
const conversion = ref<ConversionData | null>(null)
const ranking = ref<RankingData | null>(null)
const loading = ref(false)

const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: {
    data: ['赢单金额', '回款金额'],
    top: 0,
    left: 'center',
    itemGap: 24,
  },
  grid: { left: 24, right: 24, top: 48, bottom: 20, containLabel: true },
  xAxis: { type: 'category', data: trend.value?.months ?? [] },
  yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v / 10000}万` } },
  series: [
    { name: '赢单金额', type: 'bar', data: trend.value?.won ?? [], barMaxWidth: 28 },
    { name: '回款金额', type: 'line', smooth: true, data: trend.value?.received ?? [] },
  ],
}))

const lostReasonOption = computed(() => ({
  tooltip: { trigger: 'item' },
  legend: { orient: 'vertical', left: 0, top: 'middle', type: 'scroll' },
  series: [
    {
      type: 'pie',
      radius: ['40%', '68%'],
      center: ['60%', '50%'],
      label: { formatter: '{b}: {c}' },
      data: (conversion.value?.lostReasons ?? []).map((r) => ({ name: r.reason, value: r.count })),
    },
  ],
}))

const receivedRankOption = computed(() => {
  const list = [...(ranking.value?.received ?? [])].reverse()
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
    const [trendRes, conversionRes, rankingRes] = await Promise.all([
      dashboardApi.trend(),
      dashboardApi.conversion(),
      dashboardApi.ranking(),
    ])
    trend.value = trendRes.data
    conversion.value = conversionRes.data
    ranking.value = rankingRes.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div v-loading="loading" class="space-y-4">
    <el-card shadow="never">
      <div class="font-medium mb-2">近 6 个月业绩趋势</div>
      <EChart :option="trendOption" height="340px" />
    </el-card>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <el-card shadow="never">
        <div class="font-medium mb-3">线索转化（近 6 个月）</div>
        <div class="flex items-center justify-around py-6">
          <div class="text-center">
            <div class="text-3xl font-bold">{{ conversion?.totalLeads ?? '-' }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">新增线索</div>
          </div>
          <div class="text-2xl text-[var(--el-text-color-placeholder)]">→</div>
          <div class="text-center">
            <div class="text-3xl font-bold">{{ conversion?.convertedLeads ?? '-' }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">成功转化</div>
          </div>
          <div class="text-center">
            <div class="text-3xl font-bold text-[var(--el-color-primary)]">
              {{ conversion?.conversionRate ?? '-' }}%
            </div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">转化率</div>
          </div>
        </div>
      </el-card>

      <el-card shadow="never">
        <div class="font-medium mb-2">输单原因分布</div>
        <el-empty
          v-if="(conversion?.lostReasons ?? []).length === 0"
          description="暂无输单数据"
          :image-size="60"
        />
        <EChart v-else :option="lostReasonOption" height="280px" />
      </el-card>

      <el-card shadow="never">
        <div class="font-medium mb-2">本月回款排行</div>
        <el-empty
          v-if="(ranking?.received ?? []).length === 0"
          description="本月暂无回款"
          :image-size="60"
        />
        <EChart v-else :option="receivedRankOption" height="280px" />
      </el-card>
    </div>
  </div>
</template>
