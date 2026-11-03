<script setup lang="ts">
import type { CustomerFollowUpCompletionConfig, FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'
import CustomerPoolConfigDrawer from './CustomerPoolConfigDrawer.vue'

const visible = defineModel<boolean>({ required: true })
const refs = useFieldRefs()
const loading = ref(false)
const pools = ref<ResourcePoolVO[]>([])
const fields = ref<FieldVO[]>([])
const completionEnabled = ref(false)
const completionFieldKey = ref('')
const completionOperator = ref<CustomerFollowUpCompletionConfig['operator']>('EQUALS')
const completionValues = ref<string[]>([])
const completionSaving = ref(false)
const completionFields = computed(() => fields.value.filter((field) =>
  !field.system && !field.hidden && ['select', 'radio', 'checkbox', 'multiselect', 'switch'].includes(field.type),
))
const completionField = computed(() => completionFields.value.find((field) => field.key === completionFieldKey.value) ?? null)
const completionIsMultiple = computed(() => completionField.value?.type === 'checkbox' || completionField.value?.type === 'multiselect')
const completionValueOptions = computed(() => {
  if (completionField.value?.type === 'switch') {
    return [{ label: '开启', value: 'true' }, { label: '关闭', value: 'false' }]
  }
  return completionField.value?.options ?? []
})
const editVisible = ref(false)
const editing = ref<ResourcePoolVO | null>(null)

function scopeLabel(tokens: string[]) {
  return (
    tokens
      .map((token) => {
        const [prefix, raw] = token.includes(':') ? token.split(':', 2) : ['', token]
        const id = raw ?? token
        if (prefix === 'user' || refs.memberMap.value.has(id)) {
          return refs.memberMap.value.get(id) ?? id
        }
        if (prefix === 'dept' || refs.deptMap.value.has(id)) {
          return `部门：${refs.deptMap.value.get(id) ?? id}`
        }
        if (prefix === 'role' || refs.roleMap.value.has(id)) {
          return `角色：${refs.roleMap.value.get(id) ?? id}`
        }
        return token
      })
      .join('、') || '-'
  )
}

async function load() {
  loading.value = true
  try {
    const [{ data }, { data: fieldList }, { data: formConfig }] = await Promise.all([
      resourcePoolApi.customerSettingsPage({ pageSize: 200 }),
      metadataApi.fields('customer'),
      metadataApi.formConfig('customer'),
      refs.members.value.length ? Promise.resolve(null) : refs.load(),
    ])
    pools.value = data.list
    fields.value = fieldList
    const rule = formConfig.formProp.customerFollowUpCompletion
    completionEnabled.value = rule?.enabled ?? false
    completionFieldKey.value = rule?.fieldKey ?? ''
    completionOperator.value = rule?.operator ?? 'EQUALS'
    completionValues.value = [...(rule?.values ?? [])]
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function saveCompletionRule() {
  if (completionEnabled.value) {
    if (!completionField.value) return ElMessage.warning('请选择客户跟进完结判断字段')
    if (completionOperator.value !== 'NOT_EMPTY' && !completionValues.value.length) {
      return ElMessage.warning('请选择至少一个完结命中值')
    }
  }
  const rule: CustomerFollowUpCompletionConfig = {
    enabled: completionEnabled.value,
    fieldKey: completionFieldKey.value,
    operator: completionOperator.value,
    values: completionOperator.value === 'NOT_EMPTY' ? [] : [...completionValues.value],
  }
  completionSaving.value = true
  try {
    await metadataApi.updateFormProp('customer', { customerFollowUpCompletion: rule })
    ElMessage.success('客户跟进完结规则已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    completionSaving.value = false
  }
}

watch(completionField, (field) => {
  if (!field) return
  const multiple = field.type === 'checkbox' || field.type === 'multiselect'
  if (multiple && completionOperator.value === 'EQUALS') completionOperator.value = 'CONTAINS'
  if (!multiple && completionOperator.value === 'CONTAINS') completionOperator.value = 'EQUALS'
  if (field.type === 'switch' && completionOperator.value === 'NOT_EMPTY') completionOperator.value = 'EQUALS'
  const allowed = new Set(completionValueOptions.value.map((item) => item.value))
  completionValues.value = completionValues.value.filter((value) => allowed.has(value))
})

function create() {
  editing.value = null
  editVisible.value = true
}

function edit(row: ResourcePoolVO) {
  editing.value = row
  editVisible.value = true
}

async function toggle(row: ResourcePoolVO) {
  const action = row.enabled ? '禁用' : '启用'
  const ok = await ElMessageBox.confirm(
    `确定${action}「${row.name}」吗？`,
    `${action}客户公海`,
    {
      type: row.enabled ? 'warning' : 'info',
      confirmButtonText: row.enabled ? '确认禁用' : '确认启用',
      cancelButtonText: '取消',
    },
  ).catch(() => false)
  if (!ok) return
  try {
    await resourcePoolApi.toggle(row.id, 'customer')
    ElMessage.success(`已${action}`)
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(row: ResourcePoolVO) {
  try {
    const { data: hasData } = await resourcePoolApi.noPickCustomer(row.id)
    if (hasData) {
      await ElMessageBox.alert(
        '当前客户公海中仍有未领取客户，请先进入客户公海处理完数据后再删除。',
        '无法删除',
        {
          type: 'warning',
          confirmButtonText: '知道了',
        },
      )
      return
    }
    const ok = await ElMessageBox.confirm(`确定删除「${row.name}」吗？`, '删除客户公海', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    }).catch(() => false)
    if (!ok) return
    await resourcePoolApi.remove(row.id, 'customer')
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

watch(visible, (open) => {
  if (open) void load()
})
</script>

<template>
  <el-drawer
    v-model="visible"
    title="公海设置"
    size="100%"
    destroy-on-close
    data-testid="customer-pool-settings-drawer"
  >
    <el-card shadow="never" class="mb-4" data-testid="customer-follow-up-completion-settings">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <div class="text-[15px] font-semibold text-[#1D2129]">客户跟进完结规则</div>
          <div class="mt-1 text-[13px] text-[#86909C]">根据客户自定义字段动态判断是否结束跟进，不影响客户资料和负责人归属。</div>
        </div>
        <el-switch v-model="completionEnabled" active-text="启用" inactive-text="关闭" />
      </div>
      <el-alert
        v-if="completionEnabled"
        class="mb-3"
        type="info"
        :closable="false"
        title="命中完结条件后将停止新增跟进记录和跟进计划、跳过到期提醒，并排除客户公海自动回收；字段值恢复后自动恢复正常跟进和回收判断。"
      />
      <el-form label-position="top">
        <div class="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(180px,1fr)_180px_minmax(220px,1.2fr)_auto]">
        <el-form-item label="判断字段" class="!mb-0">
          <el-select v-model="completionFieldKey" class="w-full" placeholder="选择客户字段" :disabled="!completionEnabled" filterable>
            <el-option v-for="field in completionFields" :key="field.id" :label="field.label" :value="field.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="判断条件" class="!mb-0">
          <el-select v-model="completionOperator" class="w-full" :disabled="!completionEnabled || !completionField">
            <el-option v-if="!completionIsMultiple" label="等于" value="EQUALS" />
            <el-option v-if="completionIsMultiple" label="包含" value="CONTAINS" />
            <el-option v-if="completionField?.type !== 'switch'" label="有值" value="NOT_EMPTY" />
          </el-select>
        </el-form-item>
        <el-form-item label="完结命中值" class="!mb-0">
          <el-select
            v-if="completionOperator !== 'NOT_EMPTY' && completionField && completionValueOptions.length"
            v-model="completionValues"
            class="w-full"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            :disabled="!completionEnabled"
            placeholder="选择一个或多个值"
          >
            <el-option v-for="option in completionValueOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-input
            v-else-if="completionOperator !== 'NOT_EMPTY' && completionField"
            :model-value="completionValues.join(',')"
            disabled
            placeholder="当前字段没有可选项"
          />
          <span v-else class="text-[13px] text-[#86909C]">无需配置命中值</span>
        </el-form-item>
          <el-button type="primary" :loading="completionSaving" @click="saveCompletionRule">保存规则</el-button>
        </div>
      </el-form>
      <div v-if="completionEnabled && completionField" class="mt-2 text-[12px] text-[#86909C]">
        多个命中值之间按“任一满足”判断；字段值变回未命中时，系统会自动恢复跟进和回收判断。
      </div>
      <div v-if="completionEnabled && !completionFields.length" class="mt-2 text-[13px] text-[#F04438]">
        当前没有支持完结判断的客户自定义字段，请先在客户表单设置中添加单选、下拉、多选或开关字段。
      </div>
    </el-card>
    <div class="mb-4">
      <el-button type="primary" @click="create">添加公海</el-button>
    </div>

    <el-table v-loading="loading" :data="pools" border>
      <el-table-column prop="name" label="公海名称" min-width="180" fixed="left" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            @change="toggle(row as ResourcePoolVO)"
          />
        </template>
      </el-table-column>
      <el-table-column label="管理员" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ scopeLabel(row.managerIds) }}</template>
      </el-table-column>
      <el-table-column label="成员" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ scopeLabel(row.scopeIds) }}</template>
      </el-table-column>
      <el-table-column label="自动回收" width="110">
        <template #default="{ row }">{{ row.autoRecycle ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">
          {{ row.createTime ? new Date(row.createTime).toLocaleString() : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="createUserName" label="创建人" width="120" />
      <el-table-column label="更新时间" width="180">
        <template #default="{ row }">
          {{ row.updateTime ? new Date(row.updateTime).toLocaleString() : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="updateUserName" label="更新人" width="120" />
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row as ResourcePoolVO)">编辑</el-button>
          <el-button link type="danger" @click="remove(row as ResourcePoolVO)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <CustomerPoolConfigDrawer
      v-model="editVisible"
      :pool="editing"
      :fields="fields"
      @saved="load"
    />
  </el-drawer>
</template>
