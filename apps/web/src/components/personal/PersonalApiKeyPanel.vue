<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import {
  addPersonalApiKey,
  deletePersonalApiKey,
  disablePersonalApiKey,
  enablePersonalApiKey,
  listPersonalApiKeys,
  updatePersonalApiKey,
  type PersonalApiKeyVO,
} from '@/api/personal-center'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const loading = ref(false)
const adding = ref(false)
const rows = ref<PersonalApiKeyVO[]>([])
const revealed = reactive<Record<string, boolean>>({})
const settingsVisible = ref(false)
const settingsSaving = ref(false)
const settings = reactive({ id: '', forever: true, expireAt: null as Date | null, description: '' })

const canAdd = computed(() => auth.hasPerm('PERSONAL_API_KEY:ADD'))
const canUpdate = computed(() => auth.hasPerm('PERSONAL_API_KEY:UPDATE'))
const canDelete = computed(() => auth.hasPerm('PERSONAL_API_KEY:DELETE'))

async function load() {
  loading.value = true
  try {
    const { data } = await listPersonalApiKeys()
    rows.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function add() {
  adding.value = true
  try {
    await addPersonalApiKey()
    await load()
    ElMessage.success('API Key 已创建')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    adding.value = false
  }
}

function openSettings(row: PersonalApiKeyVO) {
  settings.id = row.id
  settings.forever = row.forever
  settings.expireAt = row.expireTime ? new Date(row.expireTime) : null
  settings.description = row.description
  settingsVisible.value = true
}

async function saveSettings() {
  if (!settings.forever && !settings.expireAt) return ElMessage.warning('请选择到期时间')
  settingsSaving.value = true
  try {
    await updatePersonalApiKey({
      id: settings.id,
      forever: settings.forever,
      expireTime: settings.forever ? undefined : settings.expireAt?.getTime(),
      description: settings.description,
    })
    settingsVisible.value = false
    await load()
    ElMessage.success('API Key 已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    settingsSaving.value = false
  }
}

async function toggle(row: PersonalApiKeyVO) {
  try {
    if (row.enable) {
      await ElMessageBox.confirm(
        '停用后使用该 Key 的 API 请求会立即失效，确认停用？',
        '停用 API Key',
        {
          type: 'warning',
        },
      )
      await disablePersonalApiKey(row.id)
    } else {
      await enablePersonalApiKey(row.id)
    }
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(row: PersonalApiKeyVO) {
  try {
    await ElMessageBox.confirm('删除后无法恢复，确认删除该 API Key？', '删除 API Key', {
      type: 'warning',
    })
    await deletePersonalApiKey(row.id)
    await load()
    ElMessage.success('API Key 已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value)
  ElMessage.success('已复制')
}

function validTime(row: PersonalApiKeyVO) {
  if (row.forever) return '永久有效'
  return row.expireTime ? new Date(row.expireTime).toLocaleString() : '-'
}

function expired(row: PersonalApiKeyVO) {
  return !row.forever && Boolean(row.expireTime && row.expireTime <= Date.now())
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="personal-api-key-panel" data-testid="personal-api-key-panel">
    <div class="mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h3
          class="m-0 flex items-center gap-[6px] text-[14px] leading-5 font-medium text-[#333333]"
        >
          <span
            aria-hidden="true"
            class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
          />
          API Key
        </h3>
        <p class="mb-0 mt-2 text-[12px] leading-5 text-[#999999]">
          用于开放 API 调用，请通过 X-Access-Key / X-Secret-Key 请求头传递。每个用户最多 5 个。
        </p>
      </div>
      <el-button
        v-if="canAdd"
        data-testid="personal-api-key-add"
        type="primary"
        plain
        class="!ml-0 !h-[36px] shrink-0 !rounded-[4px]"
        :loading="adding"
        :disabled="rows.length >= 5"
        @click="add"
      >
        新建Key
      </el-button>
    </div>

    <el-empty v-if="!loading && rows.length === 0" description="暂无 API Key">
      <el-button v-if="canAdd" type="primary" link @click="add">新建 API Key</el-button>
    </el-empty>

    <div v-else class="grid grid-cols-1 gap-4">
      <div
        v-for="row in rows"
        :key="row.id"
        data-testid="personal-api-key-card"
        class="personal-api-key-card p-5"
      >
        <div
          class="mb-4 flex min-w-0 items-center justify-between gap-3 border-b border-[#DFE4ED] pb-4"
        >
          <div class="min-w-0">
            <div class="text-[14px] leading-5 text-[#999999]">Access Key</div>
            <div class="mt-2 break-all font-mono text-[14px] leading-5 text-[#333333]">
              {{ row.accessKey }}
              <el-tag v-if="expired(row)" size="small" type="warning" class="ml-1">已过期</el-tag>
            </div>
          </div>
          <el-button type="primary" link class="!ml-0 shrink-0" @click="copy(row.accessKey)">
            复制
          </el-button>
        </div>

        <div class="mb-4 flex min-w-0 items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-[14px] leading-5 text-[#999999]">Secret Key</div>
            <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span class="min-w-0 break-all font-mono text-[14px] leading-5 text-[#333333]">
                {{ revealed[row.id] ? row.secretKey : row.secretKey.replace(/./g, '*') }}
              </span>
              <el-button
                type="primary"
                link
                class="!ml-0"
                @click="revealed[row.id] = !revealed[row.id]"
              >
                {{ revealed[row.id] ? '隐藏' : '显示' }}
              </el-button>
            </div>
          </div>
          <el-button type="primary" link class="!ml-0 shrink-0" @click="copy(row.secretKey)">
            复制
          </el-button>
        </div>

        <div class="grid grid-cols-1 gap-x-4 gap-y-3 text-[14px] leading-5 sm:grid-cols-2">
          <div>
            <span class="text-[#999999]">创建时间：</span>
            <span class="text-[#333333]">{{ new Date(row.createTime).toLocaleString() }}</span>
          </div>
          <div>
            <span class="text-[#999999]">有效期：</span>
            <span class="text-[#333333]">{{ validTime(row) }}</span>
          </div>
          <div class="sm:col-span-2">
            <span class="text-[#999999]">描述：</span>
            <span class="break-words text-[#333333]">{{ row.description || '---' }}</span>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3 text-[14px] text-[#333333]">
            <span>Key状态</span>
            <el-switch
              :model-value="row.enable"
              :disabled="!canUpdate"
              active-text="启用"
              inactive-text="停用"
              @click.prevent="toggle(row)"
            />
          </div>
          <div class="flex items-center gap-3">
            <el-button v-if="canUpdate" class="!ml-0" @click="openSettings(row)">
              有效期/描述
            </el-button>
            <el-button v-if="canDelete" type="danger" plain class="!ml-0" @click="remove(row)">
              删除
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <CrmDialog v-model="settingsVisible" title="设置有效期" width="480px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="时间设置">
          <el-radio-group v-model="settings.forever">
            <el-radio-button :value="true">永久有效</el-radio-button>
            <el-radio-button :value="false">自定义</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="!settings.forever" label="到期时间" required>
          <el-date-picker
            v-model="settings.expireAt"
            type="datetime"
            placeholder="请选择到期时间"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="settings.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" :loading="settingsSaving" @click="saveSettings">保存</el-button>
      </template>
    </CrmDialog>
  </div>
</template>

<style scoped>
/* Keep interactive blue in sync with the enterprise theme set on :root. */
.personal-api-key-panel {
  --el-switch-on-color: var(--el-color-primary);
}

.personal-api-key-card {
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid #dfe4ed;
}
</style>
