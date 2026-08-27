<script setup lang="ts">
import type {
  EnterpriseUiAssetSlot,
  EnterpriseUiSettingVO,
  UpdateEnterpriseUiSettingInput,
} from '@micromatrix/shared'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { attachmentApi } from '@/api/attachments'
import { enterpriseUiSettingApi } from '@/api/enterprise-settings'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useEnterpriseUiStore } from '@/stores/enterprise-ui'

const auth = useAuthStore()
const enterpriseUi = useEnterpriseUiStore()
const route = useRoute()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const saving = ref(false)
const uploadingSlot = ref<EnterpriseUiAssetSlot | null>(null)
const setting = ref<EnterpriseUiSettingVO | null>(null)

const defaults: UpdateEnterpriseUiSettingInput = {
  theme: 'default',
  customTheme: '#008d91',
  style: 'default',
  customStyle: '#f9fbfb',
  title: 'MicroMatrix CRM',
  slogan: '让客户关系更清晰，让销售协作更高效',
  helpDoc: 'https://github.com/HideInMatrix/micromatrix-crm',
}

const form = reactive<UpdateEnterpriseUiSettingInput>({ ...defaults })
const previewUrls = reactive<Record<EnterpriseUiAssetSlot, string>>({
  icon: '',
  loginLogo: '',
  loginImage: '',
  platformLogo: '',
})

const assetCards: Array<{
  slot: EnterpriseUiAssetSlot
  title: string
  tip: string
  property: 'icon' | 'loginLogo' | 'loginImage' | 'platformLogo'
}> = [
  { slot: 'icon', title: '浏览器图标', tip: '建议使用正方形 PNG / SVG / WEBP', property: 'icon' },
  { slot: 'loginLogo', title: '登录页 Logo', tip: '用于登录页品牌区域', property: 'loginLogo' },
  { slot: 'loginImage', title: '登录背景图', tip: '建议使用横向高清图片', property: 'loginImage' },
  {
    slot: 'platformLogo',
    title: '平台 Logo',
    tip: '用于登录后的平台头部',
    property: 'platformLogo',
  },
]

function copyToForm(data: EnterpriseUiSettingVO) {
  Object.assign(form, {
    theme: data.theme,
    customTheme: data.customTheme,
    style: data.style,
    customStyle: data.customStyle,
    title: data.title,
    slogan: data.slogan,
    helpDoc: data.helpDoc,
  })
}

function revokePreviews() {
  for (const slot of Object.keys(previewUrls) as EnterpriseUiAssetSlot[]) {
    if (previewUrls[slot]) URL.revokeObjectURL(previewUrls[slot])
    previewUrls[slot] = ''
  }
}

async function refreshPreviews(data: EnterpriseUiSettingVO) {
  revokePreviews()
  await Promise.all(
    assetCards.map(async ({ slot, property }) => {
      const asset = data[property]
      if (!asset) return
      try {
        previewUrls[slot] = await attachmentApi.objectUrl(asset.id)
      } catch {
        previewUrls[slot] = ''
      }
    }),
  )
}

