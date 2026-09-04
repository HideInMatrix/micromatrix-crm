<script setup lang="ts">
import { Search } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    placeholder?: string
    widthClass?: string
  }>(),
  {
    placeholder: '搜索',
    widthClass: '!w-[240px]',
  },
)

const emit = defineEmits<{ search: [value: string] }>()
const model = defineModel<string>({ default: '' })

function search() {
  emit('search', model.value)
}
</script>

<template>
  <el-input
    v-model="model"
    clearable
    :placeholder="placeholder"
    :class="widthClass"
    @keyup.enter="search"
    @clear="search"
  >
    <template #suffix>
      <button
        type="button"
        class="h-6 w-6 flex items-center justify-center border-0 bg-transparent p-0 text-[var(--el-text-color-secondary)] cursor-pointer hover:text-[var(--el-color-primary)]"
        aria-label="搜索"
        title="搜索"
        @click="search"
      >
        <Search :size="16" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </template>
  </el-input>
</template>
