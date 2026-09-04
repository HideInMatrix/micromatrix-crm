<script setup lang="ts">
import { isCustomFieldKey, type ContactVO, type FieldVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { contactApi } from '@/api/sales'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import { fetchFields } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const keyword = ref('')
const items = ref<ContactVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)

const createShow = ref(false)
const customerPickerShow = ref(false)
const fields = ref<FieldVO[]>([])
const formModel = ref<Record<string, unknown>>({})
const customerId = ref('')
const customerOptions = ref<{ id: string; name: string }[]>([])
const saving = ref(false)

const editableFields = computed(() =>
  fields.value.filter(
    (field) => field.key === 'name' || field.key === 'phone' || isCustomFieldKey(field.key),
  ),
)
const customerColumns = computed(() =>
  customerOptions.value.map((item) => ({ text: item.name, value: item.id })),
)
const selectedCustomerName = computed(
  () => customerOptions.value.find((item) => item.id === customerId.value)?.name ?? '',
)

async function loadMore() {
  loading.value = true
  try {
    const { data } = await contactApi.page({
      page: page.value,
      pageSize: 20,
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

async function openCreate() {
  try {
    if (fields.value.length === 0) {
      const [{ data: fieldList }, { data: customers }] = await Promise.all([
        fetchFields('contact'),
        listCustomerOptions(),
      ])
      fields.value = fieldList
      customerOptions.value = customers
    } else if (customerOptions.value.length === 0) {
      const { data } = await listCustomerOptions()
      customerOptions.value = data
    }
    customerId.value = ''
    formModel.value = {}
    createShow.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function selectCustomer({ selectedValues }: { selectedValues: string[] }) {
  customerId.value = selectedValues[0] ?? ''
  customerPickerShow.value = false
}

async function handleCreate() {
  if (!customerId.value) {
    showFailToast('请选择所属客户')
    return
  }
  const name = String(formModel.value.name ?? '').trim()
  if (!name) {
    showFailToast('请填写联系人姓名')
    return
  }

  const customData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(formModel.value)) {
    if (!isCustomFieldKey(key) || value === undefined || value === '') continue
    customData[key] = value
  }

  saving.value = true
  try {
    await contactApi.create({
      customerId: customerId.value,
      name,
      phone: formModel.value.phone ? String(formModel.value.phone) : undefined,
      customData,
    })
    showSuccessToast('联系人已创建')
    createShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

defineExpose({ reload })
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div class="bg-white px-3 pt-2">
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="搜索联系人 / 电话"
        @search="reload"
        @clear="reload"
      />
      <div v-if="auth.hasPerm('contact:create')" class="px-3 pb-2">
        <van-button type="primary" plain block size="small" @click="openCreate"
          >新建联系人</van-button
        >
      </div>
    </div>

    <van-pull-refresh v-model="refreshing" class="flex-1 overflow-auto" @refresh="reload">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="没有更多了"
        @load="loadMore"
      >
        <van-cell-group v-for="item in items" :key="item.id" inset class="crm-mobile-list-card">
          <van-cell :title="item.name" :label="item.customerName ?? '未关联客户'">
            <template #value>
              <van-tag v-if="!item.enable" type="warning" plain>已停用</van-tag>
              <span v-else class="text-xs">{{ item.ownerName ?? '-' }}</span>
            </template>
          </van-cell>
          <van-cell title="联系电话" :value="item.phone || '-'">
            <template v-if="item.phone" #right-icon>
              <a :href="`tel:${item.phone}`" class="ml-2 text-[var(--van-primary-color)]">拨打</a>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <van-popup v-model:show="createShow" position="bottom" round :style="{ height: '88%' }">
      <div class="h-full flex flex-col">
        <div class="p-4 text-center font-medium">新建联系人</div>
        <div class="flex-1 overflow-auto">
          <van-cell-group inset class="!mb-3">
            <van-cell
              title="所属客户"
              :value="selectedCustomerName || '请选择'"
              is-link
              @click="customerPickerShow = true"
            />
          </van-cell-group>
          <MobileDynamicForm v-model="formModel" :fields="editableFields" />
        </div>
        <div class="p-4">
          <van-button type="primary" block :loading="saving" @click="handleCreate">保存</van-button>
        </div>
      </div>
    </van-popup>

    <van-popup v-model:show="customerPickerShow" position="bottom" round>
      <van-picker
        :columns="customerColumns"
        @confirm="selectCustomer"
        @cancel="customerPickerShow = false"
      />
    </van-popup>
  </div>
</template>
