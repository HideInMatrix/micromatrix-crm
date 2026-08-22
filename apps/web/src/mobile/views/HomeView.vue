<script setup lang="ts">
import { CalendarClock } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardSummary, type MobileSummary } from '@/mobile/api'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const summary = ref<MobileSummary | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await dashboardSummary()
    summary.value = data
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bg-[var(--van-primary-color,#1989fa)] text-white px-4 pt-8 pb-12">
      <div class="text-lg font-medium">你好，{{ auth.user?.name || '朋友' }}</div>
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
        <van-cell title="我的跟进计划" is-link @click="router.push('/follow-plans')">
          <template #icon><CalendarClock :size="19" class="mr-2" aria-hidden="true" /></template>
        </van-cell>
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
