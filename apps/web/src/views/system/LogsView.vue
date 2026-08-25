<script setup lang="ts">
import type { LoginLogVO, OperationLogVO } from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { logApi } from '@/api/system'

const activeTab = ref('operations')

const opLoading = ref(false)
const opItems = ref<OperationLogVO[]>([])
const opTotal = ref(0)
const opQuery = reactive({ page: 1, pageSize: 10, keyword: '' })

const loginLoading = ref(false)
const loginItems = ref<LoginLogVO[]>([])
const loginTotal = ref(0)
const loginQuery = reactive({ page: 1, pageSize: 10, keyword: '' })

async function loadOperations() {
  opLoading.value = true
  try {
    const { data } = await logApi.operations({
      page: opQuery.page,
      pageSize: opQuery.pageSize,
      keyword: opQuery.keyword.trim() || undefined,
    })
    opItems.value = data.items
    opTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    opLoading.value = false
  }
}

async function loadLogins() {
  loginLoading.value = true
  try {
    const { data } = await logApi.logins({
      page: loginQuery.page,
      pageSize: loginQuery.pageSize,
      keyword: loginQuery.keyword.trim() || undefined,
    })
    loginItems.value = data.items
    loginTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loginLoading.value = false
  }
}

function handleTabChange() {
  if (activeTab.value === 'operations') loadOperations()
  else loadLogins()
}

onMounted(loadOperations)
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="操作日志" name="operations">
        <div class="flex mb-3">
          <el-input
            v-model="opQuery.keyword"
            placeholder="搜索操作人 / 对象名称"
            clearable
            class="!w-64"
            @keyup.enter="((opQuery.page = 1), loadOperations())"
            @clear="((opQuery.page = 1), loadOperations())"
          />
        </div>
        <el-table v-loading="opLoading" :data="opItems" stripe>
          <el-table-column label="操作人" width="120">
            <template #default="{ row }">{{ row.userName || '-' }}</template>
          </el-table-column>
          <el-table-column prop="module" label="模块" width="120" />
          <el-table-column prop="action" label="动作" width="130" />
          <el-table-column label="操作对象" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.targetName || '-' }}</template>
          </el-table-column>
          <el-table-column label="IP" width="140">
            <template #default="{ row }">{{ row.ip || '-' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
          </el-table-column>
        </el-table>
        <div class="flex justify-end mt-4">
          <el-pagination
            v-model:current-page="opQuery.page"
            :total="opTotal"
            :page-size="opQuery.pageSize"
            layout="total, prev, pager, next"
            @current-change="loadOperations"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="登录日志" name="logins">
        <div class="flex mb-3">
          <el-input
            v-model="loginQuery.keyword"
            placeholder="搜索邮箱"
            clearable
            class="!w-64"
            @keyup.enter="((loginQuery.page = 1), loadLogins())"
            @clear="((loginQuery.page = 1), loadLogins())"
          />
        </div>
        <el-table v-loading="loginLoading" :data="loginItems" stripe>
          <el-table-column prop="email" label="账号" min-width="200" />
          <el-table-column label="登录方式" width="120">
            <template #default="{ row }">
              <el-tag :type="row.authType === 'WECOM' ? 'primary' : 'info'" effect="plain">
                {{ row.authType === 'WECOM' ? '企业微信' : '密码' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="100">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                {{ row.success ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明" width="160">
            <template #default="{ row }">{{ row.message || '-' }}</template>
          </el-table-column>
          <el-table-column label="IP" width="140">
            <template #default="{ row }">{{ row.ip || '-' }}</template>
          </el-table-column>
          <el-table-column label="UA" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.userAgent || '-' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
          </el-table-column>
        </el-table>
        <div class="flex justify-end mt-4">
          <el-pagination
            v-model:current-page="loginQuery.page"
            :total="loginTotal"
            :page-size="loginQuery.pageSize"
            layout="total, prev, pager, next"
            @current-change="loadLogins"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
