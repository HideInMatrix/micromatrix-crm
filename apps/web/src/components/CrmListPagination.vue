<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'

withDefaults(
  defineProps<{
    total: number
    pageSizes?: number[]
  }>(),
  { pageSizes: () => [10, 20, 50] },
)

const currentPage = defineModel<number>('currentPage', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
const emit = defineEmits<{
  'current-change': [page: number]
  'size-change': [size: number]
  change: [page: number, size: number]
}>()

const paginationLocale = {
  ...zhCn,
  el: {
    ...zhCn.el,
    pagination: { ...zhCn.el.pagination, goto: '跳转到' },
  },
}
</script>

<template>
  <div class="crm-data-list-pagination mt-4 flex justify-center overflow-x-auto">
    <el-config-provider :locale="paginationLocale">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="pageSizes"
        layout="sizes, total, prev, pager, next, jumper"
        @current-change="emit('current-change', $event)"
        @size-change="emit('size-change', $event)"
        @change="(page: number, size: number) => emit('change', page, size)"
      />
    </el-config-provider>
  </div>
</template>
