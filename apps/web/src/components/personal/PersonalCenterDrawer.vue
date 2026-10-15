<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import type { FollowUpPlanVO } from '@micromatrix/shared'
import { UserRound, X } from 'lucide-vue-next'
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
import PasswordFormFields from './PasswordFormFields.vue'

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
const editForm = reactive({ phone: '', email: '', language: 'zh-CN' as 'zh-CN' | 'en-US' })
const passwordForm = reactive({ originPassword: '', password: '', confirmPassword: '' })

const plans = ref<FollowUpPlanVO[]>([])
const planTotal = ref(0)
const planPage = ref(1)
const planPageSize = 10
const planLoading = ref(false)

const initials = computed(() => (info.value?.userName || auth.user?.name || '?').slice(0, 1))

const profileRows = computed(() => [
  { label: '用户名', value: info.value?.userName || '-' },
  { label: '手机号', value: info.value?.phone || '-' },
  { label: '邮箱', value: info.value?.email || '-' },
  { label: '所属部门', value: info.value?.departmentName || '-' },
  {
    label: '通知语言',
    value: info.value ? (info.value.language === 'en-US' ? 'English' : '简体中文') : '-',
  },
  { label: '账号角色', value: info.value?.roles.map((role) => role.name).join('、') || '-' },
])

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
  editForm.language = info.value?.language ?? 'zh-CN'
  editVisible.value = true
}

