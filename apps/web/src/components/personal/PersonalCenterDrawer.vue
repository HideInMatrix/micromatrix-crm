<script setup lang="ts">
import type { FollowUpPlanVO } from '@micromatrix/shared'
import { KeyRound, Pencil } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import {
  getPersonalInfo,
  listPersonalPlans,
  resetPersonalPassword,
  updatePersonalInfo,
  type PersonalCenterVO,
} from '@/api/personal-center'
import { useAuthStore } from '@/stores/auth'
import PersonalApiKeyPanel from './PersonalApiKeyPanel.vue'

const visible = defineModel<boolean>('visible', { required: true })
const activeTab = defineModel<'info' | 'plan' | 'apiKey'>('activeTab', { default: 'info' })
const router = useRouter()
const auth = useAuthStore()

const loading = ref(false)
const info = ref<PersonalCenterVO | null>(null)
const editVisible = ref(false)
const passwordVisible = ref(false)
const saving = ref(false)
const passwordSaving = ref(false)
const editForm = reactive({ phone: '', email: '' })
const passwordForm = reactive({ originPassword: '', password: '', confirmPassword: '' })

const plans = ref<FollowUpPlanVO[]>([])
const planTotal = ref(0)
const planPage = ref(1)
const planPageSize = 10
const planLoading = ref(false)

const initials = computed(() => (info.value?.userName || auth.user?.name || '?').slice(0, 1))

