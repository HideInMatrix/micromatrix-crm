<script setup lang="ts">
import CustomFormsView from './CustomFormsView.vue'
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="shrink-0 rounded-[8px] bg-white px-[20px] py-[12px]">
      <div class="text-[16px] font-semibold text-[var(--el-text-color-primary)]">数据源管理</div>
      <p class="mt-1 text-[13px] text-[var(--el-text-color-secondary)]">
        创建学校、专业等基础资料库，通过 Excel
        批量导入资料，并在线索、客户表单中以数据源字段关联使用。
      </p>
    </div>
    <div class="min-h-0 flex-1"><CustomFormsView reference-mode /></div>
  </div>
</template>
