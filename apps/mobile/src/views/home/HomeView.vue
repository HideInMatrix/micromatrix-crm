<script setup lang="ts">
import {
  DEFAULT_LEAD_STAGES,
  type FieldVO,
  type HomeAnalyticsVO,
  type HomeLeadStatistic,
  type LeadStageConfig,
  type LeadVO,
  type NotificationVO,
} from '@micromatrix/shared'
import { ChevronRight, GitPullRequest } from 'lucide-vue-next'
import { computed, onActivated, ref } from 'vue'
import { showFailToast } from 'vant'
import { useRouter } from 'vue-router'
// 设计图素材由 PC public 统一维护，Vite 会将引用文件打包进 Mobile 构建产物。
import defaultAvatar from '../../../../web/public/images/avatar.png'
import homeBackground from '../../../../web/public/images/home-background.png'
import { homeApi } from '@/api/home'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi } from '@/api/sales'
import { notificationApi } from '@/api/system'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileLeadListCard from '@/components/lead/MobileLeadListCard.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const refreshing = ref(false)
const loaded = ref(false)
const now = ref(new Date())
const todayStatistic = ref<HomeLeadStatistic | null>(null)
const analytics = ref<HomeAnalyticsVO | null>(null)
const pendingPoolCount = ref<number | null>(null)
const unreadCount = ref<number | null>(null)
const notifications = ref<NotificationVO[]>([])
const leads = ref<LeadVO[]>([])
const leadFields = ref<FieldVO[]>([])
const leadStages = ref<LeadStageConfig[]>([])
const followTarget = ref<LeadVO | null>(null)
const followVisible = ref(false)
let requestId = 0

