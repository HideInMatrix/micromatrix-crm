<script setup lang="ts">
import {
  CONTRACT_INVOICE_APPROVAL_STATUS_LABELS,
  CONTRACT_PAYMENT_PLAN_STATUS_LABELS,
  INVOICE_TYPES,
  type BusinessTitleConfigVO,
  type BusinessTitleVO,
  type ContractInvoiceVO,
  type ContractPaymentPlanVO,
  type ContractPaymentRecordVO,
  type ContractVO,
} from '@micromatrix/shared'
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  businessTitleApi,
  contractApi,
  contractInvoiceApi,
  contractPaymentPlanApi,
  contractPaymentRecordApi,
} from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import AttachmentUploader from '@/components/AttachmentUploader.vue'
import OrderTable from '@/components/order/OrderTable.vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ contractId: string | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ changed: [] }>()
const auth = useAuthStore()
const router = useRouter()

const detail = ref<ContractVO | null>(null)
const detailSnapshot = ref<Record<string, unknown> | null>(null)
const detailSnapshotForm = ref<Record<string, unknown> | null>(null)
const plans = ref<ContractPaymentPlanVO[]>([])
const records = ref<ContractPaymentRecordVO[]>([])
const invoices = ref<ContractInvoiceVO[]>([])
const titles = ref<BusinessTitleVO[]>([])
const titleConfigs = ref<BusinessTitleConfigVO[]>([])
const loading = ref(false)
const activeTab = ref('items')

const planDialogVisible = ref(false)
const planForm = reactive({ name: '', owner: '', planAmount: 0, planEndTime: '' })

const recordDialogVisible = ref(false)
const recordForm = reactive({
  name: '',
  owner: '',
  paymentPlanId: '',
  recordAmount: 0,
  recordEndTime: '',
  bank: '1',
  bankNo: '1',
})

const invoiceDialogVisible = ref(false)
const invoiceForm = reactive({
  name: '',
  businessTitleId: '',
  amount: 0,
  invoiceType: '增值税普通发票',
  taxRate: 0,
})

const titleDialogVisible = ref(false)
const titleForm = reactive({
  name: '',
  identificationNumber: '',
  openingBank: '',
  bankAccount: '',
  registrationAddress: '',
  phoneNumber: '',
  registeredCapital: '',
  companySize: '',
  registrationNumber: '',
  province: '',
  city: '',
  scale: '',
  industry: '',
  remark: '',
})

const TITLE_CONFIG_TO_FORM = {
  name: 'name',
  identification_number: 'identificationNumber',
  opening_bank: 'openingBank',
  bank_account: 'bankAccount',
  registration_address: 'registrationAddress',
  phone_number: 'phoneNumber',
  registered_capital: 'registeredCapital',
  company_size: 'companySize',
  registration_number: 'registrationNumber',
  province: 'province',
  city: 'city',
  scale: 'scale',
  industry: 'industry',
  remark: 'remark',
} as const

watch(
  [visible, () => props.contractId],
  ([open, contractId]) => {
    if (open && contractId) void loadAll(contractId)
  },
)

