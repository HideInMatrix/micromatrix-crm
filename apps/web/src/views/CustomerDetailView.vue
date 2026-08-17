<script setup lang="ts">
import {
  CONTRACT_STATUS_LABELS,
  type CustomerRelatedVO,
  type CustomerVO,
  type TeamMemberVO,
} from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCustomer, getCustomerRelated } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { contactApi, customerExtraApi, type ContactVO } from '@/api/sales'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import CustomerRelationsPanel from '@/components/CustomerRelationsPanel.vue'
import OwnerHistoryTimeline from '@/components/OwnerHistoryTimeline.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const customer = ref<CustomerVO | null>(null)
const related = ref<CustomerRelatedVO | null>(null)
const loading = ref(false)
const activeTab = ref('info')
const followVisible = ref(false)
const canCollaborateWrite = computed(
  () => customer.value?.canCollaborateWrite === true && auth.hasPerm('customer:update'),
)
const canManageCustomer = computed(() => customer.value?.canManageCustomer === true)
const canEditRelations = computed(
  () =>
    auth.hasPerm('customer:update') &&
    (customer.value?.canManageCustomer === true || customer.value?.collaborationType === 'COLLABORATION'),
)

const contactDialogVisible = ref(false)
const editingContact = ref<ContactVO | null>(null)
const contactForm = ref({ name: '', position: '', phone: '', email: '' })
const teamDialogVisible = ref(false)

const customerId = () => String(route.params.id)

