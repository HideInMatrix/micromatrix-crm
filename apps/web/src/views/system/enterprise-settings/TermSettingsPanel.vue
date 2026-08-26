<script setup lang="ts">
import type {
  EnterpriseTermCategoryVO,
  EnterpriseTermDiscoveryVO,
  EnterpriseTermVO,
  SaveEnterpriseTermInput,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { enterpriseTermApi } from '@/api/enterprise-settings'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const categoryLoading = ref(false)
const categories = ref<EnterpriseTermCategoryVO[]>([])
const selectedCategoryId = ref('')
const terms = ref<EnterpriseTermVO[]>([])
const keyword = ref('')
const drawerVisible = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const adoptingDiscovery = ref<EnterpriseTermDiscoveryVO | null>(null)
const formRef = ref<FormInstance>()
const discoveryVisible = ref(false)
const discoveryLoading = ref(false)
const discoveries = ref<EnterpriseTermDiscoveryVO[]>([])

const form = reactive<SaveEnterpriseTermInput>({
  categoryId: '',
  standardTerm: '',
  alsoCalled: '',
  avoidThese: '',
  useCase: '',
  systemReference: '',
  enable: true,
})

const rules: FormRules = {
  categoryId: [{ required: true, message: '请选择术语分类', trigger: 'change' }],
  standardTerm: [{ required: true, message: '请输入标准术语', trigger: 'blur' }],
}

async function loadCategories() {
  categoryLoading.value = true
  try {
    const { data } = await enterpriseTermApi.categories()
    categories.value = data
    if (!selectedCategoryId.value || !data.some((item) => item.id === selectedCategoryId.value)) {
      selectedCategoryId.value = data[0]?.id ?? ''
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    categoryLoading.value = false
  }
}

async function loadTerms() {
  loading.value = true
  try {
    const { data } = await enterpriseTermApi.list({
      categoryId: selectedCategoryId.value || undefined,
      keyword: keyword.value.trim() || undefined,
    })
    terms.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function createCategory() {
  const result = await ElMessageBox.prompt('请输入分类名称', '新增术语分类', {
    inputPattern: /\S+/,
    inputErrorMessage: '分类名称不能为空',
  }).catch(() => null)
  if (!result) return
  try {
    const { data } = await enterpriseTermApi.createCategory({ name: result.value.trim() })
    await loadCategories()
    selectedCategoryId.value = data.id
    ElMessage.success('分类已新增')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function editCategory(row: EnterpriseTermCategoryVO) {
  const result = await ElMessageBox.prompt('请输入新的分类名称', '编辑术语分类', {
    inputValue: row.name,
    inputPattern: /\S+/,
    inputErrorMessage: '分类名称不能为空',
  }).catch(() => null)
  if (!result) return
  try {
    await enterpriseTermApi.updateCategory(row.id, { name: result.value.trim(), sort: row.sort })
    await loadCategories()
    ElMessage.success('分类已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeCategory(row: EnterpriseTermCategoryVO) {
  const confirmed = await ElMessageBox.confirm(
    `删除分类“${row.name}”会同时删除该分类下的 ${row.termCount} 条术语，确定继续吗？`,
    '删除术语分类',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await enterpriseTermApi.removeCategory(row.id)
    ElMessage.success('分类已删除')
    await loadCategories()
    await loadTerms()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function resetForm() {
  Object.assign(form, {
    categoryId: selectedCategoryId.value || categories.value[0]?.id || '',
    standardTerm: '',
    alsoCalled: '',
    avoidThese: '',
    useCase: '',
    systemReference: '',
    enable: true,
  })
}

function openCreate() {
  editingId.value = null
  adoptingDiscovery.value = null
  resetForm()
  drawerVisible.value = true
}

function openEdit(rowValue: unknown) {
  const row = rowValue as EnterpriseTermVO
  editingId.value = row.id
  adoptingDiscovery.value = null
  Object.assign(form, {
    categoryId: row.categoryId,
    standardTerm: row.standardTerm,
    alsoCalled: row.alsoCalled,
    avoidThese: row.avoidThese,
    useCase: row.useCase,
    systemReference: row.systemReference,
    enable: row.enable,
  })
  drawerVisible.value = true
}

async function saveTerm() {
  saving.value = true
  try {
    await formRef.value?.validate()
    const payload = { ...form }
    if (adoptingDiscovery.value) {
      await enterpriseTermApi.adoptDiscovery(adoptingDiscovery.value.id, payload)
      ElMessage.success('术语发现已采纳')
    } else if (editingId.value) {
      await enterpriseTermApi.update(editingId.value, payload)
      ElMessage.success('术语已更新')
    } else {
      await enterpriseTermApi.create(payload)
      ElMessage.success('术语已新增')
    }
    drawerVisible.value = false
    await Promise.all([loadCategories(), loadTerms()])
    if (discoveryVisible.value) await loadDiscoveries()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function toggleTerm(rowValue: unknown, enable: boolean) {
  const row = rowValue as EnterpriseTermVO
  try {
    await enterpriseTermApi.setStatus(row.id, enable)
    row.enable = enable
    ElMessage.success(enable ? '术语已启用' : '术语已停用')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadTerms()
  }
}

async function removeTerm(rowValue: unknown) {
  const row = rowValue as EnterpriseTermVO
  const confirmed = await ElMessageBox.confirm(
    `确定删除术语“${row.standardTerm}”吗？`,
    '删除术语',
    {
      type: 'warning',
    },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await enterpriseTermApi.remove(row.id)
    ElMessage.success('术语已删除')
    await Promise.all([loadCategories(), loadTerms()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadDiscoveries() {
  discoveryLoading.value = true
  try {
    const { data } = await enterpriseTermApi.discoveries()
    discoveries.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    discoveryLoading.value = false
  }
}

async function openDiscoveries() {
  discoveryVisible.value = true
  await loadDiscoveries()
}

async function ignoreDiscovery(rowValue: unknown) {
  const row = rowValue as EnterpriseTermDiscoveryVO
  try {
    await enterpriseTermApi.ignoreDiscovery(row.id)
    discoveries.value = discoveries.value.filter((item) => item.id !== row.id)
    ElMessage.success('已忽略该术语发现')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function adoptDiscovery(rowValue: unknown) {
  const row = rowValue as EnterpriseTermDiscoveryVO
  editingId.value = null
  adoptingDiscovery.value = row
  Object.assign(form, {
    categoryId: selectedCategoryId.value || categories.value[0]?.id || '',
    standardTerm: row.freeTerm,
    alsoCalled: '',
    avoidThese: '',
    useCase: '',
    systemReference: row.reference,
    enable: true,
  })
  drawerVisible.value = true
}

watch(selectedCategoryId, loadTerms)
onMounted(async () => {
  await loadCategories()
  await loadTerms()
})
</script>

<template>
  <el-card shadow="never" class="rounded-1.5">
    <div class="min-h-140 grid grid-cols-[220px_minmax(0,1fr)]">
      <aside
        v-loading="categoryLoading"
        class="border-r border-[var(--el-border-color-lighter)] pr-4"
      >
        <div class="h-10 flex items-center justify-between">
          <strong>术语分类</strong>
          <el-button v-if="canUpdate" link type="primary" @click="createCategory">新增</el-button>
        </div>
        <div v-if="categories.length" class="flex flex-col gap-0.75">
          <div
            v-for="item in categories"
            :key="item.id"
            class="min-h-9.5 flex cursor-pointer items-center gap-1.5 rounded px-2 pr-2 pl-2.5 hover:bg-[var(--el-fill-color-light)]"
            :class="{ 'bg-[var(--el-fill-color-light)]': selectedCategoryId === item.id }"
            @click="selectedCategoryId = item.id"
          >
            <span
              class="min-w-0 flex-1 truncate"
              :class="{
                'font-semibold text-[var(--el-color-primary)]': selectedCategoryId === item.id,
              }"
              >{{ item.name }}</span
            >
            <span class="text-xs text-[var(--el-text-color-secondary)]">{{ item.termCount }}</span>
            <el-dropdown
              v-if="canUpdate"
              trigger="click"
              @command="
                (cmd: string) => (cmd === 'edit' ? editCategory(item) : removeCategory(item))
              "
            >
              <el-button text size="small" @click.stop>···</el-button>
              <template #dropdown>
                <el-dropdown-menu
                  ><el-dropdown-item command="edit">编辑</el-dropdown-item
                  ><el-dropdown-item command="delete">删除</el-dropdown-item></el-dropdown-menu
                >
              </template>
            </el-dropdown>
          </div>
        </div>
        <el-empty v-else description="暂无分类" :image-size="64" />
      </aside>

      <section class="min-w-0 pl-5">
        <div class="mb-4 flex items-center justify-between gap-4">
          <div class="flex gap-2">
            <el-button
              v-if="canUpdate"
              type="primary"
              :disabled="categories.length === 0"
              @click="openCreate"
              >新增术语</el-button
            >
            <el-button v-if="canUpdate" type="primary" plain @click="openDiscoveries"
              >AI 术语发现</el-button
            >
          </div>
          <el-input
            v-model="keyword"
            clearable
            class="w-90"
            placeholder="搜索标准术语、同义词或禁用词"
            @keyup.enter="loadTerms"
          >
            <template #append><el-button @click="loadTerms">搜索</el-button></template>
          </el-input>
        </div>
        <el-table v-loading="loading" :data="terms" border>
          <el-table-column type="index" label="#" width="54" />
          <el-table-column
            prop="standardTerm"
            label="标准术语"
            min-width="150"
            show-overflow-tooltip
          />
          <el-table-column prop="alsoCalled" label="同义词" min-width="180" show-overflow-tooltip />
          <el-table-column prop="avoidThese" label="禁用词" min-width="180" show-overflow-tooltip />
          <el-table-column prop="useCase" label="适用场景" min-width="170" show-overflow-tooltip />
          <el-table-column
            prop="systemReference"
            label="系统映射"
            min-width="170"
            show-overflow-tooltip
          />
          <el-table-column label="状态" width="90">
            <template #default="{ row }"
              ><el-switch
                :model-value="row.enable"
                :disabled="!canUpdate"
                @change="toggleTerm(row, Boolean($event))"
            /></template>
          </el-table-column>
          <el-table-column v-if="canUpdate" label="操作" width="125" fixed="right">
            <template #default="{ row }"
              ><el-button link type="primary" @click="openEdit(row)">编辑</el-button
              ><el-button link type="danger" @click="removeTerm(row)">删除</el-button></template
            >
          </el-table-column>
        </el-table>
      </section>
    </div>

    <el-drawer
      v-model="drawerVisible"
      :title="adoptingDiscovery ? '采纳术语发现' : editingId ? '编辑术语' : '新增术语'"
      size="600px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="术语分类" prop="categoryId"
          ><el-select v-model="form.categoryId" class="w-full"
            ><el-option
              v-for="item in categories"
              :key="item.id"
              :label="item.name"
              :value="item.id" /></el-select
        ></el-form-item>
        <el-form-item label="标准术语" prop="standardTerm"
          ><el-input v-model="form.standardTerm" maxlength="255"
        /></el-form-item>
        <el-form-item label="同义词"
          ><el-input v-model="form.alsoCalled" type="textarea" :rows="2" maxlength="1000"
        /></el-form-item>
        <el-form-item label="禁用词"
          ><el-input v-model="form.avoidThese" type="textarea" :rows="2" maxlength="1000"
        /></el-form-item>
        <el-form-item label="适用场景"
          ><el-input v-model="form.useCase" type="textarea" :rows="3" maxlength="1000"
        /></el-form-item>
        <el-form-item label="系统映射"
          ><el-input v-model="form.systemReference" type="textarea" :rows="3" maxlength="1000"
        /></el-form-item>
        <el-form-item label="状态"
          ><el-switch v-model="form.enable" active-text="启用" inactive-text="停用"
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="drawerVisible = false">取消</el-button
        ><el-button type="primary" :loading="saving" @click="saveTerm">保存</el-button></template
      >
    </el-drawer>

    <el-drawer v-model="discoveryVisible" title="AI 术语发现" size="820px" destroy-on-close>
      <el-table v-loading="discoveryLoading" :data="discoveries" border>
        <el-table-column prop="freeTerm" label="未定义术语" min-width="140" />
        <el-table-column prop="source" label="发现来源" min-width="130" show-overflow-tooltip />
        <el-table-column prop="reference" label="建议映射" min-width="220" show-overflow-tooltip />
        <el-table-column label="发现时间" width="170"
          ><template #default="{ row }">{{
            new Date(row.createdAt).toLocaleString()
          }}</template></el-table-column
        >
        <el-table-column v-if="canUpdate" label="操作" width="130" fixed="right">
          <template #default="{ row }"
            ><el-button link type="primary" @click="adoptDiscovery(row)">采纳</el-button
            ><el-button link @click="ignoreDiscovery(row)">忽略</el-button></template
          >
        </el-table-column>
      </el-table>
      <el-empty
        v-if="!discoveryLoading && discoveries.length === 0"
        description="暂无待处理术语发现"
      />
    </el-drawer>
  </el-card>
</template>
