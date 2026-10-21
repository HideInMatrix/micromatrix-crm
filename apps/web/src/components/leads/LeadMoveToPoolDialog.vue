<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import CrmInfoAlert from '@/components/CrmInfoAlert.vue'
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { leadApi, type ResourcePoolVO } from '@/api/sales'
import { dictionaryApi, type DictionaryItemVO } from '@/api/system'

defineProps<{ title?: string; description?: string }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ confirm: [poolId?: string, reasonId?: string] }>()
const loading = ref(false)
const enabled = ref(false)
const reasons = ref<DictionaryItemVO[]>([])
const pools = ref<ResourcePoolVO[]>([])
const reasonId = ref('')
const selectedPoolId = ref('__auto__')
let loadGeneration = 0

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  selectedPoolId.value = '__auto__'
  reasonId.value = ''
  pools.value = []
  try {
    const [{ data: poolRows }, { data: reasonConfig }] = await Promise.all([
      leadApi.moveTargetOptions(),
      dictionaryApi.config('CLUE_POOL_RS'),
    ])
    if (generation !== loadGeneration || !visible.value) return
    pools.value = poolRows
    enabled.value = reasonConfig.enable
    reasons.value = reasonConfig.dictList.filter((item) => item.id !== 'system')
  } catch (error) {
    if (generation === loadGeneration && visible.value) {
      ElMessage.error(extractErrorMessage(error))
    }
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function confirm() {
  if (loading.value) return
  if (enabled.value && !reasonId.value) return ElMessage.warning('请选择移入线索池原因')
  const poolId = selectedPoolId.value === '__auto__' ? undefined : selectedPoolId.value
  if (poolId && !pools.value.some((item) => item.id === poolId)) {
    return ElMessage.warning('目标线索池不可用，请重新选择')
  }
  emit('confirm', poolId, reasonId.value || undefined)
}

watch(visible, (open) => {
  if (open) void load()
  else ++loadGeneration
})
</script>

<template>
  <CrmDialog
    v-model="visible"
    :title="title ?? '移入线索池'"
    width="max-content"
    destroy-on-close
    :close-on-click-modal="false"
    data-testid="lead-move-to-pool-dialog"
  >
    <div v-loading="loading">
      <CrmInfoAlert>
        {{ description ?? '确定将线索移入线索池？' }}
      </CrmInfoAlert>
      <el-form class="lead-move-to-pool-form mt-5" label-position="right" label-width="91px">
        <el-form-item label="目标线索池" required>
          <el-select
            v-model="selectedPoolId"
            class="w-full"
            data-testid="lead-move-target-pool"
            placeholder="请选择目标线索池"
          >
            <el-option label="自动匹配（按原负责人范围）" value="__auto__" />
            <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="enabled" label="移入线索池原因" required>
          <el-select v-model="reasonId" class="w-full" placeholder="请选择原因">
            <el-option v-for="item in reasons" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <div v-if="!reasons.length" class="mt-1 text-xs text-[var(--el-color-danger)]">
            已启用移入原因必填，但尚无可选原因，请先到模块设置中维护。
          </div>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="loading || (enabled && (!reasonId || !reasons.length))"
        @click="confirm"
        >确认移入</el-button
      >
    </template>
  </CrmDialog>
</template>

<style scoped>
.lead-move-to-pool-form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #333333;
}

.lead-move-to-pool-form :deep(.el-select__wrapper) {
  min-height: 38px;
  border: 1px solid #e4e7ed;
  box-shadow: none;
}

.lead-move-to-pool-form :deep(.el-select__wrapper.is-focused) {
  border-color: var(--el-color-primary);
  box-shadow: none;
}
</style>
