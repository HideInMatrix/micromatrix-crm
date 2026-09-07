<script setup lang="ts">
import type { AnnouncementVO, DepartmentVO, SaveAnnouncementInput } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { announcementApi, deptApi, memberApi, type MemberOption } from '@/api/system'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  modelValue: boolean
  announcementId?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved'): void
}>()

interface AnnouncementFormState {
  subject: string
  content: string
  url: string
  linkName: string
  range: [Date, Date] | null
  departmentIds: string[]
  userIds: string[]
}

const formRef = ref()
const loading = ref(false)
const saving = ref(false)
const departments = ref<DepartmentVO[]>([])
const members = ref<MemberOption[]>([])
const form = reactive<AnnouncementFormState>(createEmptyForm())

const title = computed(() => (props.announcementId ? '编辑公告' : '新建公告'))
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const rules = {
  subject: [{ required: true, message: '请输入公告标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入公告内容', trigger: 'blur' }],
  range: [{ required: true, message: '请选择发布时间', trigger: 'change' }],
}

function createEmptyForm(): AnnouncementFormState {
  const now = Date.now()
  return {
    subject: '',
    content: '',
    url: '',
    linkName: '',
    range: [new Date(now + 5 * 60_000), new Date(now + 24 * 60 * 60_000)],
    departmentIds: [],
    userIds: [],
  }
}

function resetForm() {
  Object.assign(form, createEmptyForm())
  formRef.value?.clearValidate?.()
}

function applyDetail(detail: AnnouncementVO) {
  form.subject = detail.subject
  form.content = detail.content
  form.url = detail.url ?? ''
  form.linkName = detail.linkName ?? ''
  form.range = [new Date(detail.startAt), new Date(detail.endAt)]
  form.departmentIds = [...detail.departmentIds]
  form.userIds = [...detail.userIds]
}

async function load() {
  loading.value = true
  resetForm()
  try {
    const [departmentResponse, memberResponse, detailResponse] = await Promise.all([
      deptApi.tree(),
      memberApi.options(),
      props.announcementId ? announcementApi.detail(props.announcementId) : Promise.resolve(null),
    ])
    departments.value = departmentResponse.data
    members.value = memberResponse.data
    if (detailResponse) applyDetail(detailResponse.data)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    visible.value = false
  } finally {
    loading.value = false
  }
}

function payload(): SaveAnnouncementInput {
  if (!form.range) throw new Error('请选择发布时间')
  return {
    subject: form.subject.trim(),
    content: form.content.trim(),
    startAt: form.range[0].toISOString(),
    endAt: form.range[1].toISOString(),
    url: form.url.trim() || null,
    linkName: form.url.trim() ? form.linkName.trim() || null : null,
    departmentIds: [...form.departmentIds],
    userIds: [...form.userIds],
  }
}

async function save() {
  try {
    await formRef.value?.validate()
    if (form.departmentIds.length === 0 && form.userIds.length === 0) {
      ElMessage.warning('至少选择一个接收部门或成员')
      return
    }
    saving.value = true
    const data = payload()
    if (props.announcementId) await announcementApi.update(props.announcementId, data)
    else await announcementApi.create(data)
    ElMessage.success(props.announcementId ? '公告已更新' : '公告已创建')
    emit('saved')
    visible.value = false
  } catch (error) {
    if (error && typeof error === 'object' && !('response' in error) && !('message' in error))
      return
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function openPreviewLink() {
  const url = form.url.trim()
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

watch(
  () => props.modelValue,
  (value) => {
    if (value) void load()
  },
)
</script>

<template>
  <el-drawer v-model="visible" :title="title" size="720px" destroy-on-close>
    <div v-loading="loading">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="公告标题" prop="subject">
          <el-input
            v-model="form.subject"
            maxlength="255"
            show-word-limit
            placeholder="请输入公告标题"
          />
        </el-form-item>

        <el-form-item label="链接">
          <el-input
            v-model="form.url"
            maxlength="2048"
            placeholder="可选，仅支持 http/https 地址"
          />
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            添加在公告内容后的跳转链接
          </div>
        </el-form-item>

        <el-form-item label="链接名称">
          <el-input
            v-model="form.linkName"
            :disabled="!form.url.trim()"
            maxlength="255"
            placeholder="可选，未填写时显示原始链接"
          />
        </el-form-item>

        <el-form-item label="公告内容" prop="content">
          <div class="w-full">
            <el-input
              v-model="form.content"
              type="textarea"
              :rows="7"
              maxlength="1000"
              show-word-limit
              placeholder="请输入公告内容"
            />
            <el-popover placement="right" :width="360" trigger="click">
              <template #reference>
                <el-button class="mt-2" link type="primary">预览公告</el-button>
              </template>
              <div class="break-words">
                <div class="mb-2 font-medium">{{ form.subject || '公告标题' }}</div>
                <div class="whitespace-pre-wrap text-sm">{{ form.content || '公告内容' }}</div>
                <button
                  v-if="form.url.trim()"
                  type="button"
                  class="mt-2 cursor-pointer border-0 bg-transparent p-0 text-sm text-[var(--el-color-primary)]"
                  @click="openPreviewLink"
                >
                  {{ form.linkName.trim() || form.url.trim() }}
                </button>
              </div>
            </el-popover>
          </div>
        </el-form-item>

        <el-form-item label="发布时间" prop="range">
          <el-date-picker
            v-model="form.range"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            class="!w-full"
          />
        </el-form-item>

        <el-form-item label="接收部门">
          <el-tree-select
            v-model="form.departmentIds"
            :data="departments"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            multiple
            check-strictly
            show-checkbox
            collapse-tags
            collapse-tags-tooltip
            clearable
            class="w-full"
            placeholder="选择部门后将包含全部子部门成员"
          />
        </el-form-item>

        <el-form-item label="指定成员">
          <el-select
            v-model="form.userIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            class="w-full"
            placeholder="可补充选择指定成员"
          >
            <el-option
              v-for="member in members"
              :key="member.id"
              :label="member.name"
              :value="member.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>
