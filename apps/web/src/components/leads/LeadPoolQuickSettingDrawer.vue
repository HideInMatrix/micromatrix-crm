<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{
  pool: ResourcePoolVO | null
  fields: FieldVO[]
}>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()

const fieldRefs = useFieldRefs()
const saving = ref(false)

const form = reactive({
  name: '',
  enabled: true,
  autoRecycle: false,
  scopeIds: [] as string[],
  managerIds: [] as string[],
  hiddenFieldIds: [] as string[],
  limitDailyPick: false,
  dailyPickLimit: 10,
  limitPreviousOwner: false,
  previousOwnerCooldownDays: 7,
  limitNewData: false,
  newDataCooldownDays: 1,
})

const scopeOptions = computed(() => [
  { label: '全部成员', value: '*' },
  ...fieldRefs.members.value.map((member) => ({
    label: `成员：${member.name}`,
    value: `user:${member.id}`,
  })),
  ...[...fieldRefs.deptMap.value.entries()].map(([id, name]) => ({
    label: `部门：${name}`,
    value: `dept:${id}`,
  })),
  ...fieldRefs.roles.value.map((role) => ({
    label: `角色：${role.name}`,
    value: `role:${role.id}`,
  })),
])

const hiddenFieldOptions = computed(() =>
  props.fields
    .filter((field) => !field.hidden && field.key !== 'name')
    .map((field) => ({ label: field.label, value: field.id })),
)

function canonicalScope(token: string) {
  if (
    token === '*' ||
    token.startsWith('user:') ||
    token.startsWith('dept:') ||
    token.startsWith('role:')
  )
    return token
  if (fieldRefs.memberMap.value.has(token)) return `user:${token}`
  if (fieldRefs.deptMap.value.has(token)) return `dept:${token}`
  if (fieldRefs.roleMap.value.has(token)) return `role:${token}`
  return token
}

function resetForm() {
  const pool = props.pool
  if (!pool) return
  Object.assign(form, {
    name: pool.name,
    enabled: pool.enabled,
    autoRecycle: pool.autoRecycle,
    scopeIds: pool.scopeIds.map(canonicalScope),
    managerIds: pool.managerIds.map(canonicalScope),
    hiddenFieldIds: [...pool.hiddenFieldIds],
    limitDailyPick: pool.pickRule?.limitDailyPick ?? false,
    dailyPickLimit: pool.pickRule?.dailyPickLimit ?? 10,
    limitPreviousOwner: pool.pickRule?.limitPreviousOwner ?? false,
    previousOwnerCooldownDays: pool.pickRule?.previousOwnerCooldownDays ?? 7,
    limitNewData: pool.pickRule?.limitNewData ?? false,
    newDataCooldownDays: pool.pickRule?.newDataCooldownDays ?? 1,
  })
}

async function save() {
  if (!props.pool) return
  if (!form.name.trim()) {
    ElMessage.warning('请输入线索池名称')
    return
  }
  if (form.scopeIds.length === 0) {
    ElMessage.warning('请配置线索池成员范围')
    return
  }
  saving.value = true
  try {
    await resourcePoolApi.quickUpdate(props.pool.id, {
      name: form.name.trim(),
      enabled: form.enabled,
      autoRecycle: form.autoRecycle,
      scopeIds: form.scopeIds,
      managerIds: form.managerIds,
      hiddenFieldIds: form.hiddenFieldIds,
      pickRule: {
        limitDailyPick: form.limitDailyPick,
        dailyPickLimit: form.limitDailyPick ? form.dailyPickLimit : null,
        limitPreviousOwner: form.limitPreviousOwner,
        previousOwnerCooldownDays: form.limitPreviousOwner
          ? form.previousOwnerCooldownDays
          : null,
        limitNewData: form.limitNewData,
        newDataCooldownDays: form.limitNewData ? form.newDataCooldownDays : null,
      },
      recycleRule: props.pool.recycleRule ?? { operator: 'AND', conditions: [] },
    })
    ElMessage.success('线索池设置已保存')
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, async (open) => {
  if (!open) return
  if (fieldRefs.members.value.length === 0) await fieldRefs.load()
  resetForm()
})
</script>

<template>
  <el-drawer v-model="visible" title="线索池设置" size="620px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="线索池名称" required>
        <el-input v-model="form.name" maxlength="255" />
      </el-form-item>

      <div class="grid grid-cols-2 gap-4">
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="自动回收">
          <el-switch v-model="form.autoRecycle" />
        </el-form-item>
      </div>

      <el-form-item label="成员范围" required>
        <el-select v-model="form.scopeIds" multiple filterable class="w-full">
          <el-option
            v-for="option in scopeOptions"
            :key="`scope-${option.value}`"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="线索池管理员">
        <el-select v-model="form.managerIds" multiple filterable class="w-full">
          <el-option
            v-for="option in scopeOptions"
            :key="`manager-${option.value}`"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="隐藏字段">
        <el-select v-model="form.hiddenFieldIds" multiple filterable class="w-full">
          <el-option
            v-for="option in hiddenFieldOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-divider content-position="left">领取规则</el-divider>

      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <el-switch v-model="form.limitDailyPick" />
          <span class="w-32">每日领取上限</span>
          <el-input-number
            v-if="form.limitDailyPick"
            v-model="form.dailyPickLimit"
            :min="1"
            controls-position="right"
          />
        </div>
        <div class="flex items-center gap-3">
          <el-switch v-model="form.limitPreviousOwner" />
          <span class="w-32">前负责人冷却</span>
          <el-input-number
            v-if="form.limitPreviousOwner"
            v-model="form.previousOwnerCooldownDays"
            :min="1"
            controls-position="right"
          />
          <span v-if="form.limitPreviousOwner">天</span>
        </div>
        <div class="flex items-center gap-3">
          <el-switch v-model="form.limitNewData" />
          <span class="w-32">新数据保护</span>
          <el-input-number
            v-if="form.limitNewData"
            v-model="form.newDataCooldownDays"
            :min="1"
            controls-position="right"
          />
          <span v-if="form.limitNewData">天</span>
        </div>
      </div>

      <el-alert
        class="mt-6"
        type="info"
        :closable="false"
        title="快速设置会保留当前自动回收条件；完整回收条件可在系统模块设置中维护。"
      />
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>
