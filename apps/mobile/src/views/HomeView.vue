<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardSummary, fetchMe, type MobileSummary } from '@/api'

const router = useRouter()
const summary = ref<MobileSummary | null>(null)
const userName = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const [{ data }, { data: me }] = await Promise.all([dashboardSummary(), fetchMe()])
    summary.value = data
    userName.value = me.name
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bg-[var(--van-primary-color,#1989fa)] text-white px-4 pt-8 pb-12">
      <div class="text-lg font-medium">你好，{{ userName || '朋友' }}</div>
      <div class="text-xs opacity-80 mt-1">微矩阵 CRM · 移动工作台</div>
    </div>

    <div class="mx-3 -mt-6 rounded-lg bg-white shadow-sm p-4 grid grid-cols-3 gap-y-4">
      <div class="text-center" @click="router.push('/leads')">
        <div class="text-xl font-bold">{{ summary?.newLeads ?? '-' }}</div>
        <div class="text-xs text-gray-500 mt-1">本月新线索</div>
      </div>
      <div class="text-center" @click="router.push('/customers')">
        <div class="text-xl font-bold">{{ summary?.newCustomers ?? '-' }}</div>
        <div class="text-xs text-gray-500 mt-1">本月新客户</div>
      </div>
      <div class="text-center">
        <div class="text-xl font-bold">{{ summary?.newOpportunities ?? '-' }}</div>
        <div class="text-xs text-gray-500 mt-1">本月新商机</div>
      </div>
      <div class="text-center col-span-1.5" style="grid-column: span 1.5">
        <div class="text-lg font-bold text-[#ee0a24]">
          ¥{{ (summary?.wonAmount ?? 0).toLocaleString('zh-CN') }}
        </div>
        <div class="text-xs text-gray-500 mt-1">本月赢单</div>
      </div>
      <div class="text-center" style="grid-column: span 2">
        <div class="text-lg font-bold text-[#07c160]">
          ¥{{ (summary?.receivedAmount ?? 0).toLocaleString('zh-CN') }}
        </div>
        <div class="text-xs text-gray-500 mt-1">本月回款</div>
      </div>
    </div>

    <div class="mx-3 mt-3">
      <van-cell-group inset>
        <van-cell
          title="待我审批"
          is-link
          :value="summary?.pendingApprovals ? `${summary.pendingApprovals} 条` : '无'"
          @click="router.push('/approvals')"
        />
        <van-cell
          title="近期待跟进"
          is-link
          :value="summary?.upcomingFollows ? `${summary.upcomingFollows} 条` : '无'"
          @click="router.push('/customers')"
        />
        <van-cell
          title="逾期回款计划"
          :value="summary?.overduePlans ? `${summary.overduePlans} 条` : '无'"
          :value-class="summary?.overduePlans ? '!text-[#ee0a24]' : ''"
        />
      </van-cell-group>
    </div>
  </div>
</template>
