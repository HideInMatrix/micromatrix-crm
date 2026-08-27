<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import {
  resourcePoolApi,
  type ResourcePoolRecycleCondition,
  type ResourcePoolVO,
} from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{ pool: ResourcePoolVO | null; fields: FieldVO[] }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()
const refs = useFieldRefs()
const saving = ref(false)

type RecycleConditionForm = ResourcePoolRecycleCondition & { fixedRange: string[] }
const dynamicOptions = [
  { label: '今天', value: 'TODAY' },
  { label: '昨天', value: 'YESTERDAY' },
  { label: '本周', value: 'WEEK' },
  { label: '上周', value: 'LAST_WEEK' },
  { label: '本月', value: 'MONTH' },
  { label: '上月', value: 'LAST_MONTH' },
  { label: '过去 7 天', value: 'LAST_SEVEN' },
  { label: '过去 30 天', value: 'LAST_THIRTY' },
  { label: '早于 30 天前', value: 'CUSTOM,30,BEFORE_DAY' },
  { label: '早于 90 天前', value: 'CUSTOM,90,BEFORE_DAY' },
]

const form = reactive({
  name: '',
  scopeIds: [] as string[],
  managerIds: [] as string[],
  hiddenFieldIds: [] as string[],
  limitDailyPick: false,
  dailyPickLimit: 10,
  limitPreviousOwner: false,
  previousOwnerCooldownDays: 7,
  limitNewData: false,
  newDataCooldownDays: 1,
  autoRecycle: false,
  recycleMode: 'AND' as 'AND' | 'OR',
  recycleConditions: [] as RecycleConditionForm[],
})

const scopeOptions = computed(() => [
  ...refs.members.value.map((item) => ({ label: `成员：${item.name}`, value: `user:${item.id}` })),
  ...[...refs.deptMap.value.entries()].map(([id, name]) => ({ label: `部门：${name}`, value: `dept:${id}` })),
  ...refs.roles.value.map((item) => ({ label: `角色：${item.name}`, value: `role:${item.id}` })),
])
const hiddenFields = computed(() => props.fields.filter((field) => !field.hidden && field.key !== 'name'))

function canonical(token: string) {
  if (token.startsWith('user:') || token.startsWith('dept:') || token.startsWith('role:')) return token
  if (refs.memberMap.value.has(token)) return `user:${token}`
  if (refs.deptMap.value.has(token)) return `dept:${token}`
  if (refs.roleMap.value.has(token)) return `role:${token}`
  return token
}

function addCondition() {
  form.recycleConditions.push({
    column: 'storageTime',
    operator: 'DYNAMICS',
    value: 'CUSTOM,30,BEFORE_DAY',
    scope: ['Created', 'Picked'],
    fixedRange: [],
  })
}

function reset() {
  const pool = props.pool
  Object.assign(form, {
    name: pool?.name ?? '',
    scopeIds: (pool?.scopeIds ?? []).filter((id) => id !== '*').map(canonical),
    managerIds: (pool?.managerIds ?? []).filter((id) => id !== '*').map(canonical),
    hiddenFieldIds: [...(pool?.hiddenFieldIds ?? [])],
    limitDailyPick: pool?.pickRule?.limitDailyPick ?? false,
    dailyPickLimit: pool?.pickRule?.dailyPickLimit ?? 10,
    limitPreviousOwner: pool?.pickRule?.limitPreviousOwner ?? false,
    previousOwnerCooldownDays: pool?.pickRule?.previousOwnerCooldownDays ?? 7,
    limitNewData: pool?.pickRule?.limitNewData ?? false,
    newDataCooldownDays: pool?.pickRule?.newDataCooldownDays ?? 1,
    autoRecycle: pool?.autoRecycle ?? false,
    recycleMode: pool?.recycleRule?.operator ?? 'AND',
    recycleConditions: (pool?.recycleRule?.conditions ?? []).map((condition) => ({
      ...condition,
      scope: [...(condition.scope ?? [])],
      fixedRange:
        condition.operator === 'FIXED' ? condition.value.split(',').filter(Boolean) : [],
    })),
  })
}

