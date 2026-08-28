<script setup lang="ts">
import type { ContactVO, FieldVO, FollowUpVO, OpportunityVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { followUpApi, opportunityApi } from '@/api/sales'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{ opportunityId: string | null }>()
const visible = defineModel<boolean>({ required: true })

const loading = ref(false)
const activeTab = ref('info')
const detail = ref<OpportunityVO | null>(null)
const records = ref<FollowUpVO[]>([])
const contacts = ref<ContactVO[]>([])
const fields = ref<FieldVO[]>([])
const fieldRefs = useFieldRefs()
const customFields = computed(() => fields.value.filter((field) => !field.system && !field.hidden))

async function load() {
  if (!props.opportunityId) return
  loading.value = true
  try {
    const [{ data: opportunity }, { data: followRecords }, { data: contactResult }, { data: fieldRows }] = await Promise.all([
      opportunityApi.get(props.opportunityId),
      followUpApi.list('opportunity', props.opportunityId),
      opportunityApi.contacts(props.opportunityId),
      metadataApi.fields('opportunity'),
      fieldRefs.load(),
    ])
    detail.value = opportunity
    records.value = followRecords
    contacts.value = contactResult.list
    fields.value = fieldRows
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
  { immediate: true },
)
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="detail?.name ?? '商机详情'"
    size="82%"
    destroy-on-close
    data-testid="opportunity-detail-drawer"
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
                <el-descriptions-item label="可能性">{{ detail.possible == null ? '-' : `${detail.possible}%` }}</el-descriptions-item>
                <el-descriptions-item label="结束时间">
                  {{ detail.expectedCloseAt?.slice(0, 10) ?? '-' }}
                </el-descriptions-item>
                <el-descriptions-item label="失败原因">{{ detail.failureReason ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="最近跟进时间">{{ detail.followTime ? new Date(detail.followTime).toLocaleString() : '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
            <el-card v-if="customFields.length" shadow="never">
              <template #header><span>自定义字段</span></template>
              <el-descriptions :column="3" border>
                <el-descriptions-item v-for="field in customFields" :key="field.id" :label="field.label">
                  {{ formatFieldValue(field, detail as unknown as Record<string, unknown>, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="联系人" name="contact">
          <el-empty v-if="contacts.length === 0" description="暂无联系人" />
          <el-table v-else :data="contacts" border>
            <el-table-column prop="name" label="联系人" min-width="160" />
            <el-table-column prop="phone" label="电话" min-width="160" />
            <el-table-column prop="ownerName" label="负责人" min-width="120" />
            <el-table-column label="当前关联" width="100">
              <template #default="{ row }"><el-tag v-if="row.id === detail?.contactId" type="primary" size="small">当前</el-tag></template>
            </el-table-column>
          </el-table>
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
