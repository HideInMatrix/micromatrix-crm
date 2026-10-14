<script setup lang="ts">
import type { FollowTargetType } from '@micromatrix/shared'
import { X } from 'lucide-vue-next'
import { ref } from 'vue'
import FollowRecordPanel from '@/components/follow-records/FollowRecordPanel.vue'

defineProps<{
  targetType: FollowTargetType
  targetId: string | null
  targetName?: string
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ followed: [] }>()
const followPanelRef = ref<InstanceType<typeof FollowRecordPanel>>()

function createFollowRecord() {
  followPanelRef.value?.openCreate()
}
</script>

<template>
  <el-drawer
    v-model="visible"
    size="660px"
    :with-header="false"
    destroy-on-close
    class="follow-overview-drawer"
  >
    <div class="flex h-full min-h-0 flex-col bg-white text-[#303133]">
      <header
        class="flex h-[58px] min-h-[58px] shrink-0 items-center justify-between bg-[#F7F8FA] px-5"
      >
        <h2 class="m-0 min-w-0 truncate text-[18px] leading-[26px] font-medium text-black">
          跟进记录{{ targetName ? ` · ${targetName}` : '' }}
        </h2>
        <button
          type="button"
          aria-label="关闭跟进记录"
          class="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[#999999] hover:text-[var(--el-color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--el-color-primary)] focus-visible:outline-offset-2"
          @click="visible = false"
        >
          <X :size="18" :stroke-width="2" aria-hidden="true" />
        </button>
      </header>

      <main class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5">
        <FollowRecordPanel
          ref="followPanelRef"
          :target-type="targetType"
          :target-id="targetId"
          :target-name="targetName"
          detail
          @changed="emit('followed')"
        />
      </main>

      <footer
        class="flex shrink-0 items-center justify-end gap-[10px] border-t border-[#E9EDF2] bg-white px-5 py-[10px]"
      >
        <el-button
          class="!ml-0 !h-[36px] !w-[88px] !rounded-[4px] !p-0 [--el-font-size-base:14px] [--el-button-bg-color:#FFFFFF] [--el-button-border-color:#DCDFE6] [--el-button-text-color:#606266]"
          @click="visible = false"
        >
          关闭
        </el-button>
        <el-button
          type="primary"
          :disabled="!targetId"
          class="!ml-0 !h-[36px] !w-[88px] !rounded-[4px] !p-0 [--el-font-size-base:14px] [--el-button-bg-color:var(--el-color-primary)] [--el-button-border-color:var(--el-color-primary)] [--el-button-text-color:#FFFFFF]"
          @click="createFollowRecord"
        >
          写跟进
        </el-button>
      </footer>
    </div>
  </el-drawer>
</template>

<style scoped>
:global(.follow-overview-drawer.el-drawer) {
  max-width: 100vw;
}

:global(.follow-overview-drawer .el-drawer__body) {
  padding: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