async function saveInfo() {
  const phone = editForm.phone.trim()
  const email = editForm.email.trim()
  if (!phone) return ElMessage.warning('请输入手机号')
  if (!/^\S+@\S+\.\S+$/.test(email)) return ElMessage.warning('请输入正确的邮箱')
  saving.value = true
  try {
    const { data } = await updatePersonalInfo({ phone, email, language: editForm.language })
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

function openPasswordFromEdit() {
  editVisible.value = false
  openPassword()
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
  return { PREPARED: '待开始', UNDERWAY: '进行中', COMPLETED: '已完成', CANCELLED: '已取消' }[
    status
  ]
}

watch([visible, activeTab], ([show, tab], [wasOpen, previousTab]) => {
  if (!show) return
  // Profile header is shown on every tab, including API Key and My Plans.
  if (!wasOpen) void loadInfo()
  if (tab === 'plan' && (!wasOpen || previousTab !== 'plan')) void loadPlans()
})
</script>

<template>
  <el-drawer
    v-model="visible"
    size="660px"
    :with-header="false"
    destroy-on-close
    class="personal-center-drawer"
    data-testid="personal-center-drawer"
  >
    <div class="flex h-full min-h-0 flex-col bg-white text-[#303133]">
      <header
        class="flex h-[58px] min-h-[58px] shrink-0 items-center justify-between bg-[#F7F8FA] px-5"
      >
        <h2 class="m-0 text-[18px] leading-[26px] font-medium text-black">个人信息</h2>
        <button
          type="button"
          aria-label="关闭个人信息"
          class="flex h-[18px] w-[18px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[#999999] hover:text-[var(--el-color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--el-color-primary)] focus-visible:outline-offset-2"
          @click="visible = false"
        >
          <X :size="18" :stroke-width="2" aria-hidden="true" />
        </button>
      </header>

      <div v-loading="loading" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          class="m-5 flex min-h-[100px] shrink-0 items-center gap-3 rounded-[7px] bg-[#F7F8FA] px-[18px] py-[17px] max-sm:gap-[9px] max-sm:p-3"
        >
          <el-avatar
            :size="62"
            :src="info?.avatarUrl ?? undefined"
            class="shrink-0 bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
          >
            <UserRound v-if="initials === '?'" :size="36" :stroke-width="1.65" />
            <span v-else class="text-[24px]">{{ initials }}</span>
          </el-avatar>
          <div class="flex min-w-0 flex-1 flex-col gap-[6px]">
            <strong class="truncate text-[20px] leading-[28px] font-medium text-black">
              {{ info?.userName || auth.user?.name || '-' }}
            </strong>
            <div v-if="info?.roles?.length" class="flex flex-wrap gap-2">
              <span
                v-for="role in info.roles"
                :key="role.id"
                class="rounded-[4px] bg-[var(--el-color-primary-light-9)] px-2 py-[3px] text-[12px] leading-[18px] text-[var(--el-color-primary)]"
                >{{ role.name }}</span
              >
            </div>
          </div>
        </div>

        <el-tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
          <el-tab-pane label="基本信息" name="info">
            <div
              class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5 [scrollbar-gutter:stable]"
            >
              <section>
                <div class="mb-3 flex items-start justify-between gap-3">
                  <h3
                    class="m-0 flex items-center gap-[6px] text-[14px] leading-5 font-medium text-[#333333]"
                  >
                    <span
                      aria-hidden="true"
                      class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
                    />
                    账号信息
                  </h3>
                  <el-button
                    type="primary"
                    plain
                    class="!ml-0 !h-[36px] !rounded-[4px]"
                    @click="openEdit"
                    >编辑资料</el-button
                  >
                </div>

                <dl class="m-0">
                  <div
                    v-for="row in profileRows"
                    :key="row.label"
                    class="flex items-center gap-4 border-b border-[#E9EDF2] py-[17px] text-[14px] leading-5"
                  >
                    <dt class="w-[108px] shrink-0 text-[#999999]">{{ row.label }}</dt>
                    <dd class="m-0 min-w-0 flex-1 break-words text-[#333333]">{{ row.value }}</dd>
                  </div>
                </dl>
              </section>
            </div>
          </el-tab-pane>

          <el-tab-pane v-if="auth.hasPerm('PERSONAL_API_KEY:READ')" label="API Key" name="apiKey">
            <div
              class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5 [scrollbar-gutter:stable]"
            >
              <PersonalApiKeyPanel v-if="activeTab === 'apiKey'" />
            </div>
          </el-tab-pane>

          <!-- My Plans remains accessible from the top personal menu. -->
          <el-tab-pane v-if="activeTab === 'plan'" label="我的计划" name="plan">
            <div
              class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5 [scrollbar-gutter:stable]"
            >
              <div class="mb-4 flex items-center justify-between">
                <h3 class="m-0 text-[14px] font-medium">我的计划</h3>
                <el-button :loading="planLoading" @click="loadPlans">刷新</el-button>
              </div>
              <el-table v-loading="planLoading" :data="plans" empty-text="暂无跟进计划">
                <el-table-column prop="targetName" label="计划对象" min-width="120" />
                <el-table-column
                  prop="content"
                  label="计划内容"
                  min-width="180"
                  show-overflow-tooltip
                />
                <el-table-column label="状态" width="85">
                  <template #default="{ row }">{{ statusLabel(row.status) }}</template>
                </el-table-column>
                <el-table-column label="计划时间" width="170">
                  <template #default="{ row }">{{ formatTime(row.estimatedAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="75" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="openPlan(row as FollowUpPlanVO)"
                      >查看</el-button
                    >
                  </template>
                </el-table-column>
              </el-table>
              <div class="mt-4 flex justify-end">
                <el-pagination
                  v-model:current-page="planPage"
                  :page-size="planPageSize"
                  :total="planTotal"
                  layout="total, prev, pager, next"
                  @current-change="loadPlans"
                />
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <CrmDialog v-model="editVisible" title="编辑个人信息" width="460px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="手机号" required
          ><el-input v-model="editForm.phone" maxlength="11"
        /></el-form-item>
        <el-form-item label="邮箱" required><el-input v-model="editForm.email" /></el-form-item>
        <el-form-item label="通知语言" required>
          <el-select v-model="editForm.language" class="w-full">
            <el-option label="简体中文" value="zh-CN" />
            <el-option label="English" value="en-US" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="flex w-full items-center justify-between gap-3">
          <el-button v-if="info?.passwordLoginEnabled !== false" link @click="openPasswordFromEdit"
            >修改密码</el-button
          >
          <span v-else />
          <div class="flex items-center gap-2">
            <el-button @click="editVisible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="saveInfo">更新</el-button>
          </div>
        </div>
      </template>
    </CrmDialog>

    <CrmDialog v-model="passwordVisible" title="修改密码" width="352px" append-to-body>
      <PasswordFormFields
        v-model:current-password="passwordForm.originPassword"
        v-model:new-password="passwordForm.password"
        v-model:confirm-password="passwordForm.confirmPassword"
      />
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="savePassword">保存</el-button>
      </template>
    </CrmDialog>
  </el-drawer>
</template>

<style scoped>
:global(.personal-center-drawer.el-drawer) {
  max-width: 100vw;
}
:global(.personal-center-drawer .el-drawer__body) {
  padding: 0;
  min-height: 0;
  overflow: hidden;
}
:deep(.el-tabs__header) {
  --el-font-size-base: 16px;
  --el-text-color-primary: #666666;
  margin: 0;
  padding: 10px 20px;
  flex-shrink: 0;
}
:deep(.el-tabs__item) {
  font-weight: 600;
}
:deep(.el-tabs--top > .el-tabs__header .el-tabs__item:nth-child(2)),
:deep(.el-tabs--top > .el-tabs__header .el-tabs__item:last-child) {
  padding-inline: 20px;
}
:deep(.el-tabs__item.is-active) {
  background: #e8f3ff;
  color: var(--el-color-primary);
  border-radius: 8px 8px 0 0;
}
:deep(.el-tabs__content) {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
:deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}
@media (max-width: 600px) {
  :deep(.el-tabs__header) {
    padding: 10px 14px;
  }
}
</style>
