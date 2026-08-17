<script setup lang="ts">
import type { FollowUpVO, OpportunityVO } from '@micromatrix/shared'
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { followUpApi, opportunityApi } from '@/api/sales'

const props = defineProps<{ opportunityId: string | null }>()
const visible = defineModel<boolean>({ required: true })

const loading = ref(false)
const activeTab = ref('info')
const detail = ref<OpportunityVO | null>(null)
const records = ref<FollowUpVO[]>([])

async function load() {
  if (!props.opportunityId) return
  loading.value = true
  try {
    const [{ data: opportunity }, { data: followRecords }] = await Promise.all([
      opportunityApi.get(props.opportunityId),
      followUpApi.list('opportunity', props.opportunityId),
    ])
    detail.value = opportunity
    records.value = followRecords
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    visible.value = false
  } finally {
    loading.value = false
  }
}

watch(
  [visible, () => props.opportunityId],
  ([open]) => {
    if (open) {
      activeTab.value = 'info'
      load()
    }
  },
)
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="detail?.name ?? '商机详情'"
    size="82%"
    destroy-on-close
  >
    <div v-loading="loading" class="h-full">
      <el-tabs v-model="activeTab" class="h-full">
        <el-tab-pane label="详情" name="info">
          <div v-if="detail" class="space-y-4">
            <el-card shadow="never">
              <el-descriptions :column="3" border>
                <el-descriptions-item label="商机名称">{{ detail.name }}</el-descriptions-item>
                <el-descriptions-item label="阶段">{{ detail.stageName ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="负责人">{{ detail.ownerName ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="客户">{{ detail.customerName ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="联系人">{{ detail.contactName ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="预计金额">
                  {{ detail.amount === null ? '-' : `¥${Number(detail.amount).toLocaleString('zh-CN')}` }}
                </el-descriptions-item>
                <el-descriptions-item label="预计成交日期">
                  {{ detail.expectedCloseAt?.slice(0, 10) ?? '-' }}
                </el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{ detail.remark ?? '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="联系人" name="contact">
          <el-empty v-if="!detail?.contactId" description="暂无关联联系人" />
          <el-card v-else shadow="never">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="联系人">{{ detail.contactName ?? '-' }}</el-descriptions-item>
              <el-descriptions-item label="联系人 ID">{{ detail.contactId }}</el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="跟进记录" name="record">
          <el-empty v-if="records.length === 0" description="暂无跟进记录" />
          <el-timeline v-else class="pt-4">
            <el-timeline-item
              v-for="record in records"
              :key="record.id"
              :timestamp="new Date(record.createdAt).toLocaleString()"
            >
              <div class="font-medium">{{ record.type }} · {{ record.ownerName }}</div>
              <div class="mt-1 text-[var(--el-text-color-secondary)]">{{ record.content }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-drawer>
</template>
