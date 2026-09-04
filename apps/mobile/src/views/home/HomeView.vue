<script setup lang="ts">
import { CalendarClock } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardSummary, type MobileSummary } from '@/api/mobile'
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
  <div class="crm-mobile-page">
    <div class="bg-[var(--van-primary-color)] px-4 pt-7 pb-12 text-white">
      <div class="text-lg font-medium">你好，{{ auth.user?.name || '朋友' }}</div>
      <div class="mt-1 text-xs opacity-80">微矩阵 CRM · 移动工作台</div>
    </div>

    <div
      class="mx-4 -mt-6 overflow-hidden rounded-[var(--border-radius-medium)] border border-[var(--text-n8)] bg-white"
    >
      <div class="grid grid-cols-3 p-4">
        <button
          type="button"
          class="border-0 bg-transparent text-center"
          @click="router.push('/leads')"
        >
          <div class="text-xl font-semibold text-[var(--text-n1)]">
            {{ summary?.newLeads ?? '-' }}
          </div>
          <div class="mt-1 text-xs text-[var(--text-n4)]">本月新线索</div>
        </button>
        <button
          type="button"
          class="border-0 bg-transparent text-center"
          @click="router.push('/customers')"
        >
          <div class="text-xl font-semibold text-[var(--text-n1)]">
            {{ summary?.newCustomers ?? '-' }}
          </div>
          <div class="mt-1 text-xs text-[var(--text-n4)]">本月新客户</div>
        </button>
        <div class="text-center">
          <div class="text-xl font-semibold text-[var(--text-n1)]">
            {{ summary?.newOpportunities ?? '-' }}
          </div>
          <div class="mt-1 text-xs text-[var(--text-n4)]">本月新商机</div>
        </div>
      </div>
      <div class="grid grid-cols-2 border-t border-[var(--text-n8)] py-3">
        <div class="text-center">
          <div class="text-base font-semibold text-[var(--error-red)]">
            ¥{{ (summary?.wonAmount ?? 0).toLocaleString('zh-CN') }}
          </div>
          <div class="mt-1 text-xs text-[var(--text-n4)]">本月赢单</div>
        </div>
        <div class="border-l border-[var(--text-n8)] text-center">
          <div class="text-base font-semibold text-[var(--success-green)]">
            ¥{{ (summary?.receivedAmount ?? 0).toLocaleString('zh-CN') }}
          </div>
          <div class="mt-1 text-xs text-[var(--text-n4)]">本月回款</div>
        </div>
      </div>
    </div>

    <div class="mx-4 mt-4">
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
          :value-class="summary?.overduePlans ? '!text-[var(--error-red)]' : ''"
        />
      </van-cell-group>
    </div>
  </div>
</template>