async function acceptSetting(data: EnterpriseUiSettingVO) {
  setting.value = data
  copyToForm(data)
  if (auth.user?.tenantSlug) {
    enterpriseUi.acceptSetting(data, auth.user.tenantSlug)
    enterpriseUi.setDocumentTitle(route.meta.title)
  }
  await refreshPreviews(data)
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await enterpriseUiSettingApi.get()
    await acceptSetting(data)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const { data } = await enterpriseUiSettingApi.update({ ...form })
    await acceptSetting(data)
    ElMessage.success('界面设置已保存并应用')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function restoreTextAndTheme() {
  Object.assign(form, defaults)
}

async function handleAssetInput(slot: EnterpriseUiAssetSlot, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 10MB')
    return
  }
  uploadingSlot.value = slot
  try {
    const { data } = await enterpriseUiSettingApi.replaceAsset(slot, file)
    await acceptSetting(data)
    ElMessage.success('图片已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    uploadingSlot.value = null
  }
}

async function clearAsset(slot: EnterpriseUiAssetSlot) {
  try {
    const { data } = await enterpriseUiSettingApi.clearAsset(slot)
    await acceptSetting(data)
    ElMessage.success('已恢复默认资源')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(loadData)
onBeforeUnmount(revokePreviews)
</script>

<template>
  <div v-loading="loading" class="flex flex-col gap-4">
    <el-card shadow="never" class="rounded-1.5">
      <template #header>
        <div class="flex items-center justify-between">
          <strong>平台风格</strong>
          <el-button v-if="canUpdate" text type="primary" @click="restoreTextAndTheme"
            >恢复默认</el-button
          >
        </div>
      </template>

      <div class="flex flex-col gap-4.5">
        <div class="min-h-8 flex items-center gap-4">
          <span class="w-18 font-medium">主题色</span>
          <el-radio-group v-model="form.theme" :disabled="!canUpdate">
            <el-radio-button value="default">默认</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
          <el-color-picker
            v-if="form.theme === 'custom'"
            v-model="form.customTheme"
            :disabled="!canUpdate"
          />
        </div>
        <div class="min-h-8 flex items-center gap-4">
          <span class="w-18 font-medium">平台背景</span>
          <el-radio-group v-model="form.style" :disabled="!canUpdate">
            <el-radio-button value="default">默认</el-radio-button>
            <el-radio-button value="follow">跟随主题</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
          <el-color-picker
            v-if="form.style === 'custom'"
            v-model="form.customStyle"
            :disabled="!canUpdate"
          />
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="rounded-1.5">
      <template #header><strong>登录页配置</strong></template>
      <el-form label-position="top" class="max-w-180">
        <el-form-item label="平台标题">
          <el-input v-model="form.title" maxlength="255" :disabled="!canUpdate" />
        </el-form-item>
        <el-form-item label="登录 Slogan">
          <el-input v-model="form.slogan" maxlength="255" :disabled="!canUpdate" />
        </el-form-item>
        <el-form-item label="帮助文档地址">
          <el-input v-model="form.helpDoc" maxlength="1024" :disabled="!canUpdate" />
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="rounded-1.5">
      <template #header><strong>品牌图片资源</strong></template>
      <div class="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
        <div
          v-for="asset in assetCards"
          :key="asset.slot"
          class="min-w-0 rounded-1.5 border border-[var(--el-border-color-lighter)] p-3.5"
        >
          <div
            class="mx-auto mb-3 aspect-square w-full max-w-64 shrink-0 grid place-items-center overflow-hidden rounded bg-[var(--el-fill-color-light)] p-2.5 text-xs text-[var(--el-text-color-secondary)]"
          >
            <img
              v-if="previewUrls[asset.slot]"
              :src="previewUrls[asset.slot]"
              :alt="asset.title"
              class="block h-auto max-h-full w-auto max-w-full object-contain object-center"
            />
            <span v-else>默认资源</span>
          </div>
          <strong>{{ asset.title }}</strong>
          <div
            class="mt-1 min-h-8 overflow-hidden text-ellipsis text-xs text-[var(--el-text-color-secondary)]"
          >
            {{ setting?.[asset.property]?.name || asset.tip }}
          </div>
          <div v-if="canUpdate" class="mt-2.5 flex items-center gap-1">
            <label
              class="el-button el-button--primary is-plain m-0 cursor-pointer"
              :class="{ 'is-disabled': uploadingSlot === asset.slot }"
            >
              {{ uploadingSlot === asset.slot ? '上传中...' : '上传替换' }}
              <input
                type="file"
                accept="image/*"
                hidden
                :disabled="uploadingSlot !== null"
                @change="handleAssetInput(asset.slot, $event)"
              />
            </label>
            <el-button v-if="setting?.[asset.property]" text @click="clearAsset(asset.slot)"
              >恢复默认</el-button
            >
          </div>
        </div>
      </div>
    </el-card>

    <div
      v-if="canUpdate"
      class="sticky bottom-0 z-5 flex justify-end bg-[var(--el-bg-color-page)] py-3"
    >
      <el-button type="primary" :loading="saving" @click="save">保存并应用</el-button>
    </div>
  </div>
</template>
