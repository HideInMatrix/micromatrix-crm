<script setup lang="ts">
import type { CustomerVO, TeamMemberVO } from '@micromatrix/shared'
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { contactApi, customerExtraApi, followUpApi, type ContactVO } from '@/api/sales'
import type { FollowUpVO } from '@micromatrix/shared'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import type { MemberOption } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  customer: CustomerVO | null
  members: MemberOption[]
}>()

const visible = defineModel<boolean>({ required: true })
const auth = useAuthStore()

const activeTab = ref('contacts')
const contacts = ref<ContactVO[]>([])
const team = ref<TeamMemberVO[]>([])
const followUps = ref<FollowUpVO[]>([])
const loading = ref(false)

const contactDialogVisible = ref(false)
const editingContact = ref<ContactVO | null>(null)
const contactForm = ref({ name: '', position: '', phone: '', email: '' })

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
    const [contactRes, teamRes, followRes] = await Promise.all([
      contactApi.list(props.customer.id),
      customerExtraApi.teamList(props.customer.id),
      followUpApi.list('customer', props.customer.id),
    ])
    contacts.value = contactRes.data
    team.value = teamRes.data
    followUps.value = followRes.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
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
  if (!props.customer) return
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
      await contactApi.create({ ...payload, customerId: props.customer.id })
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

      <el-tabs v-model="activeTab">
        <el-tab-pane label="联系人" name="contacts">
          <div class="flex justify-end mb-2">
            <el-button
              v-if="auth.hasPerm('contact:create')"
              size="small"
              type="primary"
              @click="openContactCreate"
            >
              添加联系人
            </el-button>
          </div>
          <el-empty v-if="contacts.length === 0" description="暂无联系人" :image-size="60" />
          <div
            v-for="contact in contacts"
            :key="contact.id"
            class="flex-between py-2.5 border-b border-[var(--el-border-color-lighter)]"
          >
            <div>
              <div class="text-sm font-medium">
                {{ contact.name }}
                <span class="text-xs text-[var(--el-text-color-secondary)] ml-1">
                  {{ contact.position ?? '' }}
                </span>
              </div>
              <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
                {{ contact.phone ?? '-' }} · {{ contact.email ?? '-' }}
              </div>
            </div>
            <div>
              <el-button
                v-if="auth.hasPerm('contact:update')"
                link
                type="primary"
                size="small"
                @click="openContactEdit(contact)"
              >
                编辑
              </el-button>
              <el-button
                v-if="auth.hasPerm('contact:delete')"
                link
                type="danger"
                size="small"
                @click="handleContactDelete(contact)"
              >
                删除
              </el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="协作团队" name="team">
          <div class="flex justify-end mb-2">
            <el-button
              v-if="auth.hasPerm('customer:team')"
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
              v-if="auth.hasPerm('customer:team')"
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
      </el-tabs>
    </div>

    <el-dialog
      v-model="contactDialogVisible"
      :title="editingContact ? '编辑联系人' : '添加联系人'"
      width="420px"
      append-to-body
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
      :members="props.members"
      @confirm="handleTeamAdd"
    />
  </el-drawer>
</template>