async function save(continueCreate = false) {
  if (!form.name.trim()) return ElMessage.warning('请输入线索池名称')
  if (!form.scopeIds.length) return ElMessage.warning('请选择线索池成员')
  if (!form.managerIds.length) return ElMessage.warning('请选择线索池管理员')
  const conditions = form.recycleConditions.map((condition) => ({
    column: condition.column,
    operator: condition.operator,
    value: condition.operator === 'FIXED' ? condition.fixedRange.join(',') : condition.value.trim(),
    ...(condition.column === 'storageTime'
      ? { scope: condition.scope?.length ? condition.scope : ['Created', 'Picked'] }
      : {}),
  })) as ResourcePoolRecycleCondition[]
  if (form.autoRecycle && (!conditions.length || conditions.some((item) => !item.value))) {
    return ElMessage.warning('启用自动回收时至少配置一条完整回收条件')
  }
  saving.value = true
  try {
    const payload = {
      module: 'lead',
      name: form.name.trim(),
      enabled: props.pool?.enabled ?? true,
      autoRecycle: form.autoRecycle,
      scopeIds: form.scopeIds,
      managerIds: form.managerIds,
      hiddenFieldIds: form.hiddenFieldIds,
      pickRule: {
        limitDailyPick: form.limitDailyPick,
        dailyPickLimit: form.limitDailyPick ? form.dailyPickLimit : null,
        limitPreviousOwner: form.limitPreviousOwner,
        previousOwnerCooldownDays: form.limitPreviousOwner ? form.previousOwnerCooldownDays : null,
        limitNewData: form.limitNewData,
        newDataCooldownDays: form.limitNewData ? form.newDataCooldownDays : null,
      },
      recycleRule: { operator: form.recycleMode, conditions },
    }
    if (props.pool) await resourcePoolApi.update(props.pool.id, payload)
    else await resourcePoolApi.create(payload)
    ElMessage.success(props.pool ? '线索池已更新' : '线索池已添加')
    emit('saved')
    if (continueCreate && !props.pool) reset()
    else visible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, async (open) => {
  if (!open) return
  reset()
  if (!refs.members.value.length) {
    await refs.load()
    // 引用数据异步加载结束后只规范化 Scope，不再次 reset 整张表，
    // 避免用户已输入的名称/规则被异步初始化覆盖。
    form.scopeIds = form.scopeIds.map(canonical)
    form.managerIds = form.managerIds.map(canonical)
  }
})
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="pool ? '编辑线索池' : '添加线索池'"
    size="900px"
    destroy-on-close
    data-testid="lead-pool-config-drawer"
  >
    <el-alert
      v-if="pool"
      class="mb-4"
      type="warning"
      :closable="false"
      title="修改线索池规则后会立即影响当前池成员、领取和自动回收规则。"
    />
    <el-form label-position="left" label-width="120px">
      <el-divider content-position="left">基本信息</el-divider>
      <el-form-item label="线索池名称" required><el-input v-model="form.name" maxlength="255" /></el-form-item>
      <el-form-item label="线索池管理员" required>
        <el-select v-model="form.managerIds" multiple filterable class="w-full">
          <el-option v-for="item in scopeOptions" :key="`m-${item.value}`" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="成员" required>
        <el-select v-model="form.scopeIds" multiple filterable class="w-full">
          <el-option v-for="item in scopeOptions" :key="`s-${item.value}`" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>

      <el-divider content-position="left">线索领取规则</el-divider>
      <el-form-item label="每日领取">
        <el-radio-group v-model="form.limitDailyPick"><el-radio :value="false">不限制</el-radio><el-radio :value="true">限制</el-radio></el-radio-group>
        <el-input-number v-if="form.limitDailyPick" v-model="form.dailyPickLimit" :min="1" :max="10000" class="ml-4" />
      </el-form-item>
      <el-form-item label="前负责人领取">
        <el-radio-group v-model="form.limitPreviousOwner"><el-radio :value="false">不限制</el-radio><el-radio :value="true">限制</el-radio></el-radio-group>
        <template v-if="form.limitPreviousOwner"><el-input-number v-model="form.previousOwnerCooldownDays" :min="1" :max="10000" class="ml-4" /><span class="ml-2">天内不能领取</span></template>
      </el-form-item>
      <el-form-item label="新数据领取">
        <el-radio-group v-model="form.limitNewData"><el-radio :value="false">不限制</el-radio><el-radio :value="true">限制</el-radio></el-radio-group>
        <template v-if="form.limitNewData"><el-input-number v-model="form.newDataCooldownDays" :min="1" :max="10000" class="ml-4" /><span class="ml-2">天后可领取</span></template>
      </el-form-item>

      <el-divider content-position="left">线索回收规则</el-divider>
      <el-form-item label="自动回收">
        <el-radio-group v-model="form.autoRecycle"><el-radio :value="true">是</el-radio><el-radio :value="false">否</el-radio></el-radio-group>
      </el-form-item>
      <template v-if="form.autoRecycle">
        <div class="mb-3 flex items-center justify-between">
          <el-radio-group v-model="form.recycleMode" size="small"><el-radio-button value="AND">全部满足</el-radio-button><el-radio-button value="OR">任一满足</el-radio-button></el-radio-group>
          <el-button size="small" @click="addCondition">添加条件</el-button>
        </div>
        <div v-for="(condition, index) in form.recycleConditions" :key="index" class="mb-3 rounded border border-[var(--el-border-color)] p-3">
          <div class="grid grid-cols-[150px_130px_1fr_auto] items-center gap-3">
            <el-select v-model="condition.column"><el-option label="入库时间" value="storageTime" /><el-option label="最后跟进时间" value="followUpTime" /></el-select>
            <el-select v-model="condition.operator"><el-option label="动态时间" value="DYNAMICS" /><el-option label="固定时间" value="FIXED" /></el-select>
            <el-select v-if="condition.operator === 'DYNAMICS'" v-model="condition.value" filterable allow-create default-first-option>
              <el-option v-for="item in dynamicOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-date-picker v-else v-model="condition.fixedRange" type="datetimerange" value-format="x" class="!w-full" />
            <el-button link type="danger" @click="form.recycleConditions.splice(index, 1)">删除</el-button>
          </div>
          <el-checkbox-group v-if="condition.column === 'storageTime'" v-model="condition.scope" class="mt-2">
            <el-checkbox value="Created">创建时间</el-checkbox><el-checkbox value="Picked">最近领取时间</el-checkbox>
          </el-checkbox-group>
        </div>
      </template>

      <el-divider content-position="left">列设置</el-divider>
      <el-checkbox-group v-model="form.hiddenFieldIds" class="grid grid-cols-4 gap-2">
        <el-checkbox v-for="field in hiddenFields" :key="field.id" :value="field.id">隐藏 {{ field.label }}</el-checkbox>
      </el-checkbox-group>
      <div class="mt-2 text-xs text-[var(--el-text-color-secondary)]">线索名称固定显示；这里仅控制当前线索池页面字段可见性。</div>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="!pool" :loading="saving" @click="save(true)">保存并继续</el-button>
      <el-button type="primary" :loading="saving" @click="save(false)">{{ pool ? '更新' : '确定' }}</el-button>
    </template>
  </el-drawer>
</template>