async function loadAll(contractId = props.contractId) {
  if (!contractId) return
  loading.value = true
  try {
    const [detailRes, snapshotRes, snapshotFormRes, planRes, recordRes, invoiceRes, titleRes, titleConfigRes] = await Promise.all([
      contractApi.detail(contractId),
      contractApi.snapshot(contractId),
      contractApi.snapshotForm(contractId),
      contractPaymentPlanApi.page({ current: 1, pageSize: 100, contractId }),
      contractPaymentRecordApi.page({ current: 1, pageSize: 100, contractId }),
      contractInvoiceApi.page({ current: 1, pageSize: 100, contractId }),
      businessTitleApi.options(),
      businessTitleApi.config(),
    ])
    detail.value = detailRes.data
    detailSnapshot.value = snapshotRes.data
    detailSnapshotForm.value = snapshotFormRes.data
    plans.value = planRes.data.list
    records.value = recordRes.data.list
    invoices.value = invoiceRes.data.list
    titles.value = titleRes.data
    titleConfigs.value = titleConfigRes.data
    emit('changed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function addPlan() {
  if (!props.contractId || !planForm.name.trim() || !planForm.planAmount || !planForm.planEndTime) {
    ElMessage.warning('请填写计划名称、金额与日期')
    return
  }
  try {
    await contractPaymentPlanApi.create({
      name: planForm.name.trim(),
      contractId: props.contractId,
      owner: planForm.owner || auth.user?.id,
      planAmount: planForm.planAmount,
      planEndTime: new Date(`${planForm.planEndTime}T00:00:00`).getTime(),
    })
    planDialogVisible.value = false
    Object.assign(planForm, { name: '', owner: auth.user?.id ?? '', planAmount: 0, planEndTime: '' })
    ElMessage.success('回款计划已创建')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removePlan(plan: ContractPaymentPlanVO) {
  const confirmed = await ElMessageBox.confirm(`删除回款计划「${plan.name}」？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await contractPaymentPlanApi.remove(plan.id)
    ElMessage.success('已删除')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function addRecord() {
  if (!props.contractId || !recordForm.name.trim() || !recordForm.recordAmount || !recordForm.recordEndTime) {
    ElMessage.warning('请填写记录名称、金额与回款日期')
    return
  }
  try {
    await contractPaymentRecordApi.create({
      name: recordForm.name.trim(),
      owner: recordForm.owner || auth.user?.id,
      contractId: props.contractId,
      paymentPlanId: recordForm.paymentPlanId || undefined,
      recordAmount: recordForm.recordAmount,
      recordEndTime: new Date(`${recordForm.recordEndTime}T00:00:00`).getTime(),
      moduleFields: [
        { fieldId: 'contractPaymentRecordBank', fieldValue: recordForm.bank },
        { fieldId: 'contractPaymentRecordBankNo', fieldValue: recordForm.bankNo },
      ],
    })
    recordDialogVisible.value = false
    Object.assign(recordForm, {
      name: '',
      owner: auth.user?.id ?? '',
      paymentPlanId: '',
      recordAmount: 0,
      recordEndTime: '',
      bank: '1',
      bankNo: '1',
    })
    ElMessage.success('回款已登记')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function addInvoice() {
  if (!props.contractId || !invoiceForm.name.trim() || !invoiceForm.amount) {
    ElMessage.warning('请填写发票名称和开票金额')
    return
  }
  try {
    await contractInvoiceApi.create({
      name: invoiceForm.name.trim(),
      contractId: props.contractId,
      owner: auth.user?.id,
      businessTitleId: invoiceForm.businessTitleId || undefined,
      amount: invoiceForm.amount,
      invoiceType: invoiceForm.invoiceType,
      taxRate: invoiceForm.taxRate,
    })
    invoiceDialogVisible.value = false
    Object.assign(invoiceForm, {
      name: '',
      businessTitleId: '',
      amount: 0,
      invoiceType: '增值税普通发票',
      taxRate: 0,
    })
    ElMessage.success('开票申请已创建')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function titleFieldRequired(field: keyof typeof TITLE_CONFIG_TO_FORM) {
  return titleConfigs.value.some((item) => item.field === field && item.required)
}

async function addTitle() {
  const missing = titleConfigs.value.find((item) => {
    if (!item.required) return false
    const key = TITLE_CONFIG_TO_FORM[item.field as keyof typeof TITLE_CONFIG_TO_FORM]
    return key ? !titleForm[key].trim() : false
  })
  if (missing) {
    ElMessage.warning(`请填写必填工商抬头字段：${missing.field}`)
    return
  }
  try {
    await businessTitleApi.create({
      ...titleForm,
      type: 'CUSTOM',
    })
    titleDialogVisible.value = false
    Object.keys(titleForm).forEach((key) => {
      titleForm[key as keyof typeof titleForm] = ''
    })
    ElMessage.success('工商抬头已提交审核，审核通过后可用于开票')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

const canAddPlan = () => auth.hasPerm('CONTRACT_PAYMENT_PLAN:ADD')
const canDeletePlan = () => auth.hasPerm('CONTRACT_PAYMENT_PLAN:DELETE')
const canAddRecord = () =>
  auth.hasPerm('CONTRACT_PAYMENT_RECORD:ADD') || auth.hasPerm('CONTRACT:PAYMENT')
const canAddInvoice = () => auth.hasPerm('CONTRACT_INVOICE:ADD')
const canAddTitle = () => auth.hasPerm('CONTRACT_BUSINESS_TITLE:ADD')

function invoiceApprovalLabel(status: ContractInvoiceVO['approvalStatus']) {
  return status ? CONTRACT_INVOICE_APPROVAL_STATUS_LABELS[status] : '-'
}

function formatDate(value: number | null | undefined) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '-'
}

async function convertToOrder() {
  if (!props.contractId) return
  visible.value = false
  await router.push({ path: '/order/index', query: { fromContract: props.contractId } })
}
</script>

<template>
  <el-drawer v-model="visible" :title="detail ? `${detail.name}（${detail.number}）` : '合同详情'" size="900px">
    <div v-loading="loading">
      <el-descriptions v-if="detail" :column="3" border size="small" class="mb-4">
        <el-descriptions-item label="客户">{{ detail.customerName }}</el-descriptions-item>
        <el-descriptions-item label="阶段">{{ detail.stageName ?? detail.stage }}</el-descriptions-item>
        <el-descriptions-item label="审批状态">{{ detail.approvalStatus }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ formatDate(detail.startTime) }}</el-descriptions-item>
        <el-descriptions-item label="结束时间">{{ formatDate(detail.endTime) }}</el-descriptions-item>
        <el-descriptions-item label="合同金额">
          ¥{{ detail.amount.toLocaleString('zh-CN') }}
        </el-descriptions-item>
        <el-descriptions-item label="已回款">
          <span class="text-[var(--el-color-success)]">¥{{ detail.paidAmount.toLocaleString('zh-CN') }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="已开票">
          ¥{{ detail.invoicedAmount.toLocaleString('zh-CN') }}
        </el-descriptions-item>
      </el-descriptions>

      <el-collapse v-if="detailSnapshot || detailSnapshotForm" class="mb-4">
        <el-collapse-item v-if="detailSnapshot" title="合同冻结快照" name="business-snapshot">
          <pre class="whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(detailSnapshot, null, 2) }}</pre>
        </el-collapse-item>
        <el-collapse-item v-if="detailSnapshotForm" title="表单配置快照" name="form-snapshot">
          <pre class="whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(detailSnapshotForm, null, 2) }}</pre>
        </el-collapse-item>
      </el-collapse>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="合同明细" name="items">
          <el-table :data="detail?.products ?? []" size="small">
            <el-table-column prop="productName" label="产品/项目" min-width="180" />
            <el-table-column prop="productNumber" label="数量" width="80" />
            <el-table-column label="单价" width="110" align="right">
              <template #default="{ row }">¥{{ row.productAmount.toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">¥{{ row.amount.toLocaleString('zh-CN') }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="附件" name="attachments">
          <AttachmentUploader target-type="contract" :target-id="contractId" />
        </el-tab-pane>

        <el-tab-pane label="回款计划" name="plans">
          <div class="flex justify-end mb-2">
            <el-button v-if="canAddPlan()" size="small" type="primary" @click="planDialogVisible = true">
              新建计划
            </el-button>
          </div>
          <el-table :data="plans" size="small">
            <el-table-column prop="name" label="计划名称" min-width="150" show-overflow-tooltip />
            <el-table-column label="计划金额" width="110" align="right">
              <template #default="{ row }">¥{{ Number(row.planAmount ?? 0).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="计划日期" width="110">
              <template #default="{ row }">{{ formatDate(row.planEndTime) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="row.planStatus === 'COMPLETED' ? 'success' : row.planStatus === 'PARTIALLY_COMPLETED' ? 'warning' : 'info'"
                >
                  {{ CONTRACT_PAYMENT_PLAN_STATUS_LABELS[row.planStatus as keyof typeof CONTRACT_PAYMENT_PLAN_STATUS_LABELS] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="ownerName" label="负责人" width="100" />
            <el-table-column label="操作" width="70">
              <template #default="{ row }">
                <el-button v-if="canDeletePlan()" link type="danger" size="small" @click="removePlan(row as ContractPaymentPlanVO)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="回款记录" name="records">
          <div class="flex justify-end mb-2">
            <el-button v-if="canAddRecord()" size="small" type="primary" @click="recordDialogVisible = true">
              登记回款
            </el-button>
          </div>
          <el-table :data="records" size="small">
            <el-table-column prop="name" label="记录名称" min-width="150" show-overflow-tooltip />
            <el-table-column prop="no" label="回款编码" width="150" />
            <el-table-column label="金额" width="120" align="right">
              <template #default="{ row }">¥{{ Number(row.recordAmount ?? 0).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="回款日期" width="110">
              <template #default="{ row }">{{ formatDate(row.recordEndTime) }}</template>
            </el-table-column>
            <el-table-column label="回款计划" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">{{ row.paymentPlanName ?? '-' }}</template>
            </el-table-column>
            <el-table-column prop="ownerName" label="负责人" width="100" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="发票" name="invoices">
          <div class="flex justify-end gap-2 mb-2">
            <el-button v-if="canAddTitle()" size="small" @click="titleDialogVisible = true">
              新建抬头
            </el-button>
            <el-button v-if="canAddInvoice()" size="small" type="primary" @click="invoiceDialogVisible = true">
              开票申请
            </el-button>
          </div>
          <el-table :data="invoices" size="small">
            <el-table-column prop="name" label="发票名称" min-width="150" show-overflow-tooltip />
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">¥{{ Number(row.amount ?? 0).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="invoiceType" label="类型" width="130" />
            <el-table-column label="抬头" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.businessTitleName ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="税率" width="80">
              <template #default="{ row }">{{ row.taxRate == null ? '-' : `${row.taxRate}%` }}</template>
            </el-table-column>
            <el-table-column label="审批状态" width="100">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="row.approvalStatus === 'APPROVED' ? 'success' : row.approvalStatus === 'UNAPPROVED' || row.approvalStatus === 'REVOKED' ? 'info' : 'warning'"
                >
                  {{ invoiceApprovalLabel(row.approvalStatus) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="订单" name="orders">
          <div class="flex justify-end mb-2">
            <el-button v-if="auth.hasPerm('ORDER:ADD')" size="small" type="primary" @click="convertToOrder">
              转订单
            </el-button>
          </div>
          <OrderTable :standalone="false" :contract-id="contractId ?? undefined" />
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="planDialogVisible" title="新建回款计划" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="计划名称" required>
          <el-input v-model="planForm.name" />
        </el-form-item>
        <el-form-item label="计划金额" required>
          <el-input-number v-model="planForm.planAmount" :min="0.01" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
        <el-form-item label="计划日期" required>
          <el-date-picker v-model="planForm.planEndTime" type="date" value-format="YYYY-MM-DD" class="!w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="planDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addPlan">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="recordDialogVisible" title="登记回款" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="记录名称" required>
          <el-input v-model="recordForm.name" />
        </el-form-item>
        <el-form-item label="关联计划">
          <el-select v-model="recordForm.paymentPlanId" clearable placeholder="可选" class="w-full">
            <el-option
              v-for="p in plans.filter((p) => p.planStatus !== 'COMPLETED')"
              :key="p.id"
              :label="`${p.name} · ¥${Number(p.planAmount ?? 0).toLocaleString('zh-CN')}`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="回款金额" required>
          <el-input-number v-model="recordForm.recordAmount" :min="0.01" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
        <el-form-item label="回款日期" required>
          <el-date-picker v-model="recordForm.recordEndTime" type="date" value-format="YYYY-MM-DD" class="!w-full" />
        </el-form-item>
        <el-form-item label="收款银行" required>
          <el-select v-model="recordForm.bank" class="w-full">
            <el-option label="中国银行" value="1" />
            <el-option label="中国农业银行" value="2" />
            <el-option label="中国工商银行" value="3" />
            <el-option label="中国建设银行" value="4" />
          </el-select>
        </el-form-item>
        <el-form-item label="收款账号" required>
          <el-select v-model="recordForm.bankNo" class="w-full">
            <el-option label="银行账号1" value="1" />
            <el-option label="银行账号2" value="2" />
            <el-option label="银行账号3" value="3" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="recordDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addRecord">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="invoiceDialogVisible" title="开票申请" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="发票名称" required>
          <el-input v-model="invoiceForm.name" />
        </el-form-item>
        <el-form-item label="工商抬头">
          <el-select v-model="invoiceForm.businessTitleId" clearable placeholder="选择已审核抬头" class="w-full">
            <el-option
              v-for="t in titles"
              :key="t.id"
              :label="t.identificationNumber ? `${t.name}（${t.identificationNumber}）` : t.name"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="开票金额" required>
          <el-input-number v-model="invoiceForm.amount" :min="0.01" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
        <el-form-item label="发票类型">
          <el-select v-model="invoiceForm.invoiceType" class="w-full">
            <el-option v-for="t in INVOICE_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="税率">
          <el-input-number v-model="invoiceForm.taxRate" :min="0" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="invoiceDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addInvoice">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="titleDialogVisible" title="新建工商抬头" width="460px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="工商抬头" :required="titleFieldRequired('name')">
          <el-input v-model="titleForm.name" />
        </el-form-item>
        <el-form-item label="统一信用代码" :required="titleFieldRequired('identification_number')">
          <el-input v-model="titleForm.identificationNumber" />
        </el-form-item>
        <el-form-item label="开户行" :required="titleFieldRequired('opening_bank')">
          <el-input v-model="titleForm.openingBank" />
        </el-form-item>
        <el-form-item label="银行账号" :required="titleFieldRequired('bank_account')">
          <el-input v-model="titleForm.bankAccount" />
        </el-form-item>
        <el-form-item label="注册地址" :required="titleFieldRequired('registration_address')">
          <el-input v-model="titleForm.registrationAddress" />
        </el-form-item>
        <el-form-item label="电话" :required="titleFieldRequired('phone_number')">
          <el-input v-model="titleForm.phoneNumber" />
        </el-form-item>
        <el-form-item label="注册资本" :required="titleFieldRequired('registered_capital')">
          <el-input v-model="titleForm.registeredCapital" />
        </el-form-item>
        <el-form-item label="公司规模" :required="titleFieldRequired('company_size')">
          <el-input v-model="titleForm.companySize" />
        </el-form-item>
        <el-form-item label="注册号" :required="titleFieldRequired('registration_number')">
          <el-input v-model="titleForm.registrationNumber" />
        </el-form-item>
        <el-form-item label="省份" :required="titleFieldRequired('province')">
          <el-input v-model="titleForm.province" />
        </el-form-item>
        <el-form-item label="城市" :required="titleFieldRequired('city')">
          <el-input v-model="titleForm.city" />
        </el-form-item>
        <el-form-item label="规模" :required="titleFieldRequired('scale')">
          <el-input v-model="titleForm.scale" />
        </el-form-item>
        <el-form-item label="行业" :required="titleFieldRequired('industry')">
          <el-input v-model="titleForm.industry" />
        </el-form-item>
        <el-form-item label="备注" :required="titleFieldRequired('remark')">
          <el-input v-model="titleForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="titleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addTitle">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>
