<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => route.meta.title ?? '待建设模块')
const feature = computed(() => route.meta.plannedFeature ?? '该模块的 Cordys 业务能力')
</script>

<template>
  <el-card shadow="never" class="planned-feature-card">
    <el-empty :description="`${title}业务内容待对齐`">
      <template #image>
        <div class="planned-mark">待</div>
      </template>
      <div class="max-w-150 text-sm leading-6 text-[var(--el-text-color-secondary)]">
        左侧菜单已按 CordysCRM 信息架构补齐。后续将在此实现{{ feature }}，当前不会使用其他页面的数据伪装已完成功能。
      </div>
    </el-empty>
  </el-card>
</template>

<style scoped>
.planned-feature-card {
  min-height: calc(100vh - 104px);
}

.planned-mark {
  display: grid;
  width: 88px;
  height: 88px;
  place-items: center;
  border: 1px dashed var(--el-border-color);
  border-radius: 24px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
  font-size: 32px;
  font-weight: 700;
}
</style>
