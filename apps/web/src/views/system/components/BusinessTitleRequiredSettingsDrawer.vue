<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BusinessTitleConfigVO } from '@micromatrix/shared'
import { businessTitleApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const visible = defineModel<boolean>({ required: true })
const auth = useAuthStore()
const loading = ref(false)
const switchingId = ref('')
const rows = ref<BusinessTitleConfigVO[]>([])
const canUpdate = computed(() => auth.hasPerm('system:module:update'))

const labels: Record<string, string> = {
  name: '工商抬头',
  identification_number: '统一社会信用代码',
  opening_bank: '开户行',
  bank_account: '银行账号',
  registration_address: '注册地址',
  phone_number: '电话',
  registered_capital: '注册资本',
  company_size: '公司规模',
  registration_number: '注册号',
  province: '省份',
  city: '城市',
  scale: '规模',
  industry: '行业',
  remark: '备注',
}

async function load() {
  loading.value = true
  try {
    rows.value = (await businessTitleApi.config()).data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function toggle(row: BusinessTitleConfigVO) {
  if (!canUpdate.value || switchingId.value) return
  switchingId.value = row.id
  try {
    const updated = (await businessTitleApi.switchRequired(row.id)).data
    Object.assign(row, updated)
    ElMessage.success(updated.required ? '已设为必填' : '已设为非必填')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    switchingId.value = ''
  }
}

watch(visible, (open) => { if (open) void load() })
</script>

<template>
  <el-drawer
    v-model="visible"
    title="工商抬头表单必填设置"
    size="640px"
    destroy-on-close
    data-testid="business-title-required-settings-drawer"
  >
    <el-alert
      class="mb-4"
      type="info"
      :closable="false"
      title="控制手工新增和编辑工商抬头时的必填字段；发票只能选择审核通过的工商抬头。"
    />
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column label="字段" min-width="260">
        <template #default="{ row }">{{ labels[row.field] ?? row.field }}</template>
      </el-table-column>
      <el-table-column prop="field" label="字段标识" min-width="220" />
      <el-table-column label="必填" width="110" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.required"
            :disabled="!canUpdate || Boolean(switchingId)"
            :loading="switchingId === row.id"
            @change="toggle(row as BusinessTitleConfigVO)"
          />
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>
</template>
