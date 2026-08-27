<script setup lang="ts">
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { dictionaryApi, type DictionaryItemVO } from '@/api/system'

defineProps<{ title?: string; description?: string }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ confirm: [reasonId?: string] }>()
const loading = ref(false)
const enabled = ref(false)
const reasons = ref<DictionaryItemVO[]>([])
const reasonId = ref('')

async function load() {
  loading.value = true
  try {
    const { data } = await dictionaryApi.config('CLUE_POOL_RS')
    enabled.value = data.enable
    reasons.value = data.dictList.filter((item) => item.id !== 'system')
    reasonId.value = ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function confirm() {
  if (enabled.value && !reasonId.value) return ElMessage.warning('请选择移入线索池原因')
  emit('confirm', reasonId.value || undefined)
}

watch(visible, (open) => { if (open) void load() })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title ?? '移入线索池'"
    width="460px"
    destroy-on-close
    data-testid="lead-move-to-pool-dialog"
  >
    <div v-loading="loading">
      <div class="mb-4 text-sm text-[var(--el-text-color-regular)]">
        {{ description ?? '确定将线索移入匹配的线索池？' }}
      </div>
      <el-form label-position="top">
        <el-form-item v-if="enabled" label="移入线索池原因" required>
          <el-select v-model="reasonId" class="w-full" placeholder="请选择原因">
            <el-option v-for="item in reasons" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-alert
          v-else
          type="info"
          :closable="false"
          title="当前未启用移入线索池原因必填，可直接确认。"
        />
      </el-form>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="loading" @click="confirm">确认移入</el-button>
    </template>
  </el-dialog>
</template>
