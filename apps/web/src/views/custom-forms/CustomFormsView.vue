<script setup lang="ts">
import type { CustomFormListVO } from '@micromatrix/shared'
import { computed, nextTick, onMounted } from 'vue'
import CustomFormConfigDrawer from './components/CustomFormConfigDrawer.vue'
import CustomFormDataDrawer from './components/CustomFormDataDrawer.vue'
import CustomFormDataWorkspace from './components/CustomFormDataWorkspace.vue'
import CustomFormFieldDialog from './components/CustomFormFieldDialog.vue'
import CustomFormSidebar from './components/CustomFormSidebar.vue'
import { useCustomFormAttachments } from './composables/useCustomFormAttachments'
import { useCustomFormData } from './composables/useCustomFormData'
import {
  useCustomFormDesigner,
  type CustomFormConfigTab,
} from './composables/useCustomFormDesigner'
import { useCustomFormPermissions } from './composables/useCustomFormPermissions'
import { useCustomFormReferences } from './composables/useCustomFormReferences'
import { useCustomFormTransfer } from './composables/useCustomFormTransfer'
import { useCustomFormViews } from './composables/useCustomFormViews'
import { useCustomForms } from './composables/useCustomForms'

const {
  auth,
  loading,
  keyword,
  activeFormId,
  filteredForms,
  activeForm,
  canAddForm,
  loadForms,
  selectForm: selectCatalogForm,
  createForm: createCatalogForm,
  toggleForm: toggleCatalogForm,
  removeForm: removeCatalogForm,
} = useCustomForms()

const { members, deptTree, load: loadReferences } = useCustomFormReferences()
const currentUserId = computed(() => auth.user?.id)

const {
  loading: dataLoading,
  page: dataPage,
  keyword: dataKeyword,
  selectedIds: selectedDataIds,
  drawerVisible: dataDrawerVisible,
  saving: dataSaving,
  editingData,
  form: dataForm,
  values: dataValues,
  ownerOptions,
  resetPage: resetDataPage,
  loadData: loadPageData,
  handleSelectionChange,
  openCreate: openDataCreateBase,
  openEdit: openDataEditBase,
  save: saveDataBase,
  remove: removeDataBase,
} = useCustomFormData(activeFormId, currentUserId, members)

const {
  advancedFilters,
  activeViewId,
  filterableFields,
  defaultColumnKeys,
  visibleDisplayFields,
  savedViewModule,
  savedViewFields,
  customDataFields,
  batchEditableFields,
  exportFields,
  exportDisplayFields,
  reset: resetViewState,
  handleAdvancedFilter,
  handleSavedViewChange,
  clearAdvancedFilters,
  handleColumnsChange,
} = useCustomFormViews(dataPage, activeFormId, loadData)

const {
  importVisible,
  exportVisible,
  exportMode,
  exportLoading,
  batchEditVisible,
  batchSaving,
  openImport,
  downloadImportTemplate,
  precheckImport,
  executeImport,
  openExport,
  handleExport,
  openBatchEdit,
  handleBatchEdit,
  batchDeleteSelected,
} = useCustomFormTransfer(activeFormId, dataPage, selectedDataIds, loadData)

const {
  visible: configVisible,
  loading: designerLoading,
  saving: designerSaving,
  tab: configTab,
  detail: configDetail,
  fields: configFields,
  fieldDialogVisible,
  fieldSaving,
  editingField,
  open: openDesigner,
  saveBase: saveFormBase,
  openFieldCreate,
  openFieldEdit,
  saveField,
  removeField,
  reorderFields,
} = useCustomFormDesigner(async (formId) => {
  await loadForms(formId)
})

const {
  loading: permissionsLoading,
  saving: permissionsSaving,
  admins: configAdmins,
  roles: configRoles,
  load: loadPermissions,
  save: saveFormPermissions,
} = useCustomFormPermissions(async (formId) => {
  await loadForms(formId)
})

const configLoading = computed(() => designerLoading.value || permissionsLoading.value)
const configSaving = computed(() => designerSaving.value || permissionsSaving.value)

const {
  attachmentMap: dataAttachmentMap,
  resetForCreate: resetAttachmentsForCreate,
  loadFromData: loadAttachmentsFromData,
  markCommitted: markAttachmentsCommitted,
  beforeClose: handleDataDrawerBeforeClose,
  download: downloadDataAttachment,
} = useCustomFormAttachments(activeFormId, editingData, customDataFields, dataValues)

function loadData(reset = false) {
  return loadPageData(reset, advancedFilters.value, activeViewId.value)
}

async function selectForm(id: string) {
  if (!selectCatalogForm(id)) return
  dataKeyword.value = ''
  resetViewState()
  resetDataPage()
  await loadData(true)
}

async function createForm() {
  const id = await createCatalogForm()
  if (!id) return
  dataKeyword.value = ''
  resetViewState()
  resetDataPage()
  await loadData(true)
  await openConfig(id, 'design')
}

