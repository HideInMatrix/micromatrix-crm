<script setup lang="ts">
import type { CustomFormRoleKey } from '@micromatrix/shared'
import type { MemberOption } from '@/api/system'

defineProps<{
  members: MemberOption[]
  saving: boolean
}>()

const admins = defineModel<string[]>('admins', { required: true })
const roles = defineModel<Record<CustomFormRoleKey, string[]>>('roles', { required: true })

const emit = defineEmits<{ save: [] }>()

function roleLabel(role: CustomFormRoleKey) {
  if (role === 'MANAGE_ALL') return '管理全部数据'
  if (role === 'VIEW_ALL') return '查看全部数据'
  return '管理本人数据'
}

function roleDescription(role: CustomFormRoleKey) {
  if (role === 'MANAGE_ALL') return '可以查看、新建、编辑和删除该表单的全部数据。'
  if (role === 'VIEW_ALL') return '可以查看全部数据，但不能新建、编辑或删除。'
  return '可以新建数据，并且只能查看和管理本人负责的数据。'
}
</script>

<template>
  <el-alert
    title="表单权限独立于全局角色的数据范围"
    description="全局权限控制能否进入自定义表单模块；以下管理员和三档角色决定当前表单的数据读写边界。"
    type="info"
    :closable="false"
    class="mb-5"
  />

  <div class="space-y-5">
    <section>
      <div class="mb-2 text-sm font-600">表单管理员</div>
      <div class="mb-2 text-xs text-[var(--el-text-color-secondary)]">
        可设计表单、管理成员、启停和删除表单，并管理全部表单数据。
      </div>
      <el-select v-model="admins" multiple filterable class="w-full" placeholder="选择管理员">
        <el-option
          v-for="member in members"
          :key="member.id"
          :label="member.name"
          :value="member.id"
        />
      </el-select>
    </section>

    <section
      v-for="roleKey in ['MANAGE_ALL', 'VIEW_ALL', 'MANAGE_OWN'] as CustomFormRoleKey[]"
      :key="roleKey"
    >
      <div class="mb-2 text-sm font-600">{{ roleLabel(roleKey) }}</div>
      <div class="mb-2 text-xs text-[var(--el-text-color-secondary)]">
        {{ roleDescription(roleKey) }}
      </div>
      <el-select
        v-model="roles[roleKey]"
        multiple
        filterable
        clearable
        class="w-full"
        placeholder="选择成员"
      >
        <el-option
          v-for="member in members"
          :key="member.id"
          :label="member.name"
          :value="member.id"
        />
      </el-select>
    </section>
  </div>

  <div class="mt-6 flex justify-end">
    <el-button type="primary" :loading="saving" @click="emit('save')">保存成员权限</el-button>
  </div>
</template>
