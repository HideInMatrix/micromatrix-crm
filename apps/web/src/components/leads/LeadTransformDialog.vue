<script setup lang="ts">
import type { LeadVO } from '@micromatrix/shared'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { leadApi } from '@/api/sales'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ lead: LeadVO | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ success: []; finish: [] }>()

const auth = useAuthStore()
const router = useRouter()
const loading = ref(false)
const successVisible = ref(false)
const countdown = ref(5)
const result = ref<{ customerId: string } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const canTransform = computed(() => auth.hasPerm('customer:create'))

function stopCountdown() {
  if (timer) clearInterval(timer)
  timer = null
}

function startCountdown() {
  stopCountdown()
  countdown.value = 5
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) backToList()
  }, 1000)
}

async function confirm() {
  if (!props.lead) return
  loading.value = true
  try {
    const { data } = await leadApi.transform({
      clueId: props.lead.id,
    })
    result.value = data
    visible.value = false
    successVisible.value = true
    emit('success')
    startCountdown()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function backToList() {
  stopCountdown()
  successVisible.value = false
  emit('finish')
}

function goDetail() {
  stopCountdown()
  successVisible.value = false
  if (result.value?.customerId) {
    router.push(`/customers/${result.value.customerId}`)
  }
}

function openSettings() {
  router.push('/system/modules')
}

onBeforeUnmount(stopCountdown)
</script>

<template>
  <el-dialog
    v-model="visible"
    title="转换线索"
    width="600px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-form label-position="left" label-width="120px">
      <el-form-item label="线索转换为">
        <el-checkbox :model-value="true" disabled>联系人</el-checkbox>
        <el-checkbox :model-value="true" disabled>客户</el-checkbox>
      </el-form-item>

      <div class="rounded-md bg-[var(--el-color-primary-light-9)] px-6 py-4 text-sm leading-7">
        <div class="mb-1 font-medium text-[var(--el-text-color-primary)]">备注</div>
        <div>转换后会创建客户和联系人，并保留原线索数据。</div>
        <div>线索跟进记录会复制到新客户，原线索跟进记录不会删除。</div>
        <div>自定义字段仅按表单联动配置迁移；联系人姓名为空时不会创建联系人。</div>
        <div v-if="auth.hasPerm('system:module')" class="mt-1 flex gap-4">
          <el-button link type="primary" @click="openSettings">客户表单设置</el-button>
          <el-button link type="primary" @click="openSettings">新建联系人表单</el-button>
        </div>
      </div>
    </el-form>

    <template #footer>
      <div class="flex justify-end gap-3">
        <el-button :disabled="loading" @click="visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="loading"
          :disabled="!canTransform"
          @click="confirm"
        >
          转换
        </el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="successVisible"
    title="转换成功"
    width="600px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="py-3 text-center">
      <div
        class="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-[var(--el-color-success)] text-white"
      >
        ✓
      </div>
      <div class="mt-2 text-xl font-medium">转换成功</div>
      <div class="mt-4 text-sm text-[var(--el-text-color-secondary)]">
        <strong class="text-[var(--el-color-primary)]">{{ countdown }}</strong>
        秒后返回线索列表
      </div>
      <div class="mt-4 flex justify-center gap-3">
        <el-button @click="backToList">返回线索列表</el-button>
        <el-button type="primary" @click="goDetail">查看客户详情</el-button>
      </div>
    </div>
  </el-dialog>
</template>
