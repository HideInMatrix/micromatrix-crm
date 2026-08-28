<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  batchMoveCustomersToPool,
  moveCustomerToPool,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import { dictionaryApi, type DictionaryItemVO } from '@/api/system'

const props = defineProps<{
  customerIds: string[]
  customerName?: string
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ moved: [] }>()

const loading = ref(false)
const saving = ref(false)
const pools = ref<ResourcePoolVO[]>([])
const reasons = ref<DictionaryItemVO[]>([])
const reasonEnabled = ref(false)
const poolId = ref('')
const reasonId = ref('')

const title = computed(() =>
  props.customerIds.length > 1
    ? `批量移入客户公海（${props.customerIds.length}）`
    : `移入客户公海${props.customerName ? `（${props.customerName}）` : ''}`,
)

async function load() {
  loading.value = true
  try {
    const [{ data: poolRows }, { data: reasonConfig }] = await Promise.all([
      resourcePoolApi.options('customer'),
      dictionaryApi.config('CUSTOMER_POOL_RS'),
    ])
    pools.value = poolRows
    reasons.value = reasonConfig.dictList.filter((item) => item.id !== 'system')
    reasonEnabled.value = reasonConfig.enable
    if (!poolRows.some((item) => item.id === poolId.value)) {
      poolId.value = poolRows[0]?.id ?? ''
    }
    if (!reasons.value.some((item) => item.id === reasonId.value)) reasonId.value = ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!props.customerIds.length) return
  if (!poolId.value) return ElMessage.warning('请选择客户公海')
  if (reasonEnabled.value && !reasonId.value) return ElMessage.warning('请选择移入公海原因')
  saving.value = true
  try {
    if (props.customerIds.length === 1) {
      await moveCustomerToPool(props.customerIds[0]!, poolId.value, reasonId.value || undefined)
      ElMessage.success('已移入客户公海')
    } else {
      const { data } = await batchMoveCustomersToPool(
        props.customerIds,
        poolId.value,
        reasonId.value || undefined,
      )
      if (data.fail > 0) {
        ElMessage.warning(`移入完成：成功 ${data.success} 个，失败 ${data.fail} 个`)
      } else {
        ElMessage.success(`已批量移入 ${data.success} 个客户`)
      }
    }
    visible.value = false
    emit('moved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, (open) => {
  if (!open) return
  poolId.value = ''
  reasonId.value = ''
  void load()
})
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="520px"
    destroy-on-close
    :close-on-click-modal="false"
    data-testid="customer-move-to-pool-dialog"
  >
    <div v-loading="loading">
      <el-alert
        class="mb-4"
        type="warning"
        :closable="false"
        title="移入公海后客户负责人会被清空，并按目标公海的领取、库容与自动回收规则管理。"
      />
      <el-form label-width="110px">
        <el-form-item label="客户公海" required>
          <el-select v-model="poolId" class="w-full" placeholder="请选择客户公海">
            <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="reasonEnabled" label="移入原因" required>
          <el-select v-model="reasonId" class="w-full" placeholder="请选择移入公海原因">
            <el-option
              v-for="reason in reasons"
              :key="reason.id"
              :label="reason.name"
              :value="reason.id"
            />
          </el-select>
          <div v-if="reasons.length === 0" class="mt-1 text-xs text-[var(--el-color-danger)]">
            当前已启用移入公海原因，但没有可选原因，请先到模块设置中维护。
          </div>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="loading || !poolId || (reasonEnabled && !reasonId)"
        @click="submit"
      >
        确认移入
      </el-button>
    </template>
  </el-dialog>
</template>
