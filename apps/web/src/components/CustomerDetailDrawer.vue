<script setup lang="ts">
import type { CustomerVO, TeamMemberVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { getCustomer } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { customerExtraApi, followUpApi } from '@/api/sales'
import type { FollowUpVO } from '@micromatrix/shared'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import CustomerRelationsPanel from '@/components/CustomerRelationsPanel.vue'
import OwnerHistoryTimeline from '@/components/OwnerHistoryTimeline.vue'
import CustomerContactTable from '@/components/contacts/CustomerContactTable.vue'
import type { MemberOption } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  customer: CustomerVO | null
  members: MemberOption[]
  pool?: boolean
}>()

const visible = defineModel<boolean>({ required: true })
const auth = useAuthStore()

const activeTab = ref('contacts')
const team = ref<TeamMemberVO[]>([])
const followUps = ref<FollowUpVO[]>([])
const loading = ref(false)
const collaborationType = ref<CustomerVO['collaborationType']>(null)
const resourceCanManageCustomer = ref(false)
const resourceCanCollaborateWrite = ref(false)
const canManageCustomer = computed(() => resourceCanManageCustomer.value)
const canEditRelations = computed(
  () => auth.hasPerm('customer:update') && resourceCanManageCustomer.value,
)

const teamDialogVisible = ref(false)

watch(visible, (open) => {
  if (open && props.customer) {
    activeTab.value = 'contacts'
    loadAll()
  }
})

async function loadAll() {
  if (!props.customer) return
  loading.value = true
  try {
    const [customerRes, teamRes, followRes] = await Promise.all([
      getCustomer(props.customer.id, props.pool),
      props.pool
        ? Promise.resolve({ data: [] as TeamMemberVO[] })
        : customerExtraApi.teamList(props.customer.id),
      props.pool
        ? Promise.resolve({ data: [] as FollowUpVO[] })
        : followUpApi.list('customer', props.customer.id),
    ])
    collaborationType.value = customerRes.data.collaborationType ?? null
    resourceCanManageCustomer.value = customerRes.data.canManageCustomer === true
    resourceCanCollaborateWrite.value = customerRes.data.canCollaborateWrite === true
    team.value = teamRes.data
    followUps.value = followRes.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleTeamAdd(userId: string) {
  if (!props.customer) return
  try {
    await customerExtraApi.teamAdd(props.customer.id, userId)
    ElMessage.success('已加入团队')
    loadAll()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleTeamRemove(member: TeamMemberVO) {
  if (!props.customer) return
  const confirmed = await ElMessageBox.confirm(`移除团队成员「${member.userName}」？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  await customerExtraApi.teamRemove(props.customer.id, member.id)
  ElMessage.success('已移除')
  loadAll()
}
</script>

<template>
  <el-drawer v-model="visible" :title="customer?.name ?? '客户详情'" size="520px">
    <div v-loading="loading">
      <el-descriptions :column="2" border size="small" class="mb-4">
        <el-descriptions-item label="行业">{{ customer?.industry ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="负责人">{{ customer?.ownerName ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="电话">{{ customer?.phone ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="邮箱">{{ customer?.email ?? '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-tabs v-if="!pool" v-model="activeTab">
        <el-tab-pane label="联系人" name="contacts">
          <CustomerContactTable
            v-if="customer"
            :source-id="customer.id"
            :readonly="!resourceCanCollaborateWrite"
          />
        </el-tab-pane>

        <el-tab-pane label="协作团队" name="team">
          <div class="flex justify-end mb-2">
            <el-button
              v-if="canManageCustomer && auth.hasPerm('customer:update')"
              size="small"
              type="primary"
              @click="teamDialogVisible = true"
            >
              添加成员
            </el-button>
          </div>
          <el-empty v-if="team.length === 0" description="暂无协作成员" :image-size="60" />
          <div
            v-for="member in team"
            :key="member.id"
            class="flex-between py-2.5 border-b border-[var(--el-border-color-lighter)]"
          >
            <span class="text-sm">{{ member.userName }}</span>
            <el-button
              v-if="canManageCustomer && auth.hasPerm('customer:update')"
              link
              type="danger"
              size="small"
              @click="handleTeamRemove(member)"
            >
              移除
            </el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane label="跟进记录" name="follows">
          <el-timeline>
            <el-empty v-if="followUps.length === 0" description="暂无跟进记录" :image-size="60" />
            <el-timeline-item
              v-for="record in followUps"
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
      </el-tabs>
    </div>

    <MemberSelectDialog
      v-model="teamDialogVisible"
      title="添加协作成员"
      :members="props.members"
      @confirm="handleTeamAdd"
    />
  </el-drawer>
</template>
