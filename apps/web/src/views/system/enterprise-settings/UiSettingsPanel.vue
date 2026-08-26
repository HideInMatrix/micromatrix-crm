<script setup lang="ts">
import type {
  EnterpriseUiAssetSlot,
  EnterpriseUiSettingVO,
  UpdateEnterpriseUiSettingInput,
} from '@micromatrix/shared'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { enterpriseUiSettingApi } from '@/api/enterprise-settings'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { applyEnterpriseUiTheme } from '@/utils/enterprise-ui-theme'

const auth = useAuthStore()
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
  applyEnterpriseUiTheme(data)
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
  <div v-loading="loading" class="ui-settings-panel">
    <el-card shadow="never" class="settings-section">
      <template #header>
        <div class="section-header">
          <div>
            <strong>平台风格</strong>
            <div class="section-tip">
              对齐 Cordys 的主题色与平台背景设置，保存后立即应用到当前页面。
            </div>
          </div>
          <el-button v-if="canUpdate" text type="primary" @click="restoreTextAndTheme"
            >恢复默认</el-button
          >
        </div>
      </template>

      <div class="style-grid">
        <div class="style-row">
          <span class="style-label">主题色</span>
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
        <div class="style-row">
          <span class="style-label">平台背景</span>
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

    <el-card shadow="never" class="settings-section">
      <template #header>
        <div>
          <strong>登录页配置</strong>
          <div class="section-tip">
            标题、Slogan 与登录页品牌资源独立保存，不再写入通用 SystemSetting。
          </div>
        </div>
      </template>
      <div class="preview-form-grid">
        <div class="login-preview">
          <div class="preview-window-head">
            <img v-if="previewUrls.icon" :src="previewUrls.icon" alt="icon" />
            <span>{{ form.title || 'MicroMatrix CRM' }}</span>
          </div>
          <div
            class="preview-login-body"
            :style="
              previewUrls.loginImage ? { backgroundImage: `url(${previewUrls.loginImage})` } : {}
            "
          >
            <div class="preview-login-card">
              <img v-if="previewUrls.loginLogo" :src="previewUrls.loginLogo" alt="login logo" />
              <div v-else class="preview-brand">MicroMatrix</div>
              <strong>{{ form.slogan || '欢迎登录' }}</strong>
              <div class="preview-input"></div>
              <div class="preview-input"></div>
              <div class="preview-button">登录</div>
            </div>
          </div>
        </div>
        <el-form label-position="top" class="brand-form">
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
      </div>
    </el-card>

    <el-card shadow="never" class="settings-section">
      <template #header><strong>品牌图片资源</strong></template>
      <div class="asset-grid">
        <div v-for="asset in assetCards" :key="asset.slot" class="asset-card">
          <div class="asset-preview">
            <img v-if="previewUrls[asset.slot]" :src="previewUrls[asset.slot]" :alt="asset.title" />
            <span v-else>默认资源</span>
          </div>
          <strong>{{ asset.title }}</strong>
          <div class="asset-name">{{ setting?.[asset.property]?.name || asset.tip }}</div>
          <div v-if="canUpdate" class="asset-actions">
            <label
              class="el-button el-button--primary is-plain"
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

    <div v-if="canUpdate" class="save-bar">
      <el-button type="primary" :loading="saving" @click="save">保存并应用</el-button>
    </div>
  </div>
</template>

<style scoped>
.ui-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 72px;
}
.settings-section {
  border-radius: 6px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-tip,
.asset-name {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.style-grid {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.style-row {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 16px;
}
.style-label {
  width: 72px;
  font-weight: 500;
}
.preview-form-grid {
  display: grid;
  grid-template-columns: minmax(420px, 1.3fr) minmax(300px, 0.7fr);
  gap: 28px;
}
.login-preview {
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.preview-window-head {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-size: 11px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.preview-window-head img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.preview-login-body {
  min-height: 300px;
  display: grid;
  place-items: center;
  background: var(--el-fill-color-extra-light);
  background-size: cover;
  background-position: center;
}
.preview-login-card {
  width: 220px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: color-mix(in srgb, var(--el-bg-color) 94%, transparent);
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
}
.preview-login-card img {
  max-width: 140px;
  max-height: 44px;
  object-fit: contain;
  object-position: left center;
}
.preview-brand {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-color-primary);
}
.preview-input {
  height: 28px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color);
}
.preview-button {
  height: 30px;
  display: grid;
  place-items: center;
  color: white;
  font-size: 12px;
  border-radius: 4px;
  background: var(--el-color-primary);
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.asset-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.asset-preview {
  height: 90px;
  margin-bottom: 12px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.asset-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.asset-name {
  min-height: 32px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.asset-actions label.el-button {
  margin: 0;
  cursor: pointer;
}
.save-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  justify-content: flex-end;
  padding: 12px 0;
  background: var(--el-bg-color-page);
}
@media (max-width: 1100px) {
  .asset-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .preview-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
