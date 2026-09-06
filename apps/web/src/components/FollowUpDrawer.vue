<script setup lang="ts">
import type { FollowTargetType } from '@micromatrix/shared'
import FollowRecordPanel from '@/components/follow-records/FollowRecordPanel.vue'

defineProps<{
  targetType: FollowTargetType
  targetId: string | null
  targetName?: string
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ followed: [] }>()
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="`跟进记录${targetName ? ` · ${targetName}` : ''}`"
    size="50%"
  >
    <FollowRecordPanel
      :target-type="targetType"
      :target-id="targetId"
      :target-name="targetName"
      @changed="emit('followed')"
    />
  </el-drawer>
</template>
