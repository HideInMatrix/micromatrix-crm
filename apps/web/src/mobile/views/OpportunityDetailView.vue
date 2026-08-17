<script setup lang="ts">
import type { FollowUpVO, OpportunityVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { getOpportunity, listFollowUps } from '@/mobile/api'

const route = useRoute()
const router = useRouter()
const activeTab = ref('info')
const loading = ref(false)
const opportunity = ref<OpportunityVO | null>(null)
const records = ref<FollowUpVO[]>([])

const opportunityId = computed(() => String(route.query.id ?? ''))

async function load() {
  if (!opportunityId.value) {
    router.replace('/leads')
    return
  }
  loading.value = true
  try {
    const [{ data: detail }, { data: followList }] = await Promise.all([
      getOpportunity(opportunityId.value),
      listFollowUps('opportunity', opportunityId.value),
    ])
    opportunity.value = detail
    records.value = followList
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace('/leads')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-screen bg-[#f7f8fa]">
    <van-nav-bar :title="opportunity?.name ?? '商机详情'" left-arrow fixed placeholder @click-left="router.back()" />
    <van-tabs v-model:active="activeTab" sticky :offset-top="46">
      <van-tab title="详情" name="info">
        <van-loading v-if="loading" class="py-12 text-center" />
        <van-cell-group v-else-if="opportunity" inset class="!mt-4 !mb-4">
          <van-cell title="商机名称" :value="opportunity.name" />
          <van-cell title="阶段" :value="opportunity.stageName ?? '-'" />
          <van-cell title="客户" :value="opportunity.customerName ?? '-'" />
          <van-cell title="联系人" :value="opportunity.contactName ?? '-'" />
          <van-cell title="负责人" :value="opportunity.ownerName ?? '-'" />
          <van-cell
            title="预计金额"
            :value="opportunity.amount === null ? '-' : `¥${Number(opportunity.amount).toLocaleString()}`"
          />
          <van-cell title="预计成交日期" :value="opportunity.expectedCloseAt?.slice(0, 10) ?? '-'" />
          <van-cell title="备注" :value="opportunity.remark ?? '-'" />
        </van-cell-group>
      </van-tab>

      <van-tab title="联系人" name="contact">
        <van-empty v-if="!opportunity?.contactId" description="暂无关联联系人" />
        <van-cell-group v-else inset class="!mt-4">
          <van-cell title="联系人" :value="opportunity.contactName ?? opportunity.contactId" />
        </van-cell-group>
      </van-tab>

      <van-tab title="跟进记录" name="record">
        <van-empty v-if="records.length === 0" description="暂无跟进记录" />
        <van-cell-group v-for="record in records" :key="record.id" inset class="!mt-3">
          <van-cell :title="record.type" :label="record.content">
            <template #value>{{ new Date(record.createdAt).toLocaleDateString() }}</template>
          </van-cell>
        </van-cell-group>
      </van-tab>
    </van-tabs>
  </div>
</template>
