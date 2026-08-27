<script setup lang="ts">
import {
  LEAD_STATUS_LABELS,
  isCustomFieldKey,
  type FieldVO,
  type LeadVO,
} from '@micromatrix/shared'
import { showFailToast, showSuccessToast } from 'vant'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { claimLead, createLead, fetchFields, listLeads } from '@/api/mobile'
import { extractErrorMessage } from '@/api/http'
import { leadApi } from '@/api/sales'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'

const router = useRouter()

const activeTab = ref<'mine' | 'pool'>('mine')
const items = ref<LeadVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const keyword = ref('')
const selectedPoolId = ref('')

const followShow = ref(false)
const followTarget = ref<LeadVO | null>(null)

const createShow = ref(false)
const fields = ref<FieldVO[]>([])
const formModel = ref<Record<string, unknown>>({})
const saving = ref(false)

async function loadMore() {
  loading.value = true
  try {
    if (activeTab.value === 'pool' && !selectedPoolId.value) {
      const { data } = await leadApi.poolOptions()
      selectedPoolId.value = data[0]?.id ?? ''
      if (!selectedPoolId.value) {
        finished.value = true
        return
      }
    }
    const { data } = await listLeads({
      page: page.value,
      pageSize: 20,
      scope: activeTab.value,
      poolId: activeTab.value === 'pool' ? selectedPoolId.value : undefined,
      keyword: keyword.value.trim() || undefined,
    })
    if (refreshing.value) {
      items.value = []
      refreshing.value = false
    }
    items.value.push(...data.items)
    finished.value = items.value.length >= data.total
    page.value += 1
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    finished.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  items.value = []
  finished.value = false
  loadMore()
}

async function handleClaim(lead: LeadVO) {
  try {
    const poolId = lead.poolId ?? selectedPoolId.value
    if (!poolId) throw new Error('请选择线索池')
    await claimLead(lead.id, poolId)
    showSuccessToast('已领取')
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function openFollow(lead: LeadVO) {
  followTarget.value = lead
  followShow.value = true
}

function openConvert(lead: LeadVO) {
  router.push(`/leads/${lead.id}/convert`)
}

async function openCreate() {
  if (fields.value.length === 0) {
    const { data } = await fetchFields('lead')
    fields.value = data
  }
  formModel.value = {}
  createShow.value = true
}

async function handleCreate() {
  const nameField = formModel.value.name
  if (!nameField || String(nameField).trim() === '') {
    showFailToast('请填写线索名称')
    return
  }
  saving.value = true
  try {
    const payload: Record<string, unknown> = { moduleFields: [] }
    const fieldMap = new Map(fields.value.map((field) => [field.key, field]))
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      const field = fieldMap.get(key)
      if (isCustomFieldKey(key)) {
        if (!field) continue
        ;(payload.moduleFields as Array<{ fieldId: string; fieldValue: unknown }>).push({
          fieldId: field.id,
          fieldValue: value,
        })
      } else if (key === 'owner') payload.owner = value
      else if (key === 'contact') payload.contact = value
      else payload[key] = value
    }
    await createLead(payload)
    showSuccessToast('线索已创建')
    createShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

onMounted(() => undefined)
</script>

<template>
  <div class="min-h-full">
    <van-nav-bar title="线索" fixed placeholder>
      <template #right>
        <span
          v-if="activeTab === 'mine'"
          class="text-sm text-[var(--van-primary-color,#1989fa)]"
          @click="openCreate"
          >新建</span
        >
      </template>
    </van-nav-bar>

    <van-tabs v-model:active="activeTab" @change="reload">
      <van-tab title="我的线索" name="mine" />
      <van-tab title="线索池" name="pool" />
    </van-tabs>

    <van-search
      v-model="keyword"
      placeholder="搜索名称 / 联系人 / 电话"
      @search="reload"
      @clear="reload"
    />

    <van-pull-refresh v-model="refreshing" @refresh="reload">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="没有更多了"
        @load="loadMore"
      >
        <van-cell-group v-for="lead in items" :key="lead.id" inset class="!mb-3">
          <van-cell :title="lead.name">
            <template #label>
              <div class="text-xs">
                {{ lead.contactName ?? '无联系人' }} · {{ lead.phone ?? '无电话' }}
              </div>
            </template>
            <template #value>
              <van-tag
                :type="
                  lead.status === 'SUCCESS'
                    ? 'success'
                    : lead.status === 'FAIL'
                      ? 'default'
                      : 'primary'
                "
                size="medium"
              >
                {{ LEAD_STATUS_LABELS[lead.status] }}
              </van-tag>
            </template>
          </van-cell>
          <van-cell>
            <template #title>
              <span class="text-xs text-gray-400">
                {{
                  lead.lastFollowedAt
                    ? `最近跟进 ${new Date(lead.lastFollowedAt).toLocaleDateString()}`
                    : '尚未跟进'
                }}
              </span>
            </template>
            <template #value>
              <van-button
                v-if="activeTab === 'pool'"
                size="small"
                type="primary"
                @click="handleClaim(lead)"
              >
                领取
              </van-button>
              <div v-else-if="lead.status === 'FOLLOWING'" class="flex gap-2">
                <van-button size="small" plain type="primary" @click="openFollow(lead)">
                  跟进
                </van-button>
                <van-button size="small" type="primary" @click="openConvert(lead)">
                  转换
                </van-button>
              </div>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <MobileFollowUpSheet
      v-model="followShow"
      target-type="lead"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="reload"
    />

    <van-popup v-model:show="createShow" position="bottom" round :style="{ height: '85%' }">
      <div class="p-4">
        <div class="text-center font-medium mb-3">新建线索</div>
        <MobileDynamicForm v-model="formModel" :fields="fields" />
        <div class="px-4 mt-4">
          <van-button type="primary" block :loading="saving" @click="handleCreate">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
