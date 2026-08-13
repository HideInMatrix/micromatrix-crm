<script setup lang="ts">
import {
  BIDDING_TYPES,
  type BiddingInfoVO,
  type BiddingKeywordVO,
  type BiddingSourceVO,
} from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { biddingApi } from '@/api/bidding'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const items = ref<BiddingInfoVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', type: '' })

const detailVisible = ref(false)
const current = ref<BiddingInfoVO | null>(null)

const manageVisible = ref(false)
const sources = ref<BiddingSourceVO[]>([])
const keywords = ref<BiddingKeywordVO[]>([])
const newKeyword = ref('')
const fetching = ref(false)

const importVisible = ref(false)
const importForm = reactive({
  title: '',
  type: '招标公告',
  region: '',
  buyer: '',
  budget: undefined as number | undefined,
  publishedAt: '',
  deadline: '',
  sourceUrl: '',
  content: '',
})

async function loadData() {
  loading.value = true
  try {
    const { data } = await biddingApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      type: query.type || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function loadManage() {
  const [{ data: sourceList }, { data: keywordList }] = await Promise.all([
    biddingApi.sources(),
    biddingApi.keywords(),
  ])
  sources.value = sourceList
  keywords.value = keywordList
}

async function toggleSource(source: BiddingSourceVO) {
  try {
    await biddingApi.saveSource(source.provider, !source.enabled)
    ElMessage.success(source.enabled ? '已停用' : '已启用')
    loadManage()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function addKeyword() {
  if (!newKeyword.value.trim()) return
  try {
    await biddingApi.addKeyword(newKeyword.value.trim())
    newKeyword.value = ''
    loadManage()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeKeyword(item: BiddingKeywordVO) {
  await biddingApi.removeKeyword(item.id)
  loadManage()
}

async function handleFetchNow() {
  fetching.value = true
  try {
    const { data } = await biddingApi.fetchNow()
    ElMessage.success(`抓取完成：拉取 ${data.fetched} 条，新入库 ${data.inserted} 条`)
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    fetching.value = false
  }
}

async function handleConvert(row: BiddingInfoVO) {
  const confirmed = await ElMessageBox.confirm(
    `将该标讯转为线索并由你跟进？`,
    '转为线索',
  ).catch(() => false)
  if (!confirmed) return
  try {
    const { data } = await biddingApi.convert(row.id)
    ElMessage.success(`已创建线索「${data.name}」`)
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleImport() {
  if (!importForm.title.trim()) {
    ElMessage.warning('请输入标题')
    return
  }
  try {
    await biddingApi.manualImport({
      ...importForm,
      budget: importForm.budget || undefined,
      publishedAt: importForm.publishedAt || undefined,
      deadline: importForm.deadline || undefined,
      region: importForm.region || undefined,
      buyer: importForm.buyer || undefined,
      sourceUrl: importForm.sourceUrl || undefined,
      content: importForm.content || undefined,
    })
    ElMessage.success('已录入')
    importVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openDetail(row: BiddingInfoVO) {
  current.value = row
  detailVisible.value = true
}

onMounted(loadData)
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="搜索标题 / 采购方 / 关键词"
          clearable
          class="!w-64"
          @keyup.enter="((query.page = 1), loadData())"
          @clear="((query.page = 1), loadData())"
        />
        <el-select
          v-model="query.type"
          clearable
          placeholder="公告类型"
          class="!w-32"
          @change="((query.page = 1), loadData())"
        >
          <el-option v-for="t in BIDDING_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <div class="flex gap-2">
        <template v-if="auth.hasPerm('bidding:manage')">
          <el-button @click="importVisible = true">手动录入</el-button>
          <el-button :loading="fetching" @click="handleFetchNow">立即抓取</el-button>
          <el-button @click="((manageVisible = true), loadManage())">订阅管理</el-button>
        </template>
      </div>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="标题" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="cursor-pointer text-[var(--el-color-primary)]" @click="openDetail(row as BiddingInfoVO)">
            {{ row.title }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="row.type === '中标公告' ? 'success' : 'primary'">
            {{ row.type ?? '-' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="地区" width="100">
        <template #default="{ row }">{{ row.region ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="预算" width="120" align="right">
        <template #default="{ row }">
          {{ row.budget ? `¥${(row.budget / 10000).toFixed(0)}万` : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="发布日期" width="110">
        <template #default="{ row }">{{ row.publishedAt ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="关键词" width="110">
        <template #default="{ row }">{{ row.keyword ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-tag v-if="row.convertedLeadId" size="small" type="success">已转线索</el-tag>
          <el-button
            v-else-if="auth.hasPerm('bidding:convert')"
            link
            type="primary"
            @click="handleConvert(row as BiddingInfoVO)"
          >
            转线索
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        :total="total"
        :page-size="query.pageSize"
        layout="total, prev, pager, next"
        @current-change="loadData"
      />
    </div>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" :title="current?.title" width="640px">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="类型">{{ current?.type ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="地区">{{ current?.region ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="采购方">{{ current?.buyer ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="预算">
          {{ current?.budget ? `¥${current.budget.toLocaleString('zh-CN')}` : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="发布日期">{{ current?.publishedAt ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="截止日期">{{ current?.deadline ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="来源" :span="2">
          <a
            v-if="current?.sourceUrl"
            :href="current.sourceUrl"
            target="_blank"
            class="text-[var(--el-color-primary)]"
          >
            {{ current.sourceUrl }}
          </a>
          <span v-else>{{ current?.source ?? '-' }}</span>
        </el-descriptions-item>
      </el-descriptions>
      <div v-if="current?.content" class="mt-4 text-sm leading-6 text-[var(--el-text-color-regular)]">
        {{ current.content }}
      </div>
    </el-dialog>

    <!-- 订阅管理 -->
    <el-drawer v-model="manageVisible" title="标讯订阅管理" size="440px">
      <div class="font-medium text-sm mb-2">数据源</div>
      <div
        v-for="source in sources"
        :key="source.provider"
        class="flex-between py-2.5 border-b border-[var(--el-border-color-lighter)]"
      >
        <div>
          <div class="text-sm">{{ source.name }}</div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            {{ source.lastFetchAt ? `上次抓取：${new Date(source.lastFetchAt).toLocaleString()}` : '未抓取过' }}
          </div>
        </div>
        <el-switch :model-value="source.enabled" @change="toggleSource(source)" />
      </div>
      <el-alert
        title="接入商业数据源（剑鱼/千里马等）需提供 API 账号，适配器框架已预留。"
        type="info"
        :closable="false"
        class="my-3"
      />

      <div class="font-medium text-sm mb-2 mt-4">关键词订阅（每天 8:00 自动抓取）</div>
      <div class="flex gap-2 mb-3">
        <el-input v-model="newKeyword" placeholder="如：CRM系统" @keyup.enter="addKeyword" />
        <el-button type="primary" @click="addKeyword">订阅</el-button>
      </div>
      <el-tag
        v-for="item in keywords"
        :key="item.id"
        closable
        :type="item.enabled ? 'primary' : 'info'"
        class="mr-2 mb-2"
        @close="removeKeyword(item)"
      >
        {{ item.keyword }}
      </el-tag>
    </el-drawer>

    <!-- 手动录入 -->
    <el-dialog v-model="importVisible" title="手动录入标讯" width="560px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="标题" required>
          <el-input v-model="importForm.title" />
        </el-form-item>
        <div class="grid grid-cols-2">
          <el-form-item label="类型">
            <el-select v-model="importForm.type" class="w-full">
              <el-option v-for="t in BIDDING_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="地区">
            <el-input v-model="importForm.region" />
          </el-form-item>
          <el-form-item label="采购方">
            <el-input v-model="importForm.buyer" />
          </el-form-item>
          <el-form-item label="预算(元)">
            <el-input-number v-model="importForm.budget" :min="0" controls-position="right" class="!w-full" />
          </el-form-item>
          <el-form-item label="发布日期">
            <el-date-picker v-model="importForm.publishedAt" type="date" value-format="YYYY-MM-DD" class="!w-full" />
          </el-form-item>
          <el-form-item label="截止日期">
            <el-date-picker v-model="importForm.deadline" type="date" value-format="YYYY-MM-DD" class="!w-full" />
          </el-form-item>
        </div>
        <el-form-item label="原文链接">
          <el-input v-model="importForm.sourceUrl" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="importForm.content" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" @click="handleImport">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
