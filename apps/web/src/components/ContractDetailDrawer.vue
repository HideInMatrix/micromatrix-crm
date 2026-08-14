<script setup lang="ts">
import {
  CONTRACT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPES,
  RECEIVABLE_METHODS,
  RECEIVABLE_PLAN_STATUS_LABELS,
  type ContractVO,
  type InvoiceTitleVO,
  type InvoiceVO,
  type ReceivablePlanVO,
  type ReceivableRecordVO,
} from '@micromatrix/shared'
import { reactive, ref, watch } from 'vue'
import { contractApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import AttachmentUploader from '@/components/AttachmentUploader.vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ contractId: string | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ changed: [] }>()
const auth = useAuthStore()

const detail = ref<ContractVO | null>(null)
const plans = ref<ReceivablePlanVO[]>([])
const records = ref<ReceivableRecordVO[]>([])
const invoices = ref<InvoiceVO[]>([])
const titles = ref<InvoiceTitleVO[]>([])
const loading = ref(false)
const activeTab = ref('items')

const planDialogVisible = ref(false)
const planForm = reactive({ amount: 0, dueDate: '', remark: '' })

const recordDialogVisible = ref(false)
const recordForm = reactive({ planId: '', amount: 0, receivedAt: '', method: '银行转账', remark: '' })

const invoiceDialogVisible = ref(false)
const invoiceForm = reactive({ titleId: '', amount: 0, type: '增值税普通发票', remark: '' })

const titleDialogVisible = ref(false)
const titleForm = reactive({ name: '', taxNo: '', bankName: '', bankAccount: '', address: '', phone: '' })

watch(visible, (open) => {
  if (open && props.contractId) loadAll()
})

async function loadAll() {
  if (!props.contractId) return
  loading.value = true
  try {
    const [detailRes, planRes, recordRes, invoiceRes, titleRes] = await Promise.all([
      contractApi.detail(props.contractId),
      contractApi.plans(props.contractId),
      contractApi.records(props.contractId),
      contractApi.invoices(props.contractId),
      contractApi.titles(),
    ])
    detail.value = detailRes.data
    plans.value = planRes.data
    records.value = recordRes.data
    invoices.value = invoiceRes.data
    titles.value = titleRes.data
    emit('changed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function addPlan() {
  if (!props.contractId || !planForm.amount || !planForm.dueDate) {
    ElMessage.warning('请填写金额与日期')
    return
  }
  try {
    await contractApi.createPlan({
      contractId: props.contractId,
      amount: planForm.amount,
      dueDate: planForm.dueDate,
      remark: planForm.remark || undefined,
    })
    planDialogVisible.value = false
    Object.assign(planForm, { amount: 0, dueDate: '', remark: '' })
    ElMessage.success('回款计划已创建')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removePlan(plan: ReceivablePlanVO) {
  const confirmed = await ElMessageBox.confirm(`删除第 ${plan.period} 期回款计划？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await contractApi.removePlan(plan.id)
    ElMessage.success('已删除')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function addRecord() {
  if (!props.contractId || !recordForm.amount || !recordForm.receivedAt) {
    ElMessage.warning('请填写金额与回款日期')
    return
  }
  try {
    await contractApi.createRecord({
      contractId: props.contractId,
      planId: recordForm.planId || undefined,
      amount: recordForm.amount,
      receivedAt: recordForm.receivedAt,
      method: recordForm.method || undefined,
      remark: recordForm.remark || undefined,
    })
    recordDialogVisible.value = false
    Object.assign(recordForm, { planId: '', amount: 0, receivedAt: '', method: '银行转账', remark: '' })
    ElMessage.success('回款已登记')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function addInvoice() {
  if (!props.contractId || !invoiceForm.amount) {
    ElMessage.warning('请填写开票金额')
    return
  }
  try {
    await contractApi.createInvoice({
      contractId: props.contractId,
      titleId: invoiceForm.titleId || undefined,
      amount: invoiceForm.amount,
      type: invoiceForm.type,
      remark: invoiceForm.remark || undefined,
    })
    invoiceDialogVisible.value = false
    Object.assign(invoiceForm, { titleId: '', amount: 0, type: '增值税普通发票', remark: '' })
    ElMessage.success('开票申请已创建')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function issueInvoice(invoice: InvoiceVO) {
  const result = await ElMessageBox.prompt('输入发票号码', '标记已开票', {
    inputPattern: /.+/,
    inputErrorMessage: '请输入发票号码',
  }).catch(() => null)
  if (!result) return
  try {
    await contractApi.issueInvoice(invoice.id, result.value)
    ElMessage.success('已开票')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function voidInvoice(invoice: InvoiceVO) {
  const confirmed = await ElMessageBox.confirm('作废该发票记录？', '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  await contractApi.voidInvoice(invoice.id)
  ElMessage.success('已作废')
  loadAll()
}

async function addTitle() {
  if (!titleForm.name || !titleForm.taxNo) {
    ElMessage.warning('抬头与税号必填')
    return
  }
  try {
    await contractApi.createTitle({
      ...titleForm,
      customerId: detail.value?.customerId,
    })
    titleDialogVisible.value = false
    Object.assign(titleForm, { name: '', taxNo: '', bankName: '', bankAccount: '', address: '', phone: '' })
    ElMessage.success('抬头已保存')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

const canManageReceivable = () => auth.hasPerm('receivable:manage')
const canManageInvoice = () => auth.hasPerm('invoice:manage')
</script>

<template>
  <el-drawer v-model="visible" :title="detail ? `${detail.name}（${detail.code}）` : '合同详情'" size="640px">
    <div v-loading="loading">
      <el-descriptions v-if="detail" :column="3" border size="small" class="mb-4">
        <el-descriptions-item label="客户">{{ detail.customerName }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          {{ CONTRACT_STATUS_LABELS[detail.status] }}
        </el-descriptions-item>
        <el-descriptions-item label="签约日期">{{ detail.signedAt ?? '-' }}</el-descriptions-item>
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

      <el-tabs v-model="activeTab">
        <el-tab-pane label="合同明细" name="items">
          <el-table :data="detail?.items ?? []" size="small">
            <el-table-column prop="productName" label="产品/项目" min-width="180" />
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column label="单价" width="110" align="right">
              <template #default="{ row }">¥{{ row.unitPrice.toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="折扣" width="70">
              <template #default="{ row }">{{ row.discount }}%</template>
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
            <el-button v-if="canManageReceivable()" size="small" type="primary" @click="planDialogVisible = true">
              新建计划
            </el-button>
          </div>
          <el-table :data="plans" size="small">
            <el-table-column prop="period" label="期次" width="60" />
            <el-table-column label="计划金额" width="110" align="right">
              <template #default="{ row }">¥{{ row.amount.toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="已回" width="110" align="right">
              <template #default="{ row }">¥{{ row.paidAmount.toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="dueDate" label="到期日" width="105" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="row.status === 'PAID' ? 'success' : row.status === 'OVERDUE' ? 'danger' : row.status === 'PARTIAL' ? 'warning' : 'info'"
                >
                  {{ RECEIVABLE_PLAN_STATUS_LABELS[row.status as keyof typeof RECEIVABLE_PLAN_STATUS_LABELS] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70">
              <template #default="{ row }">
                <el-button v-if="canManageReceivable()" link type="danger" size="small" @click="removePlan(row as ReceivablePlanVO)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="回款记录" name="records">
          <div class="flex justify-end mb-2">
            <el-button v-if="canManageReceivable()" size="small" type="primary" @click="recordDialogVisible = true">
              登记回款
            </el-button>
          </div>
          <el-table :data="records" size="small">
            <el-table-column label="金额" width="120" align="right">
              <template #default="{ row }">¥{{ row.amount.toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="receivedAt" label="回款日期" width="105" />
            <el-table-column label="期次" width="70">
              <template #default="{ row }">{{ row.planPeriod ? `第${row.planPeriod}期` : '-' }}</template>
            </el-table-column>
            <el-table-column prop="method" label="方式" width="90" />
            <el-table-column prop="ownerName" label="经办人" width="90" />
            <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="发票" name="invoices">
          <div class="flex justify-end gap-2 mb-2">
            <el-button v-if="canManageInvoice()" size="small" @click="titleDialogVisible = true">
              新建抬头
            </el-button>
            <el-button v-if="canManageInvoice()" size="small" type="primary" @click="invoiceDialogVisible = true">
              开票申请
            </el-button>
          </div>
          <el-table :data="invoices" size="small">
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">¥{{ row.amount.toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="130" />
            <el-table-column label="抬头" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.titleName ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="85">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="row.status === 'ISSUED' ? 'success' : row.status === 'VOID' ? 'info' : 'warning'"
                >
                  {{ INVOICE_STATUS_LABELS[row.status as keyof typeof INVOICE_STATUS_LABELS] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="发票号" width="130">
              <template #default="{ row }">{{ row.invoiceNo ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <template v-if="row.status === 'PENDING' && canManageInvoice()">
                  <el-button link type="success" size="small" @click="issueInvoice(row as InvoiceVO)">
                    开票
                  </el-button>
                  <el-button link type="danger" size="small" @click="voidInvoice(row as InvoiceVO)">
                    作废
                  </el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="planDialogVisible" title="新建回款计划" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="计划金额" required>
          <el-input-number v-model="planForm.amount" :min="0.01" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
        <el-form-item label="到期日期" required>
          <el-date-picker v-model="planForm.dueDate" type="date" value-format="YYYY-MM-DD" class="!w-full" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="planForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="planDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addPlan">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="recordDialogVisible" title="登记回款" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="关联计划">
          <el-select v-model="recordForm.planId" clearable placeholder="可选" class="w-full">
            <el-option
              v-for="p in plans.filter((p) => p.status !== 'PAID')"
              :key="p.id"
              :label="`第${p.period}期 ¥${p.amount}（已回 ¥${p.paidAmount}）`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="回款金额" required>
          <el-input-number v-model="recordForm.amount" :min="0.01" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
        <el-form-item label="回款日期" required>
          <el-date-picker v-model="recordForm.receivedAt" type="date" value-format="YYYY-MM-DD" class="!w-full" />
        </el-form-item>
        <el-form-item label="回款方式">
          <el-select v-model="recordForm.method" class="w-full">
            <el-option v-for="m in RECEIVABLE_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="recordForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="recordDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addRecord">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="invoiceDialogVisible" title="开票申请" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="工商抬头">
          <el-select v-model="invoiceForm.titleId" clearable placeholder="选择抬头" class="w-full">
            <el-option v-for="t in titles" :key="t.id" :label="`${t.name}（${t.taxNo}）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="开票金额" required>
          <el-input-number v-model="invoiceForm.amount" :min="0.01" :precision="2" controls-position="right" class="!w-full" />
        </el-form-item>
        <el-form-item label="发票类型">
          <el-select v-model="invoiceForm.type" class="w-full">
            <el-option v-for="t in INVOICE_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="invoiceForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="invoiceDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addInvoice">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="titleDialogVisible" title="新建工商抬头" width="460px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="发票抬头" required>
          <el-input v-model="titleForm.name" />
        </el-form-item>
        <el-form-item label="税号" required>
          <el-input v-model="titleForm.taxNo" />
        </el-form-item>
        <el-form-item label="开户行">
          <el-input v-model="titleForm.bankName" />
        </el-form-item>
        <el-form-item label="银行账号">
          <el-input v-model="titleForm.bankAccount" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="titleForm.address" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="titleForm.phone" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="titleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addTitle">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>