async function loadInfo() {
  loading.value = true
  try {
    const { data } = await getPersonalInfo()
    info.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function loadPlans() {
  planLoading.value = true
  try {
    const { data } = await listPersonalPlans({ current: planPage.value, pageSize: planPageSize })
    plans.value = data.list
    planTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    planLoading.value = false
  }
}

function openEdit() {
  editForm.phone = info.value?.phone ?? ''
  editForm.email = info.value?.email ?? ''
  editVisible.value = true
}

async function saveInfo() {
  const phone = editForm.phone.trim()
  const email = editForm.email.trim()
  if (!phone) return ElMessage.warning('请输入手机号')
  if (!/^\S+@\S+\.\S+$/.test(email)) return ElMessage.warning('请输入正确的邮箱')
  saving.value = true
  try {
    const { data } = await updatePersonalInfo({ phone, email })
    info.value = data
    await auth.fetchMe(true)
    editVisible.value = false
    ElMessage.success('个人信息已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function openPassword() {
  Object.assign(passwordForm, { originPassword: '', password: '', confirmPassword: '' })
  passwordVisible.value = true
}

async function savePassword() {
  if (!passwordForm.originPassword) return ElMessage.warning('请输入当前密码')
  if (!passwordForm.password || passwordForm.password.length > 64) {
    return ElMessage.warning('请输入 1～64 位新密码')
  }
  if (!/(?=.*[A-Za-z])(?=.*\d)/.test(passwordForm.password)) {
    return ElMessage.warning('新密码至少包含字母和数字')
  }
  if (passwordForm.password !== passwordForm.confirmPassword) {
    return ElMessage.warning('两次输入的新密码不一致')
  }
  passwordSaving.value = true
  try {
    await resetPersonalPassword({
      originPassword: passwordForm.originPassword,
      password: passwordForm.password,
    })
    ElMessage.success('密码已修改，请重新登录')
    const tenant = auth.user?.tenantSlug
    auth.logout()
    visible.value = false
    await router.push({ name: 'login', query: tenant ? { tenant } : undefined })
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    passwordSaving.value = false
  }
}

function openPlan(plan: FollowUpPlanVO) {
  visible.value = false
  router.push({ path: '/follow-plans', query: { id: plan.id, mine: '1' } })
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-'
}

function statusLabel(status: FollowUpPlanVO['status']) {
  return { PREPARED: '待开始', UNDERWAY: '进行中', COMPLETED: '已完成', CANCELLED: '已取消' }[status]
}

watch([visible, activeTab], ([show, tab]) => {
  if (!show) return
  if (tab === 'info') void loadInfo()
  if (tab === 'plan') void loadPlans()
})
</script>

<template>
  <el-drawer
    v-model="visible"
    title="个人中心"
    size="100%"
    destroy-on-close
    data-testid="personal-center-drawer"
  >
    <div class="mx-auto max-w-[1180px]">
      <el-card shadow="never" class="mb-4">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="个人信息" name="info" />
          <el-tab-pane label="我的计划" name="plan" />
          <el-tab-pane v-if="auth.hasPerm('PERSONAL_API_KEY:READ')" label="API Key" name="apiKey" />
        </el-tabs>
      </el-card>

      <el-card v-if="activeTab === 'info'" v-loading="loading" shadow="never">
        <div class="font-medium mb-5">基本信息</div>
        <div class="flex items-center gap-4 py-3">
          <el-avatar :size="64" :src="info?.avatarUrl ?? undefined">{{ initials }}</el-avatar>
          <div class="min-w-0">
            <div class="text-base font-medium">{{ info?.userName ?? '-' }}</div>
            <div class="flex flex-wrap gap-2 mt-2">
              <el-tag v-for="role in info?.roles ?? []" :key="role.id" size="small" effect="light">
                {{ role.name }}
              </el-tag>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4 rounded-md bg-[var(--el-fill-color-light)] p-6 mt-4">
          <div><span class="text-[var(--el-text-color-secondary)]">手机号</span><span class="ml-3">{{ info?.phone || '-' }}</span></div>
          <div><span class="text-[var(--el-text-color-secondary)]">邮箱</span><span class="ml-3">{{ info?.email || '-' }}</span></div>
          <div><span class="text-[var(--el-text-color-secondary)]">部门</span><span class="ml-3">{{ info?.departmentName || '-' }}</span></div>
        </div>

        <div class="mt-6 flex gap-3">
          <el-button type="primary" plain @click="openEdit">
            <Pencil :size="16" class="mr-1" />编辑
          </el-button>
          <el-button v-if="info?.passwordLoginEnabled !== false" @click="openPassword">
            <KeyRound :size="16" class="mr-1" />修改密码
          </el-button>
        </div>
      </el-card>

      <el-card v-else-if="activeTab === 'plan'" shadow="never">
        <div class="flex items-center justify-between mb-4">
          <div class="font-medium">我的计划</div>
          <el-button :loading="planLoading" @click="loadPlans">刷新</el-button>
        </div>
        <el-table v-loading="planLoading" :data="plans" empty-text="暂无跟进计划">
          <el-table-column prop="targetName" label="计划对象" min-width="150" />
          <el-table-column prop="content" label="计划内容" min-width="260" show-overflow-tooltip />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">{{ statusLabel(row.status) }}</template>
          </el-table-column>
          <el-table-column label="计划时间" width="180">
            <template #default="{ row }">{{ formatTime(row.estimatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openPlan(row as FollowUpPlanVO)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="flex justify-end mt-4">
          <el-pagination
            v-model:current-page="planPage"
            :page-size="planPageSize"
            :total="planTotal"
            layout="total, prev, pager, next"
            @current-change="loadPlans"
          />
        </div>
      </el-card>

      <PersonalApiKeyPanel v-else-if="activeTab === 'apiKey'" />
    </div>

    <el-dialog v-model="editVisible" title="编辑个人信息" width="460px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="手机号" required><el-input v-model="editForm.phone" maxlength="11" /></el-form-item>
        <el-form-item label="邮箱" required><el-input v-model="editForm.email" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveInfo">更新</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordVisible" title="修改密码" width="460px" append-to-body>
      <el-form label-width="100px">
        <el-form-item label="当前密码" required><el-input v-model="passwordForm.originPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码" required><el-input v-model="passwordForm.password" type="password" show-password /></el-form-item>
        <el-form-item label="确认新密码" required><el-input v-model="passwordForm.confirmPassword" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>
