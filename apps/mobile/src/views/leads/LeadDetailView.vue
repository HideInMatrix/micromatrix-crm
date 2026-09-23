<script setup lang="ts">
import type { FieldVO, FollowUpVO, LeadVO, OwnerHistoryVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { fetchFields, pageFollowUps } from '@/api/mobile'
import { leadApi } from '@/api/sales'
import { formatFieldValue } from '@/components/form-engine/field-display'
import MobileFollowUpPlanList from '@/components/MobileFollowUpPlanList.vue'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'

type DetailTab = 'info' | 'record' | 'plan' | 'header'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const activeTab = ref<DetailTab>('info')
const loading = ref(false)
const lead = ref<LeadVO | null>(null)
const fields = ref<FieldVO[]>([])
const records = ref<FollowUpVO[]>([])
const ownerHistory = ref<OwnerHistoryVO[]>([])
const followShow = ref(false)
const moreShow = ref(false)

const leadId = computed(() => String(route.query.id ?? ''))
const poolSource = computed(() => route.name === 'mobile-lead-pool-detail')
const canWrite = computed(() => !poolSource.value && auth.hasPerm('lead:update'))
const descriptionFields = computed(() =>
  fields.value.filter((field) => !field.hidden && field.mobile !== false),
)
const detailTabs = computed<{ name: DetailTab; title: string }[]>(() =>
  poolSource.value
    ? [
        { name: 'info', title: '线索信息' },
        { name: 'record', title: '跟进记录' },
        { name: 'header', title: '负责人记录' },
      ]
    : [
        { name: 'info', title: '线索信息' },
        { name: 'record', title: '跟进记录' },
        { name: 'plan', title: '跟进计划' },
        { name: 'header', title: '负责人记录' },
      ],
)

function displayField(field: FieldVO) {
  if (!lead.value) return '-'
  return formatFieldValue(field, lead.value as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

async function load() {
  if (!leadId.value) {
    router.replace('/leads')
    return
  }

  loading.value = true
  try {
    const [detailRes, fieldRes, followRes, historyRes] = await Promise.all([
      leadApi.get(leadId.value, poolSource.value),
      fetchFields('lead'),
      pageFollowUps('lead', leadId.value),
      leadApi.ownerHistory(leadId.value),
      fieldRefs.load(),
    ])
    lead.value = detailRes.data
    fields.value = fieldRes.data
    records.value = followRes.data.items
    ownerHistory.value = historyRes.data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace('/leads')
  } finally {
    loading.value = false
  }
}

async function reloadRecords() {
  try {
    const { data } = await pageFollowUps('lead', leadId.value)
    records.value = data.items
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function goEdit() {
  router.push('/leads/' + leadId.value + '/edit')
}

function goConvert() {
  moreShow.value = false
  router.push('/leads/' + leadId.value + '/convert')
}

async function removeLead() {
  moreShow.value = false
  const confirmed = await showActionConfirm({
    title: '删除线索',
    message: '确认删除「' + (lead.value?.name ?? '') + '」？',
    confirmButtonText: '删除',
  })
  if (!confirmed) return

  try {
    await leadApi.remove(leadId.value)
    showSuccessFeedback('线索已删除')
    router.replace('/leads')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <van-loading v-if="loading" class="!flex !justify-center !py-16" />
    <template v-else-if="lead">
      <van-tabs
        v-model:active="activeTab"
        border
        class="min-h-0 flex-1 [&_.van-tabs__content]:h-full [&_.van-tabs__content]:overflow-hidden [&_.van-tab__panel]:h-full"
      >
        <van-tab
          v-for="tab in detailTabs"
          :key="tab.name"
          :name="tab.name"
          :title="tab.title"
        >
          <div class="h-full overflow-auto pb-4">
            <template v-if="tab.name === 'info'">
              <van-cell-group inset class="!mt-4">
                <van-cell
                  v-for="field in descriptionFields"
                  :key="field.id"
                  :title="field.label"
                  :value="displayField(field)"
                />
              </van-cell-group>
            </template>

            <template v-else-if="tab.name === 'record'">
              <div v-if="canWrite" class="px-4 pt-3">
                <van-button
                  type="primary"
                  plain
                  block
                  size="small"
                  @click="followShow = true"
                >
                  新增跟进
                </van-button>
              </div>
              <van-empty v-if="records.length === 0" description="暂无跟进记录" />
              <van-cell-group
                v-for="record in records"
                :key="record.id"
                inset
                class="!mt-3"
              >
                <van-cell :title="record.type ?? '其他'" :label="record.content">
                  <template #value>
                    {{ new Date(record.createdAt).toLocaleDateString('zh-CN') }}
                  </template>
                </van-cell>
              </van-cell-group>
            </template>

            <MobileFollowUpPlanList
              v-else-if="tab.name === 'plan'"
              target-type="lead"
              :target-id="leadId"
              :target-name="lead.name"
              :can-write="canWrite"
            />

            <template v-else-if="tab.name === 'header'">
              <van-empty v-if="ownerHistory.length === 0" description="暂无负责人记录" />
              <van-cell-group
                v-for="item in ownerHistory"
                :key="item.id"
                inset
                class="!mt-3"
              >
                <van-cell
                  :title="item.ownerName ?? '未知负责人'"
                  :value="item.departmentName ?? '-'"
                />
                <van-cell
                  title="归属开始"
                  :value="item.collectedAt ? new Date(item.collectedAt).toLocaleString() : '-'"
                />
                <van-cell title="归属结束" :value="new Date(item.endedAt).toLocaleString()" />
                <van-cell title="回收原因" :value="item.reasonName ?? '-'" />
                <van-cell title="操作人" :value="item.operatorName ?? '-'" />
              </van-cell-group>
            </template>
          </div>
        </van-tab>
      </van-tabs>

      <div
        v-if="
          !poolSource &&
          activeTab === 'info' &&
          (auth.hasPerm('lead:update') || auth.hasPerm('lead:delete'))
        "
        class="flex shrink-0 gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
      >
        <van-button v-if="auth.hasPerm('lead:update')" block type="primary" @click="goEdit">
          编辑
        </van-button>
        <van-button
          v-if="auth.hasPerm('lead:update') || auth.hasPerm('lead:delete')"
          block
          plain
          @click="moreShow = true"
        >
          更多
        </van-button>
      </div>
    </template>

    <MobileFollowUpSheet
      v-model="followShow"
      target-type="lead"
      :target-id="leadId"
      :target-name="lead?.name"
      @followed="reloadRecords"
    />

    <van-action-sheet v-model:show="moreShow" title="更多操作">
      <div class="space-y-3 p-4">
        <van-button
          v-if="
            auth.hasPerm('lead:update') &&
            !['CUSTOMER', 'OPPORTUNITY'].includes(lead?.transitionType ?? '')
          "
          block
          @click="goConvert"
        >
          转换
        </van-button>
        <van-button
          v-if="auth.hasPerm('lead:delete')"
          block
          type="danger"
          plain
          @click="removeLead"
        >
          删除
        </van-button>
      </div>
    </van-action-sheet>
  </div>
</template>
