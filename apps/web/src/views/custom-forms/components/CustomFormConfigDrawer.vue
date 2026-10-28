<script setup lang="ts">
import type {
  CustomFormDetailVO,
  CustomFormRoleKey,
  DepartmentVO,
  FieldVO,
} from '@micromatrix/shared'
import { computed } from 'vue'
import type { MemberOption } from '@/api/system'
import CustomFormDesigner from './CustomFormDesigner.vue'
import CustomFormPermissionPanel from './CustomFormPermissionPanel.vue'

defineProps<{
  loading: boolean
  saving: boolean
  members: MemberOption[]
  deptTree?: DepartmentVO[]
  referenceMode?: boolean
}>()

const visible = defineModel<boolean>({ required: true })
const tab = defineModel<'design' | 'permission'>('tab', { required: true })
const detail = defineModel<CustomFormDetailVO | null>('detail', { required: true })
const fields = defineModel<FieldVO[]>('fields', { required: true })
const admins = defineModel<string[]>('admins', { required: true })
const roles = defineModel<Record<CustomFormRoleKey, string[]>>('roles', { required: true })

const sourceOwnerId = computed<string>({
  get: () =>
    typeof detail.value?.formProp.referenceOwnerId === 'string'
      ? detail.value.formProp.referenceOwnerId
      : (detail.value?.creator?.id ?? ''),
  set: (value) => {
    if (detail.value) detail.value.formProp.referenceOwnerId = value
  },
})
const departmentScope = computed<'ALL' | 'SELECTED'>({
  get: () => (detail.value?.formProp.referenceDepartmentScope === 'SELECTED' ? 'SELECTED' : 'ALL'),
  set: (value) => {
    if (detail.value) detail.value.formProp.referenceDepartmentScope = value
  },
})
const selectedDepartments = computed<string[]>({
  get: () =>
    Array.isArray(detail.value?.formProp.referenceDepartmentIds)
      ? (detail.value.formProp.referenceDepartmentIds as string[])
      : [],
  set: (value) => {
    if (detail.value) detail.value.formProp.referenceDepartmentIds = value
  },
})

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
    :title="detail ? `配置 · ${detail.name}` : referenceMode ? '配置数据源' : '配置自定义表单'"
    size="960px"
    destroy-on-close
  >
    <div v-loading="loading" class="flex h-full min-h-0 flex-col">
      <el-tabs v-model="tab" class="min-h-0 flex-1">
        <el-tab-pane label="表单设计" name="design">
          <template v-if="detail">
            <div class="mb-5 flex items-end gap-3">
              <div class="min-w-0 flex-1">
                <div class="mb-1.5 text-sm text-[var(--el-text-color-regular)]">
                  {{ referenceMode ? '数据源名称' : '表单名称' }}
                </div>
                <el-input v-model="detail.name" maxlength="50" show-word-limit />
              </div>
              <el-button type="primary" :loading="saving" @click="emit('saveBase')">
                {{ referenceMode ? '保存资料库设置' : '保存名称' }}
              </el-button>
            </div>

            <div
              v-if="referenceMode"
              class="mb-5 rounded-[8px] border border-[var(--el-border-color-light)] bg-[var(--el-fill-color-extra-light)] p-[16px]"
            >
              <div class="mb-3 text-[14px] font-semibold">资料库负责人与使用范围</div>
              <el-form label-position="top">
                <el-form-item label="资料库负责人" required>
                  <el-select
                    v-model="sourceOwnerId"
                    filterable
                    class="w-full"
                    placeholder="选择负责资料维护的成员"
                  >
                    <el-option
                      v-for="member in members"
                      :key="member.id"
                      :value="member.id"
                      :label="member.name"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="允许使用的部门">
                  <el-radio-group v-model="departmentScope">
                    <el-radio value="ALL">全部部门</el-radio>
                    <el-radio value="SELECTED">指定部门</el-radio>
                  </el-radio-group>
                  <el-tree-select
                    v-if="departmentScope === 'SELECTED'"
                    v-model="selectedDepartments"
                    :data="deptTree ?? []"
                    node-key="id"
                    :props="{ label: 'name', children: 'children' }"
                    multiple
                    show-checkbox
                    check-strictly
                    filterable
                    collapse-tags
                    collapse-tags-tooltip
                    class="mt-[10px] w-full"
                    placeholder="请选择允许使用的部门"
                  />
                  <div
                    class="mt-[6px] text-[12px] leading-[18px] text-[var(--el-text-color-secondary)]"
                  >
                    部门仅控制资料的查询和选择，不赋予修改权限；资料库负责人负责维护。指定部门时仅授权所选部门，不自动包含子部门。
                  </div>
                </el-form-item>
              </el-form>
            </div>

            <CustomFormDesigner
              v-model:fields="fields"
              :reference-mode="referenceMode"
              @create="emit('createField')"
              @edit="emit('editField', $event)"
              @remove="emit('removeField', $event)"
              @reorder="emit('reorderFields')"
            />
          </template>
        </el-tab-pane>

        <el-tab-pane v-if="!referenceMode" label="成员权限" name="permission">
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