const canReadLeads = computed(() => auth.hasPerm('menu:lead'))
const canAccessPools = computed(() => auth.hasPerm('leadPool:read'))
const canWriteFollow = computed(() => auth.hasPerm('lead:update'))
const greeting = computed(() => {
  const hour = now.value.getHours()
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

// 首页与线索大厅使用同一张卡片、字段展示及操作区域。
const leadStageNames = computed(() =>
  Object.fromEntries(
    [...DEFAULT_LEAD_STAGES, ...leadStages.value].map((stage) => [stage.key, stage.name]),
  ),
)

function messageTime(date: string): string {
  const value = new Date(date)
  if (Number.isNaN(value.getTime())) return '-'
  const time = value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return value.toDateString() === now.value.toDateString()
    ? `今天 ${time}`
    : `${value.getMonth() + 1}/${value.getDate()} ${time}`
}

async function loadStatistics() {
  if (!canReadLeads.value) return
  const request = { searchType: 'SELF' as const, deptIds: [] }
  const [statistic, summary] = await Promise.all([
    homeApi.lead(request),
    homeApi.analytics(request),
  ])
  todayStatistic.value = statistic.data
  analytics.value = summary.data
}

async function loadPendingPools() {
  if (!canAccessPools.value) return
  const { data: pools } = await leadApi.poolOptions()
  const totals = await Promise.all(
    pools.map(async (pool) => {
      const response = await leadApi.list({ scope: 'pool', poolId: pool.id, page: 1, pageSize: 1 })
      return response.data.total
    }),
  )
  pendingPoolCount.value = totals.reduce((total, count) => total + count, 0)
}

async function loadNotifications() {
  const [list, count] = await Promise.all([
    notificationApi.list({ page: 1, pageSize: 2 }),
    notificationApi.unreadCount(),
  ])
  notifications.value = list.data.items
  unreadCount.value = count.data.count
}

async function loadMyLeads() {
  if (!canReadLeads.value) return
  const [list, metadata] = await Promise.all([
    leadApi.list({
      page: 1,
      pageSize: 3,
      homeFilter: JSON.stringify({ module: 'lead', searchType: 'SELF', deptIds: [] }),
    }),
    metadataApi.formConfig('lead'),
    fieldRefs.load(),
  ])
  leads.value = list.data.items.slice(0, 3)
  leadFields.value = metadata.data.fields
  leadStages.value = metadata.data.formProp.leadStages ?? []
}

async function refresh() {
  const current = ++requestId
  now.value = new Date()
  refreshing.value = true
  const results = await Promise.allSettled([
    loadStatistics(),
    loadPendingPools(),
    loadNotifications(),
    loadMyLeads(),
  ])
  if (current !== requestId) return
  loaded.value = true
  refreshing.value = false
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') showFailToast(extractErrorMessage(failed.reason))
}

function openLead(lead: LeadVO) {
  void router.push({ path: '/leads/detail', query: { id: lead.id, name: lead.name } })
}

function callLead(lead: LeadVO) {
  const number = lead.phone?.replace(/[^\d+]/g, '') ?? ''
  if (!number) return showFailToast('暂无可联系的手机号')
  window.location.href = `tel:${number}`
}

function canFollowLead(lead: LeadVO): boolean {
  return canWriteFollow.value && lead.transitionType !== 'CUSTOMER'
}

function followLead(lead: LeadVO) {
  if (!canFollowLead(lead)) return
  followTarget.value = lead
  followVisible.value = true
}

async function openMessage(item: NotificationVO) {
  try {
    if (!item.readAt) {
      await notificationApi.markRead(item.id)
      item.readAt = new Date().toISOString()
      unreadCount.value = Math.max(0, (unreadCount.value ?? 0) - 1)
    }
    if (!item.link) return
    if (/^https?:\/\//i.test(item.link)) {
      window.location.href = item.link
    } else if (item.link.startsWith('/mobile/')) {
      await router.push(item.link.slice('/mobile'.length) || '/home')
    }
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

onActivated(() => void refresh())
</script>

<template>
  <div class="h-full min-h-0 overflow-y-auto bg-[#F4F6F9]">
    <van-pull-refresh v-model="refreshing" class="min-h-full" @refresh="refresh">
      <section
        class="relative flex h-[126px] items-start gap-[10px] bg-cover bg-center bg-no-repeat p-[12px_16px]"
        :style="{ backgroundImage: `url(${homeBackground})` }"
        aria-label="欢迎回来"
      >
        <van-button
          class="!h-[60px] !w-[60px] shrink-0 !rounded-full !border-0 !bg-transparent !p-0"
          aria-label="进入个人中心"
          @click="router.push('/mine')"
        >
          <van-image
            round
            fit="cover"
            width="60"
            height="60"
            :src="defaultAvatar"
            class="box-border overflow-hidden rounded-full border-2 border-white"
          >
            <template #error>
              <van-image round fit="cover" width="60" height="60" :src="defaultAvatar" />
            </template>
          </van-image>
        </van-button>
        <div class="min-w-0 flex-1">
          <div class="truncate text-[18px] font-semibold leading-[26px] text-black">
            {{ greeting }}，{{ auth.user?.name || '老师' }}
          </div>
          <div class="mt-1 truncate text-[12px] leading-[18px] text-[#7D89A3]">
            {{ auth.user?.deptName || '职业教育招生办' }}
          </div>
        </div>
      </section>

      <main class="relative -mt-[44px] flex flex-col gap-[12px] px-[12px] pb-6">
        <section
          class="flex h-[66px] shrink-0 items-center rounded-[8px] bg-white shadow-sm"
          aria-label="线索统计"
        >
          <van-button
            class="!h-full !min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0"
            :disabled="!canReadLeads"
            @click="router.push('/leads')"
          >
            <div class="flex flex-col items-center gap-[5px]">
              <strong
                class="text-[24px] leading-[28px] font-bold tabular-nums text-[var(--van-primary-color)]"
                >{{
                  todayStatistic?.todayClue.value ??
                  (loaded && canReadLeads ? '--' : canReadLeads ? '...' : '-')
                }}</strong
              >
              <span class="text-[10px] leading-[14px] text-[#333333]">今日新增线索</span>
            </div>
          </van-button>
          <span class="h-[52px] w-px shrink-0 bg-[#E9EDF4]" />
          <van-button
            class="!h-full !min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0"
            :disabled="!canAccessPools"
            @click="router.push({ path: '/leads', query: { tab: 'pool' } })"
          >
            <div class="flex flex-col items-center gap-[5px]">
              <strong
                class="text-[24px] leading-[28px] font-bold tabular-nums text-[var(--van-primary-color)]"
                >{{
                  pendingPoolCount ??
                  (loaded && canAccessPools ? '--' : canAccessPools ? '...' : '-')
                }}</strong
              >
              <span class="text-[10px] leading-[14px] text-[#333333]">待分配线索</span>
            </div>
          </van-button>
          <span class="h-[52px] w-px shrink-0 bg-[#E9EDF4]" />
          <van-button
            class="!h-full !min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0"
            :disabled="!canReadLeads"
            @click="router.push('/leads')"
          >
            <div class="flex flex-col items-center gap-[5px]">
              <strong class="text-[24px] leading-[28px] font-bold tabular-nums text-[#F04438]">{{
                analytics?.summary.overdueLeads ??
                (loaded && canReadLeads ? '--' : canReadLeads ? '...' : '-')
              }}</strong>
              <span class="text-[10px] leading-[14px] text-[#333333]">超时待跟进</span>
            </div>
          </van-button>
        </section>

        <section class="rounded-[8px] bg-white p-[10px]" aria-labelledby="mobile-home-messages">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <h2
                id="mobile-home-messages"
                class="m-0 text-[16px] leading-[20px] font-semibold text-[#1D2129]"
              >
                消息中心
              </h2>
              <van-badge v-if="unreadCount" :content="unreadCount" :max="99" color="#F04438" />
            </div>
            <van-button
              class="!h-auto !border-0 !bg-transparent !p-0 !text-[12px] !font-normal !text-[var(--van-primary-color)]"
              @click="router.push('/mine/message')"
            >
              <span class="inline-flex items-center gap-[2px] whitespace-nowrap leading-none">
                查看全部
                <ChevronRight
                  :size="10"
                  class="shrink-0 text-[var(--van-primary-color)]"
                  aria-hidden="true"
                />
              </span>
            </van-button>
          </div>
          <div v-if="!loaded" class="flex justify-center py-5"><van-loading size="22" /></div>
          <van-empty
            v-else-if="notifications.length === 0"
            image-size="60"
            description="暂无新消息"
            class="!py-4"
          />
          <div v-else class="flex flex-col gap-[12px]">
            <div
              v-for="item in notifications"
              :key="item.id"
              class="flex cursor-pointer items-start gap-[5px]"
              role="button"
              tabindex="0"
              @click="openMessage(item)"
              @keydown.enter="openMessage(item)"
            >
              <div
                class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_srgb,var(--van-primary-color)_8%,white)] text-[var(--van-primary-color)]"
              >
                <GitPullRequest :size="16" :stroke-width="2.3" aria-hidden="true" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-start justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-1">
                    <span
                      class="truncate text-[12px] leading-[16px] font-semibold text-[#333333]"
                      >{{ item.title }}</span
                    >
                    <span
                      v-if="!item.readAt"
                      class="h-[5px] w-[5px] shrink-0 rounded-full bg-[#F04438]"
                    />
                  </div>
                  <span
                    class="shrink-0 whitespace-nowrap text-[12px] leading-[16px] text-[#8A97AC]"
                    >{{ messageTime(item.createdAt) }}</span
                  >
                </div>
                <p class="mt-[3px] mb-0 truncate text-[10px] leading-[14px] text-[#666666]">
                  {{ item.content || '暂无详细内容' }}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="mobile-home-leads">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2
              id="mobile-home-leads"
              class="m-0 text-[17px] leading-[24px] font-semibold text-[#172033]"
            >
              我的线索
            </h2>
            <van-button
              class="!h-auto !border-0 !bg-transparent !p-0 !text-[13px] !text-[var(--van-primary-color)]"
              :disabled="!canReadLeads"
              @click="router.push('/leads')"
            >
              <span class="inline-flex items-center gap-[2px] whitespace-nowrap leading-none">
                查看全部
                <ChevronRight :size="16" class="shrink-0" aria-hidden="true" />
              </span>
            </van-button>
          </div>
          <div v-if="!loaded" class="flex justify-center py-6"><van-loading size="22" /></div>
          <van-empty
            v-else-if="leads.length === 0"
            image-size="72"
            :description="canReadLeads ? '暂无待跟进线索' : '暂无线索查看权限'"
            class="rounded-[8px] bg-white !py-8"
          />
          <div v-else class="flex flex-col gap-[12px]">
            <MobileLeadListCard
              v-for="lead in leads"
              :key="lead.id"
              :lead="lead"
              :fields="leadFields"
              :member-map="fieldRefs.memberMap.value"
              :dept-map="fieldRefs.deptMap.value"
              :stage-names="leadStageNames"
              :can-follow="canFollowLead(lead)"
              @open="openLead(lead)"
              @call="callLead(lead)"
              @follow="followLead(lead)"
            />
          </div>
        </section>
      </main>
    </van-pull-refresh>

    <MobileFollowUpSheet
      v-model="followVisible"
      target-type="lead"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="refresh"
    />
  </div>
</template>
