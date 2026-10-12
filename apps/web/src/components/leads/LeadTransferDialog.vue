<script setup lang="ts">
import { ref, watch } from 'vue'
import CrmDialog from '@/components/CrmDialog.vue'
import CrmInfoAlert from '@/components/CrmInfoAlert.vue'
import type { MemberOption } from '@/api/system'

const props = withDefaults(
  defineProps<{
    members: MemberOption[]
    count: number
    loading?: boolean
  }>(),
  { loading: false },
)
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ confirm: [ownerId: string, note: string] }>()

const ownerId = ref('')
const note = ref('')

watch(visible, (open) => {
  if (!open) return
  ownerId.value = ''
  note.value = ''
})

function handleConfirm() {
  if (!ownerId.value) {
    ElMessage.warning('请选择负责人')
    return
  }
  emit('confirm', ownerId.value, note.value.trim())
}
</script>

<template>
  <CrmDialog
    v-model="visible"
    title="转移线索"
    width="520px"
    destroy-on-close
    :close-on-click-modal="!loading"
    :close-on-press-escape="!loading"
    :show-close="!loading"
  >
    <CrmInfoAlert>
      已选{{ props.count }}条线索，转移后系统将通过企业微信通知对应顾问。
    </CrmInfoAlert>
    <el-form class="lead-transfer-form mt-5" label-position="right" label-width="68px">
      <el-form-item label="转移给" required>
        <el-select v-model="ownerId" filterable placeholder="请选择负责人" class="w-full">
          <el-option
            v-for="member in members"
            :key="member.id"
            :label="member.name"
            :value="member.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="补充说明">
        <el-input
          v-model="note"
          type="textarea"
          :rows="3"
          maxlength="500"
          placeholder="请输入转移说明（选填）"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="loading" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleConfirm">确认转移</el-button>
    </template>
  </CrmDialog>
</template>

<style scoped>
.lead-transfer-form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #333333;
}
.lead-transfer-form :deep(.el-select__wrapper),
.lead-transfer-form :deep(.el-textarea__inner) {
  border: 1px solid #e4e7ed;
  box-shadow: none;
}
.lead-transfer-form :deep(.el-select__wrapper) {
  min-height: 38px;
}
.lead-transfer-form :deep(.el-select__wrapper.is-focused),
.lead-transfer-form :deep(.el-textarea__inner:focus) {
  border-color: var(--el-color-primary);
  box-shadow: none;
}
</style>
