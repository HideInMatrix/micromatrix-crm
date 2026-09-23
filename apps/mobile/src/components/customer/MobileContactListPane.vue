<script setup lang="ts">
import { isCustomFieldKey, type ContactVO, type FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { showFailToast } from 'vant'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { contactApi } from '@/api/sales'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import { fetchFields } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()

const keyword = ref('')
const items = ref<ContactVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeView = ref<'ALL' | 'SELF' | 'DEPT'>('ALL')
const viewButtons = [
  { value: 'ALL' as const, label: '全部联系人' },
  { value: 'SELF' as const, label: '我的联系人' },
  { value: 'DEPT' as const, label: '部门联系人' },
]

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
      scopeView: activeView.value,
    })
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

async function handleRefresh() {
  page.value = 1
  items.value = []
  finished.value = false
  try {
    await loadMore()
  } finally {
    refreshing.value = false
  }
}

function setView(value: typeof activeView.value) {
  if (activeView.value === value) return
  activeView.value = value
  reload()
}

async function copyPhone(phone: string) {
  try {
    await navigator.clipboard.writeText(phone)
    showSuccessFeedback('手机号已复制')
  } catch {
    showFailToast('当前环境不支持复制')
  }
}

async function removeContact(item: ContactVO) {
  const confirmed = await showActionConfirm({
    title: '删除联系人',
    message: `确认删除「${item.name}」？`,
    confirmButtonText: '删除',
  })
  if (!confirmed) return
  try {
    await contactApi.remove(item.id)
    showSuccessFeedback('联系人已删除')
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
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
    showSuccessFeedback('联系人已创建')
    createShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

defineExpose({ reload })

onMounted(() => {
  if (route.query.create === 'contact') void openCreate()
})
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div
      class="flex items-center gap-3 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 py-2"
    >
      <van-button
        v-if="auth.hasPerm('contact:create')"
        plain
        icon="plus"
        type="primary"
        size="small"
        @click="openCreate"
      />
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入联系人名称或手机号"
        class="min-w-0 flex-1 !p-0"
        @search="reload"
        @clear="reload"
      />
    </div>
    <div
      class="flex min-h-12 gap-2 overflow-x-auto whitespace-nowrap border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-1 py-2"
    >
      <van-button
        v-for="button in viewButtons"
        :key="button.value"
        round
        size="small"
        class="!border-none !px-4 !py-1 !text-sm"
        :class="
          activeView === button.value
            ? '!bg-[var(--primary-7)] !text-[var(--primary-8)]'
            : '!bg-[var(--text-n9)] !text-[var(--text-n1)]'
        "
        @click="setView(button.value)"
      >
        {{ button.label }}
      </van-button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <van-pull-refresh
        v-model="refreshing"
        class="min-h-full"
        @refresh="handleRefresh"
      >
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="已经到底部啦~"
          class="flex flex-col gap-4 p-4"
          @load="loadMore"
        >
          <div
            v-for="item in items"
            :key="item.id"
            class="flex w-full items-center gap-4 overflow-hidden rounded-[6px] bg-white p-4"
          >
            <div class="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[var(--text-n9)] text-xl text-[var(--text-n2)]">
              {{ item.name?.slice(0, 1) || '?' }}
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="truncate text-base text-[var(--text-n1)]">{{ item.name }}</div>
                  <van-tag
                    v-if="item.enable !== false"
                    color="var(--success-5)"
                    text-color="var(--success-green)"
                    class="rounded-[6px] !px-2 !py-0.5"
                  >正常</van-tag>
                  <van-tag v-else type="warning" plain>已停用</van-tag>
                </div>
                <van-button
                  v-if="auth.hasPerm('contact:delete')"
                  icon="delete-o"
                  size="small"
                  type="danger"
                  plain
                  class="!border-0 !px-1"
                  @click.stop="removeContact(item)"
                />
              </div>
              <div class="flex items-center gap-1 text-xs text-[var(--primary-8)]">
                <a v-if="item.phone" :href="'tel:' + item.phone" class="flex items-center gap-1" @click.stop>
                  <van-icon name="phone-o" size="15" />
                  <span>{{ item.phone }}</span>
                </a>
                <van-icon v-if="item.phone" name="description-o" size="14" @click.stop="copyPhone(item.phone)" />
              </div>
            </div>
          </div>
        </van-list>
      </van-pull-refresh>
    </div>

    <van-popup v-model:show="createShow" position="bottom" round class="h-[88%]">
      <div class="flex h-full flex-col bg-[var(--text-n10)]">
        <div
          class="flex min-h-12 items-center justify-center border-b-[0.5px] border-[var(--text-n8)] px-4 text-base font-medium text-[var(--text-n1)]"
        >
          新建联系人
        </div>
        <div class="min-h-0 flex-1 overflow-auto py-4">
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
        <div
          class="flex gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
        >
          <van-button block @click="createShow = false">取消</van-button>
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
