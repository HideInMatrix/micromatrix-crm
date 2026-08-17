<script setup lang="ts">
import type { ContactVO, CustomerVO, FieldVO, FollowUpVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import {
  fetchFields,
  getCustomer,
  listCustomerContacts,
  listFollowUps,
} from '@/mobile/api'

const route = useRoute()
const router = useRouter()
const activeTab = ref('info')
const loading = ref(false)
const customer = ref<CustomerVO | null>(null)
const fields = ref<FieldVO[]>([])
const contacts = ref<ContactVO[]>([])
const records = ref<FollowUpVO[]>([])

const customerId = computed(() => String(route.query.id ?? ''))
const customFields = computed(() =>
  fields.value.filter((field) => field.key.startsWith('cf_') && !field.hidden),
)

function customValue(field: FieldVO) {
  const value = customer.value?.customData?.[field.key]
  if (value === undefined || value === null || value === '') return '-'
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

async function load() {
  if (!customerId.value) {
    router.replace('/customers')
    return
  }
  loading.value = true
  try {
    const [{ data: detail }, { data: fieldList }] = await Promise.all([
      getCustomer(customerId.value),
      fetchFields('customer'),
    ])
    customer.value = detail
    fields.value = fieldList
    const [{ data: contactList }, { data: followList }] = await Promise.all([
      listCustomerContacts(customerId.value),
      listFollowUps('customer', customerId.value),
    ])
    contacts.value = contactList
    records.value = followList
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace('/customers')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-screen bg-[#f7f8fa]">
    <van-nav-bar :title="customer?.name ?? '客户详情'" left-arrow fixed placeholder @click-left="router.back()" />
    <van-tabs v-model:active="activeTab" sticky :offset-top="46">
      <van-tab title="详情" name="info">
        <van-loading v-if="loading" class="py-12 text-center" />
        <template v-else-if="customer">
          <van-cell-group inset class="!mt-4">
            <van-cell title="客户名称" :value="customer.name" />
            <van-cell title="负责人" :value="customer.ownerName ?? '-'" />
            <van-cell title="行业" :value="customer.industry ?? '-'" />
            <van-cell title="电话" :value="customer.phone ?? '-'" />
            <van-cell title="邮箱" :value="customer.email ?? '-'" />
            <van-cell title="备注" :value="customer.remark ?? '-'" />
            <van-cell
              title="最近跟进"
              :value="customer.lastFollowedAt ? new Date(customer.lastFollowedAt).toLocaleString() : '-'"
            />
          </van-cell-group>
          <van-cell-group v-if="customFields.length" inset class="!mt-4 !mb-4">
            <van-cell
              v-for="field in customFields"
              :key="field.id"
              :title="field.label"
              :value="customValue(field)"
            />
          </van-cell-group>
        </template>
      </van-tab>

      <van-tab title="联系人" name="contact">
        <van-empty v-if="contacts.length === 0" description="暂无联系人" />
        <van-cell-group v-for="contact in contacts" :key="contact.id" inset class="!mt-3">
          <van-cell :title="contact.name" :label="contact.phone ?? '未填写电话'">
            <template #value>{{ contact.ownerName ?? '-' }}</template>
          </van-cell>
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
