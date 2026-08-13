<script setup lang="ts">
import { ref, watch } from 'vue'
import type { MemberOption } from '@/api/system'

const props = defineProps<{
  title: string
  members: MemberOption[]
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ confirm: [userId: string] }>()

const selected = ref<string>()

watch(visible, (open) => {
  if (open) selected.value = undefined
})

function handleConfirm() {
  if (!selected.value) {
    ElMessage.warning('请选择成员')
    return
  }
  emit('confirm', selected.value)
  visible.value = false
}
</script>

<template>
  <el-dialog v-model="visible" :title="props.title" width="400px">
    <el-select v-model="selected" filterable placeholder="选择成员" class="w-full">
      <el-option v-for="m in members" :key="m.id" :label="m.name" :value="m.id" />
    </el-select>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>
