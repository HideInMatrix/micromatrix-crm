<script setup lang="ts">
import { onActivated, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { showFailToast } from 'vant'
import { useRouter } from 'vue-router'
import campus from '@/assets/profile/campus.png'
import passwordIcon from '@/assets/profile/change-password.svg'
import { extractErrorMessage } from '@/api/http'
import { getPersonalInfo, type PersonalCenterVO } from '@/api/personal-center'
import { useAuthStore } from '@/stores/auth'
import { showActionConfirm } from '@/utils/dialog'

const defaultAvatar = `${import.meta.env.BASE_URL}images/user.png`
const router = useRouter()
const auth = useAuthStore()
const info = ref<PersonalCenterVO | null>(null)
const loading = ref(false)

async function loadInfo() {
  loading.value = true
  try {
    const { data } = await getPersonalInfo()
    info.value = data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleLogout() {
  const confirmed = await showActionConfirm({ title: '退出登录', message: '确定退出当前账号？' })
  if (!confirmed) return
  const tenant = auth.user?.tenantSlug
  auth.logout()
  await router.replace({ name: 'mobile-login', query: tenant ? { tenant } : undefined })
}

onActivated(loadInfo)
</script>

<template>
  <div
    class="h-full overflow-y-auto bg-[#F5F5F5] bg-top bg-no-repeat pb-[28px]"
    style="
      background-image: linear-gradient(180deg, #e5efff 0%, #eef5ff 14%, #e4ebfe 45%, #f5f5f5 100%);
      background-size: 100% 211px;
    "
  >
    <div class="px-[12px] pt-[20px] pb-[20px]">
      <div
        class="relative flex h-[80px] items-center overflow-hidden rounded-[10px] bg-white px-[16px]"
        :style="{
          backgroundImage:
            'url(' + campus + '), linear-gradient(90deg, #FFFFFF 0%, #F8FBFF 52%, #E7F1FF 100%)',
          backgroundSize: '209px 59px, cover',
          backgroundPosition: 'right top, center',
          backgroundRepeat: 'no-repeat, no-repeat',
        }"
      >
        <van-image
          :src="info?.avatarUrl || auth.user?.avatarUrl || defaultAvatar"
          fit="cover"
          round
          width="60"
          height="60"
          class="shrink-0"
        />
        <div class="relative ml-[10px] min-w-0 flex-1">
          <div class="truncate text-[18px] leading-[25px] font-semibold text-[#333333]">
            {{ info?.userName || auth.user?.name || '-' }}
          </div>
          <div
            class="mt-[4px] inline-flex max-w-full rounded-[4px] bg-[var(--primary-7)] px-[5px] py-[2px] text-[12px] leading-[16px] text-[var(--primary-8)]"
          >
            <span class="truncate">{{
              info?.roles.map((role) => role.name).join('、') || '普通成员'
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <section
      class="mx-[12px] overflow-hidden rounded-[10px] bg-white px-[12px] pt-[12px] pb-[2px]"
      style="
        --van-cell-font-size: 16px;
        --van-cell-line-height: 22px;
        --van-cell-vertical-padding: 17px;
        --van-cell-horizontal-padding: 0px;
        --van-cell-text-color: #111111;
        --van-cell-background: transparent;
        --van-cell-border-color: #ededed;
        --van-cell-active-color: transparent;
        --van-padding-md: 0px;
      "
      aria-label="全部功能"
    >
      <h2 class="m-0 mb-[4px] text-[17px] leading-[18px] font-semibold text-[#111111]">全部功能</h2>
      <van-cell center clickable @click="router.push('/mine/basic-info')">
        <template #icon>
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            class="mr-[5px] shrink-0"
            aria-hidden="true"
          >
            <path
              d="M17.9967 3.05998H16.9985V2.02999C16.9985 1.46123 16.5508 1 15.998 1C15.4452 1 14.9975 1.46123 14.9975 2.02999V3.05998H7.00025V2.02999C7.00025 1.66197 6.80838 1.32262 6.5 1.13861C6.18934 0.954594 5.80787 0.954594 5.49949 1.13861C5.18883 1.32262 4.99924 1.66197 4.99924 2.02999V3.05998H4.00102C2.89772 3.06237 2.00457 3.98244 2 5.11519V18.94C2 20.0728 2.9 21 4.00102 21H17.999C19.1046 20.9976 19.9977 20.0752 20 18.94V5.11997C19.9954 3.98243 19.1023 3.06237 17.9967 3.05998ZM11.1508 6.3029C12.8365 6.30768 14.198 7.70331 14.2025 9.42395C14.198 11.1446 12.8365 12.5378 11.153 12.5426C9.46954 12.5378 8.10584 11.1446 8.10127 9.42395C8.10355 7.70331 9.46497 6.31007 11.1508 6.3029ZM16.9459 18.4716H5.04949V17.4823C5.04949 15.5059 9.01497 14.4162 10.9977 14.4162C12.9805 14.4162 16.9459 15.5035 16.9459 17.4823V18.4716Z"
              fill="var(--primary-8)"
            />
          </svg>
        </template>
        <template #title>
          <span class="text-[16px] leading-[22px] text-[#111111]">基本信息</span>
        </template>
        <template #right-icon>
          <ChevronRight :size="20" color="#999999" aria-hidden="true" />
        </template>
      </van-cell>
      <van-cell
        v-if="info?.passwordLoginEnabled"
        center
        clickable
        :border="false"
        @click="router.push('/mine/change-password')"
      >
        <template #icon>
          <img :src="passwordIcon" width="22" height="22" alt="" class="mr-[5px] shrink-0" />
        </template>
        <template #title>
          <span class="text-[16px] leading-[22px] text-[#111111]">修改密码</span>
        </template>
        <template #right-icon>
          <ChevronRight :size="20" color="#999999" aria-hidden="true" />
        </template>
      </van-cell>
    </section>

    <div class="mx-[12px] mt-[40px]">
      <van-button
        block
        class="font-medium"
        style="
          --van-button-default-height: 50px;
          --van-button-normal-font-size: 16px;
          --van-button-default-color: #f04438;
          --van-button-default-background: #ffffff;
          --van-button-default-border-color: transparent;
          --van-button-border-width: 0px;
          --van-button-radius: 10px;
        "
        :disabled="loading"
        @click="handleLogout"
      >
        退出登录
      </van-button>
    </div>
  </div>
</template>
