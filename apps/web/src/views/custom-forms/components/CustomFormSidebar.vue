<script setup lang="ts">
import type { CustomFormListVO } from '@micromatrix/shared'

defineProps<{
  loading: boolean
  forms: CustomFormListVO[]
  activeFormId: string
  canAdd: boolean
}>()

const keyword = defineModel<string>('keyword', { default: '' })

const emit = defineEmits<{
  create: []
  select: [id: string]
  config: [id: string, tab: 'design' | 'permission']
  toggle: [form: CustomFormListVO]
  remove: [form: CustomFormListVO]
}>()
</script>

<template>
  <el-card shadow="never" class="w-[280px] shrink-0" body-class="h-full !p-4 flex flex-col min-h-0">
    <div class="mb-3 flex items-center gap-2">
      <el-input v-model="keyword" clearable placeholder="搜索表单" class="flex-1" />
      <el-button v-if="canAdd" type="primary" plain class="!px-3" @click="emit('create')">
        新建
      </el-button>
    </div>

    <div v-loading="loading" class="min-h-0 flex-1 overflow-auto">
      <el-empty v-if="!forms.length && !loading" description="暂无自定义表单" :image-size="72" />
      <div v-else class="space-y-1">
        <div
          v-for="item in forms"
          :key="item.id"
          class="group flex cursor-pointer items-center gap-2 rounded-1.5 px-3 py-2.5"
          :class="
            activeFormId === item.id
              ? 'bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]'
              : 'hover:bg-[var(--el-fill-color-light)]'
          "
          @click="emit('select', item.id)"
        >
          <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>
          <el-tag v-if="!item.enable" size="small" type="info">停用</el-tag>
          <el-dropdown v-if="item.isAdmin" trigger="click" @click.stop>
            <el-button link class="opacity-60 group-hover:opacity-100" @click.stop>•••</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="emit('config', item.id, 'design')">
                  表单设计
                </el-dropdown-item>
                <el-dropdown-item @click="emit('config', item.id, 'permission')">
                  成员权限
                </el-dropdown-item>
                <el-dropdown-item @click="emit('toggle', item)">
                  {{ item.enable ? '停用' : '启用' }}
                </el-dropdown-item>
                <el-dropdown-item
                  divided
                  class="text-[var(--el-color-danger)]"
                  @click="emit('remove', item)"
                >
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
  </el-card>
</template>