async function toggleForm(row: CustomFormListVO) {
  const changed = await toggleCatalogForm(row)
  if (changed && row.id === activeFormId.value) await loadData(true)
}

async function removeForm(row: CustomFormListVO) {
  if (!(await removeCatalogForm(row))) return
  dataKeyword.value = ''
  resetViewState()
  resetDataPage()
  if (activeFormId.value) await loadData(true)
}

async function openConfig(id: string, tab: CustomFormConfigTab) {
  const [designerReady] = await Promise.all([openDesigner(id, tab), loadPermissions(id)])
  if (!designerReady) configVisible.value = false
}

function savePermissions() {
  return saveFormPermissions(configDetail.value?.id)
}

function openDataCreate() {
  openDataCreateBase(resetAttachmentsForCreate)
}

function openDataEdit(rowValue: unknown) {
  return openDataEditBase(rowValue, loadAttachmentsFromData)
}

function saveData() {
  return saveDataBase(markAttachmentsCommitted, () => loadData())
}

function removeData(rowValue: unknown) {
  return removeDataBase(rowValue, () => loadData())
}

function handlePageChange(current: number) {
  dataPage.value.current = current
  void loadData()
}

function handlePageSizeChange(pageSize: number) {
  dataPage.value.pageSize = pageSize
  void loadData(true)
}

onMounted(async () => {
  await loadReferences()
  await loadForms()
  if (activeFormId.value) await loadData(true)
  else resetDataPage()
  await nextTick()
})
</script>

<template>
  <div class="flex h-full min-h-0 gap-4">
    <CustomFormSidebar
      v-model:keyword="keyword"
      :loading="loading"
      :forms="filteredForms"
      :active-form-id="activeFormId"
      :can-add="canAddForm"
      @create="createForm"
      @select="selectForm"
      @config="openConfig"
      @toggle="toggleForm"
      @remove="removeForm"
    />

    <CustomFormDataWorkspace
      v-model:keyword="dataKeyword"
      v-model:filters="advancedFilters"
      v-model:import-visible="importVisible"
      v-model:export-visible="exportVisible"
      v-model:batch-edit-visible="batchEditVisible"
      :active-form="activeForm"
      :page="dataPage"
      :loading="dataLoading"
      :current-user-id="auth.user?.id"
      :members="members"
      :dept-tree="deptTree"
      :visible-fields="visibleDisplayFields"
      :filterable-fields="filterableFields"
      :saved-view-module="savedViewModule"
      :saved-view-fields="savedViewFields"
      :default-column-keys="defaultColumnKeys"
      :selected-ids="selectedDataIds"
      :batch-saving="batchSaving"
      :batch-editable-fields="batchEditableFields"
      :export-fields="exportFields"
      :export-display-fields="exportDisplayFields"
      :export-mode="exportMode"
      :export-loading="exportLoading"
      :download-template="downloadImportTemplate"
      :precheck-import="precheckImport"
      :execute-import="executeImport"
      @query="loadData"
      @advanced-filter="handleAdvancedFilter"
      @saved-view-change="handleSavedViewChange"
      @clear-filters="clearAdvancedFilters"
      @columns-change="handleColumnsChange"
      @import-open="openImport"
      @export-open="openExport"
      @batch-edit-open="openBatchEdit"
      @batch-delete="batchDeleteSelected"
      @create="openDataCreate"
      @selection-change="handleSelectionChange"
      @edit="openDataEdit"
      @remove="removeData"
      @export-confirm="handleExport"
      @batch-edit-confirm="handleBatchEdit"
      @page-change="handlePageChange"
      @page-size-change="handlePageSizeChange"
    />

    <CustomFormConfigDrawer
      v-model="configVisible"
      v-model:tab="configTab"
      v-model:detail="configDetail"
      v-model:fields="configFields"
      v-model:admins="configAdmins"
      v-model:roles="configRoles"
      :loading="configLoading"
      :saving="configSaving"
      :members="members"
      @save-base="saveFormBase"
      @save-permissions="savePermissions"
      @create-field="openFieldCreate"
      @edit-field="openFieldEdit"
      @remove-field="removeField"
      @reorder-fields="reorderFields"
    />

    <CustomFormFieldDialog
      v-model="fieldDialogVisible"
      :current-form-id="configDetail?.id ?? ''"
      :editing-field="editingField"
      :saving="fieldSaving"
      @save="saveField"
    />

    <CustomFormDataDrawer
      v-model="dataDrawerVisible"
      v-model:name="dataForm.name"
      v-model:owner-id="dataForm.ownerId"
      v-model:values="dataValues"
      :active-form-name="activeForm?.name ?? ''"
      :editing-data="editingData"
      :saving="dataSaving"
      :owner-options="ownerOptions"
      :fields="customDataFields"
      :members="members"
      :dept-tree="deptTree"
      :attachment-map="dataAttachmentMap"
      :attachment-download="downloadDataAttachment"
      :before-close="handleDataDrawerBeforeClose"
      @save="saveData"
    />
  </div>
</template>
