<script setup lang="ts">
import type { CustomFormDetailVO, CustomFormRoleKey, FieldVO } from '@micromatrix/shared'
import type { MemberOption } from '@/api/system'
import CustomFormDesigner from './CustomFormDesigner.vue'
import CustomFormPermissionPanel from './CustomFormPermissionPanel.vue'

defineProps<{
  loading: boolean
  saving: boolean
  members: MemberOption[]
}>()

const visible = defineModel<boolean>({ required: true })
const tab = defineModel<'design' | 'permission'>('tab', { required: true })
const detail = defineModel<CustomFormDetailVO | null>('detail', { required: true })
const fields = defineModel<FieldVO[]>('fields', { required: true })
const admins = defineModel<string[]>('admins', { required: true })
const roles = defineModel<Record<CustomFormRoleKey, string[]>>('roles', { required: true })

const emit = defineEmits<{
  saveBase: []
  savePermissions: []
  createField: []
  editField: [field: FieldVO]
  removeField: [field: FieldVO]
  reorderFields: []
}>()
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="detail ? `配置 · ${detail.name}` : '配置自定义表单'"
    size="960px"
    destroy-on-close
  >
    <div v-loading="loading" class="flex h-full min-h-0 flex-col">
      <el-tabs v-model="tab" class="min-h-0 flex-1">
        <el-tab-pane label="表单设计" name="design">
          <template v-if="detail">
            <div class="mb-5 flex items-end gap-3">
              <div class="min-w-0 flex-1">
                <div class="mb-1.5 text-sm text-[var(--el-text-color-regular)]">表单名称</div>
                <el-input v-model="detail.name" maxlength="50" show-word-limit />
              </div>
              <el-button type="primary" :loading="saving" @click="emit('saveBase')">
                保存名称
              </el-button>
            </div>

            <CustomFormDesigner
              v-model:fields="fields"
              @create="emit('createField')"
              @edit="emit('editField', $event)"
              @remove="emit('removeField', $event)"
              @reorder="emit('reorderFields')"
            />
          </template>
        </el-tab-pane>

        <el-tab-pane label="成员权限" name="permission">
          <CustomFormPermissionPanel
            v-if="detail"
            v-model:admins="admins"
            v-model:roles="roles"
            :members="members"
            :saving="saving"
            @save="emit('savePermissions')"
          />
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-drawer>
</template>
