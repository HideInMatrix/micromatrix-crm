<script setup lang="ts">
import type { ExternalEventTemplateVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Code2, Pencil, Trash2 } from 'lucide-vue-next'
import { externalEventTemplateApi } from '@/api/external-events'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import ExternalEventEditorDrawer from './ExternalEventEditorDrawer.vue'
import ExternalEventApiDrawer from './ExternalEventApiDrawer.vue'

const auth = useAuthStore()
const route = useRoute()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const rows = ref<ExternalEventTemplateVO[]>([])
const search = ref('')
const filtered = computed(() =>
  rows.value.filter((row) =>
    `${row.name} ${row.eventType} ${row.source}`
      .toLowerCase()
      .includes(search.value.trim().toLowerCase()),
  ),
)
const editorVisible = ref(false)
const apiVisible = ref(false)
const editing = ref<ExternalEventTemplateVO | null>(null)
const selected = ref<ExternalEventTemplateVO | null>(null)
const switching = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    rows.value = (await externalEventTemplateApi.list()).data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}
function create() {
  editing.value = null
  editorVisible.value = true
}
function edit(row: ExternalEventTemplateVO) {
  editing.value = row
  editorVisible.value = true
}
function showApi(row: ExternalEventTemplateVO) {
  selected.value = row
  apiVisible.value = true
}
async function saved() {
  await load()
}
async function toggle(row: ExternalEventTemplateVO, enabled: boolean) {
  if (switching.value) return
  switching.value = row.id
  try {
    await externalEventTemplateApi.update(row.id, { enabled })
    ElMessage.success(enabled ? '事件已启用' : '事件已停用')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    switching.value = null
  }
}
async function remove(row: ExternalEventTemplateVO) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」的配置？请先停用。`, '删除外部事件', {
      type: 'warning',
    })
    await externalEventTemplateApi.remove(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(extractErrorMessage(error))
  }
}
onMounted(async () => {
  await load()
  const eventId = typeof route.query.eventId === 'string' ? route.query.eventId : ''
  const event = rows.value.find((row) => row.id === eventId)
  if (!event) return
  if (route.query.view === 'api') showApi(event)
  else if (canUpdate.value) edit(event)
})
</script>

<template>
  <section class="min-w-0" data-testid="external-event-settings">
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="m-0 text-[18px] font-semibold">外部事件</h2>
        <p class="mt-1 mb-0 text-[13px] text-[var(--el-text-color-secondary)]">
          通过 API Key 调用已启用的业务事件，单次请求完成资源定位、线索转客户及字段同步。
        </p>
      </div>
      <el-button v-if="canUpdate" type="primary" @click="create"
        ><Plus :size="16" class="mr-1" /> 新建事件</el-button
      >
    </header>
    <el-card shadow="never">
      <el-input
        v-model="search"
        clearable
        placeholder="搜索事件名称、标识或来源"
        class="mb-4 !w-[300px]"
      />
      <el-table v-loading="loading" :data="filtered" row-key="id" class="w-full">
        <el-table-column label="事件名称" min-width="190">
          <template #default="{ row }">
            <div class="font-semibold">{{ row.name }}</div>
            <div class="mt-1 font-mono text-[12px] text-[var(--el-text-color-secondary)]">
              {{ row.eventType }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="调用来源" min-width="130" />
        <el-table-column label="业务动作" min-width="220">
          <template #default="{ row }">
            <span>定位资源 · {{ row.config.actions.convertLead ? '线索转客户' : '跳过线索' }}</span>
            <div class="text-[12px] text-[var(--el-text-color-secondary)]">
              {{ row.config.owner ? '指定客户负责人 · ' : '' }}映射
              {{ row.config.fields.length }} 个客户字段
            </div>
          </template>
        </el-table-column>
        <el-table-column label="配置版本" width="100"
          ><template #default="{ row }">v{{ row.version }}</template></el-table-column
        >
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :disabled="!canUpdate || switching !== null"
              @change="toggle(row as ExternalEventTemplateVO, Boolean($event))"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="245" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="showApi(row as ExternalEventTemplateVO)"
              ><Code2 :size="14" class="mr-1" />查看接口</el-button
            >
            <el-button v-if="canUpdate" link @click="edit(row as ExternalEventTemplateVO)"
              ><Pencil :size="14" class="mr-1" />编辑</el-button
            >
            <el-button
              v-if="canUpdate"
              link
              type="danger"
              :disabled="row.enabled"
              @click="remove(row as ExternalEventTemplateVO)"
              ><Trash2 :size="14" class="mr-1" />删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty
          ><el-empty description="暂无外部事件配置"
            ><el-button v-if="canUpdate" type="primary" @click="create"
              >新建事件</el-button
            ></el-empty
          ></template
        >
      </el-table>
    </el-card>
    <ExternalEventEditorDrawer
      v-model="editorVisible"
      :existing="editing"
      :initial-step="Number(route.query.step ?? 0)"
      @saved="saved"
    />
    <ExternalEventApiDrawer v-model="apiVisible" :template="selected" />
  </section>
</template>