async function loadAll() {
  loading.value = true
  try {
    const [custRes, relatedRes] = await Promise.all([
      getCustomer(customerId()),
      getCustomerRelated(customerId()),
    ])
    customer.value = custRes.data
    related.value = relatedRes.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function formatAmount(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return '-'
  return `¥${amount.toLocaleString('zh-CN')}`
}

function openContactCreate() {
  editingContact.value = null
  contactForm.value = { name: '', position: '', phone: '', email: '' }
  contactDialogVisible.value = true
}

function openContactEdit(contact: ContactVO) {
  editingContact.value = contact
  contactForm.value = {
    name: contact.name,
    position: contact.position ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
  }
  contactDialogVisible.value = true
}

async function handleContactSave() {
  if (!contactForm.value.name.trim()) {
    ElMessage.warning('请输入姓名')
    return
  }
  try {
    const payload = {
      name: contactForm.value.name.trim(),
      position: contactForm.value.position.trim() || undefined,
      phone: contactForm.value.phone.trim() || undefined,
      email: contactForm.value.email.trim() || undefined,
    }
    if (editingContact.value) {
      await contactApi.update(editingContact.value.id, payload)
    } else {
      await contactApi.create({ ...payload, customerId: customerId() })
    }
    ElMessage.success('联系人已保存')
    contactDialogVisible.value = false
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleContactDelete(contact: ContactVO) {
  const confirmed = await ElMessageBox.confirm(`删除联系人「${contact.name}」？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  await contactApi.remove(contact.id)
  ElMessage.success('已删除')
  loadAll()
}

async function handleTeamAdd(userId: string) {
  try {
    await customerExtraApi.teamAdd(customerId(), userId)
    ElMessage.success('已加入团队')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleTeamRemove(member: TeamMemberVO) {
  const confirmed = await ElMessageBox.confirm(`移除团队成员「${member.userName}」？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  await customerExtraApi.teamRemove(customerId(), member.id)
  ElMessage.success('已移除')
  loadAll()
}

onMounted(async () => {
  await fieldRefs.load()
  loadAll()
})
</script>

<template>
  <div>
    <div class="flex-between mb-4">
      <div class="flex items-center gap-3">
        <el-button @click="router.push('/customers')">返回列表</el-button>
        <h2 class="text-lg font-semibold m-0">{{ customer?.name ?? '客户详情' }}</h2>
      </div>
      <el-button v-if="canCollaborateWrite" type="primary" @click="followVisible = true">
        写跟进
      </el-button>
    </div>

    <div v-loading="loading">
      <el-row :gutter="12" class="mb-4">
        <el-col :span="6">
          <el-card shadow="never">
            <div class="text-xs text-[var(--el-text-color-secondary)]">商机</div>
            <div class="text-xl font-semibold mt-1">{{ related?.stats.opportunityCount ?? 0 }}</div>
            <div class="text-xs mt-1">{{ formatAmount(related?.stats.opportunityAmount) }}</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="never">
            <div class="text-xs text-[var(--el-text-color-secondary)]">合同</div>
            <div class="text-xl font-semibold mt-1">{{ related?.stats.contractCount ?? 0 }}</div>
            <div class="text-xs mt-1">{{ formatAmount(related?.stats.contractAmount) }}</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="never">
            <div class="text-xs text-[var(--el-text-color-secondary)]">已回款</div>
            <div class="text-xl font-semibold mt-1 text-[var(--el-color-success)]">
              {{ formatAmount(related?.stats.paidAmount) }}
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="never">
            <div class="text-xs text-[var(--el-text-color-secondary)]">联系人 / 团队</div>
            <div class="text-xl font-semibold mt-1">
              {{ related?.contacts.length ?? 0 }} / {{ related?.team.length ?? 0 }}
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="基本信息" name="info">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="客户名称">{{ customer?.name }}</el-descriptions-item>
              <el-descriptions-item label="负责人">{{ customer?.ownerName ?? '-' }}</el-descriptions-item>
              <el-descriptions-item label="行业">{{ customer?.industry ?? '-' }}</el-descriptions-item>
              <el-descriptions-item label="电话">{{ customer?.phone ?? '-' }}</el-descriptions-item>
              <el-descriptions-item label="邮箱">{{ customer?.email ?? '-' }}</el-descriptions-item>
              <el-descriptions-item label="创建时间">
                {{ customer ? new Date(customer.createdAt).toLocaleString() : '-' }}
              </el-descriptions-item>
              <el-descriptions-item label="备注" :span="2">{{ customer?.remark ?? '-' }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane label="联系人" name="contacts">
            <div class="flex justify-end mb-2">
              <el-button
                v-if="canCollaborateWrite && auth.hasPerm('contact:create')"
                size="small"
                type="primary"
                @click="openContactCreate"
              >
                添加联系人
              </el-button>
            </div>
            <el-table :data="related?.contacts ?? []" stripe>
              <el-table-column prop="name" label="姓名" min-width="120" />
              <el-table-column prop="position" label="职位" width="120" />
              <el-table-column prop="phone" label="电话" width="140" />
              <el-table-column prop="email" label="邮箱" min-width="160" />
              <el-table-column label="操作" width="140">
                <template #default="{ row }">
                  <el-button
                    v-if="canCollaborateWrite && auth.hasPerm('contact:update')"
                    link
                    type="primary"
                    @click="openContactEdit(row as ContactVO)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    v-if="canCollaborateWrite && auth.hasPerm('contact:delete')"
                    link
                    type="danger"
                    @click="handleContactDelete(row as ContactVO)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="商机" name="opportunities">
            <el-table :data="related?.opportunities ?? []" stripe>
              <el-table-column prop="name" label="商机" min-width="180" />
              <el-table-column prop="stageName" label="阶段" width="120" />
              <el-table-column label="金额" width="140" align="right">
                <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
              </el-table-column>
              <el-table-column prop="ownerName" label="负责人" width="120" />
              <el-table-column label="创建" width="120">
                <template #default="{ row }">{{ row.createdAt.slice(0, 10) }}</template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="合同与回款" name="contracts">
            <el-table :data="related?.contracts ?? []" stripe>
              <el-table-column prop="name" label="合同" min-width="180" />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  {{ CONTRACT_STATUS_LABELS[row.status as keyof typeof CONTRACT_STATUS_LABELS] ?? row.status }}
                </template>
              </el-table-column>
              <el-table-column label="合同额" width="130" align="right">
                <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
              </el-table-column>
              <el-table-column label="已回款" width="130" align="right">
                <template #default="{ row }">
                  <span class="text-[var(--el-color-success)]">{{ formatAmount(row.paidAmount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="创建" width="120">
                <template #default="{ row }">{{ row.createdAt.slice(0, 10) }}</template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="跟进记录" name="follows">
            <el-timeline>
              <el-empty
                v-if="!related?.followUps.length"
                description="暂无跟进记录"
                :image-size="60"
              />
              <el-timeline-item
                v-for="record in related?.followUps ?? []"
                :key="record.id"
                :timestamp="`${new Date(record.createdAt).toLocaleString()} · ${record.ownerName}`"
                placement="top"
              >
                <div class="text-sm">
                  <el-tag size="small" class="mr-1">{{ record.type }}</el-tag>
                  {{ record.content }}
                </div>
              </el-timeline-item>
            </el-timeline>
          </el-tab-pane>

          <el-tab-pane label="客户关系" name="relations">
            <CustomerRelationsPanel
              v-if="customer"
              :customer-id="customer.id"
              :readonly="!canEditRelations"
            />
          </el-tab-pane>

          <el-tab-pane label="负责人历史" name="owner-history">
            <OwnerHistoryTimeline
              v-if="customer"
              module="customer"
              :resource-id="customer.id"
            />
          </el-tab-pane>

          <el-tab-pane label="团队" name="team">
            <div class="flex justify-end mb-2">
              <el-button
                v-if="canManageCustomer && auth.hasPerm('customer:team')"
                size="small"
                type="primary"
                @click="teamDialogVisible = true"
              >
                添加成员
              </el-button>
            </div>
            <el-table :data="related?.team ?? []" stripe>
              <el-table-column prop="userName" label="成员" min-width="160" />
              <el-table-column prop="role" label="角色" width="140" />
              <el-table-column label="加入时间" width="180">
                <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button
                    v-if="canManageCustomer && auth.hasPerm('customer:team')"
                    link
                    type="danger"
                    @click="handleTeamRemove(row as TeamMemberVO)"
                  >
                    移除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <FollowUpDrawer
      v-model="followVisible"
      target-type="customer"
      :target-id="customer?.id ?? null"
      :target-name="customer?.name"
      @followed="loadAll"
    />

    <el-dialog
      v-model="contactDialogVisible"
      :title="editingContact ? '编辑联系人' : '添加联系人'"
      width="420px"
    >
      <el-form label-width="70px">
        <el-form-item label="姓名" required>
          <el-input v-model="contactForm.name" />
        </el-form-item>
        <el-form-item label="职位">
          <el-input v-model="contactForm.position" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="contactForm.phone" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="contactForm.email" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="contactDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleContactSave">保存</el-button>
      </template>
    </el-dialog>

    <MemberSelectDialog
      v-model="teamDialogVisible"
      title="添加协作成员"
      :members="fieldRefs.members.value"
      @confirm="handleTeamAdd"
    />
  </div>
</template>
