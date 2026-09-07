<script setup lang="ts">
import type { AnnouncementVO } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { announcementApi } from '@/api/system'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import AnnouncementDrawer from './AnnouncementDrawer.vue'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:message:update'))
const loading = ref(false)
const rows = ref<AnnouncementVO[]>([])
const total = ref(0)
const keyword = ref('')
const query = reactive({ page: 1, pageSize: 20 })
const drawerVisible = ref(false)
const activeId = ref<string>()

async function load() {
  loading.value = true
  try {
    const { data } = await announcementApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: keyword.value.trim() || undefined,
    })
    rows.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  void load()
}

function create() {
  activeId.value = undefined
  drawerVisible.value = true
}

function edit(row: AnnouncementVO) {
  activeId.value = row.id
  drawerVisible.value = true
}

async function remove(row: AnnouncementVO) {
  try {
    await ElMessageBox.confirm(
      `删除“${row.subject}”后，接收人将不再保留该公告通知。确定继续？`,
      '删除公告',
      { type: 'warning' },
    )
    await announcementApi.remove(row.id)
    ElMessage.success('公告已删除')
    if (rows.value.length === 1 && query.page > 1) query.page -= 1
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

function receiverText(row: AnnouncementVO) {
  const names = [...row.departments, ...row.users].map((item) => item.name)
  return names.join('、') || '-'
}

function publicationText(row: AnnouncementVO) {
  return `${new Date(row.startAt).toLocaleString()} 至 ${new Date(row.endAt).toLocaleString()}`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString()
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading" shadow="never" body-class="!p-0">
    <div
      class="flex items-center justify-between border-b border-[var(--el-border-color-lighter)] px-6 py-4"
    >
      <div>
        <div class="font-medium">公告</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          向指定部门或成员发布系统公告，生效后自动进入接收人的消息中心
        </div>
      </div>
      <div class="flex items-center gap-3">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索公告标题"
          class="!w-60"
          @keyup.enter="search"
          @clear="search"
        />
        <el-button @click="search">搜索</el-button>
        <el-button
          v-if="canUpdate"
          type="primary"
          data-testid="announcement-create"
          @click="create"
        >
          新建公告
        </el-button>
      </div>
    </div>

    <el-table
      :data="rows"
      row-key="id"
      border
      class="m-4 !w-[calc(100%-32px)]"
      data-testid="announcement-table"
    >
      <el-table-column
        prop="subject"
        label="公告标题"
        min-width="180"
        show-overflow-tooltip
        fixed="left"
      />
      <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip />
      <el-table-column label="发布时间" min-width="320">
        <template #default="{ row }">{{ publicationText(row as AnnouncementVO) }}</template>
      </el-table-column>
      <el-table-column label="接收人" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ receiverText(row as AnnouncementVO) }}</template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="180">
        <template #default="{ row }">{{ formatTime((row as AnnouncementVO).createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="createUserName" label="创建人" width="140" show-overflow-tooltip />
      <el-table-column label="更新时间" min-width="180">
        <template #default="{ row }">{{ formatTime((row as AnnouncementVO).updatedAt) }}</template>
      </el-table-column>
      <el-table-column prop="updateUserName" label="更新人" width="140" show-overflow-tooltip />
      <el-table-column v-if="canUpdate" label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row as AnnouncementVO)">编辑</el-button>
          <el-button link type="danger" @click="remove(row as AnnouncementVO)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end px-4 pb-4">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="load"
        @size-change="((query.page = 1), load())"
      />
    </div>
  </el-card>

  <AnnouncementDrawer v-model="drawerVisible" :announcement-id="activeId" @saved="load" />
</template>
