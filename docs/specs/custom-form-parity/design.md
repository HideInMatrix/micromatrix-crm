# FORM-001 自定义表单技术设计

## 1. 模块边界

新增 API 模块：`apps/api/src/modules/custom-forms/`。

职责拆分：

- `CustomFormsService`：表单定义、管理员、角色、启停、设计元数据；
- `CustomFormDataService`：数据权限、CRUD、Field/Blob、公式；
- `CustomFormsController`：`/custom-form/*`；
- `CustomFormDataController`：`/custom-form/data/*`；
- 现有 `ModuleFormsService`：继续负责 `SysModuleForm / SysModuleField`。

Web 新页面：`apps/web/src/views/custom-forms/CustomFormsView.vue`，并拆分设计/成员/数据编辑组件。

## 2. 数据模型

### 2.1 CustomForm

采用 Cordys direct model：

```text
CustomForm
  id
  name
  enable
  organizationId
  createTime / updateTime
  createUser / updateUser
```

创建时使用相同 id 建立 `SysModuleForm`，`formKey = id`。

### 2.2 权限模型

```text
CustomFormAdmin(formId, userId)
CustomFormRole(formId, internalKey)
CustomFormRoleUser(roleId, userId)
```

三个 `internalKey` 固定为：

```text
MANAGE_ALL
VIEW_ALL
MANAGE_OWN
```

角色不可新增/删除/改名；UI 只管理每个角色下的成员。

### 2.3 数据模型

```text
CustomFormData
  id
  customFormId
  name
  ownerId
  organizationId
  audit

CustomFormDataField(resourceId, fieldId, fieldValue)
CustomFormDataFieldBlob(resourceId, fieldId, fieldValue)
```

Field/Blob 对 `resourceId + fieldId` 建唯一约束，删除数据时数据库级 cascade 清理字段值。

## 3. 默认字段

新表单必须原子创建：

1. `CustomForm`
2. `SysModuleForm + Blob`
3. 系统字段 `name`
4. 系统字段 `ownerId`
5. 三个内置角色
6. 当前用户管理员关系

默认字段属性：

| key       | label  | type   | required | system | showInList |
| --------- | ------ | ------ | -------- | ------ | ---------- |
| `name`    | 名称   | text   | true     | true   | true       |
| `ownerId` | 负责人 | member | true     | true   | true       |

为避免 `ModuleFormsService.ensureSystemFields()` 根据固定模块模板插入错误字段，自定义表单系统字段由 `CustomFormsService` 在创建事务内显式插入。

## 4. 字段值编码

第一阶段沿用现有字段类型：

- Blob：`textarea / multiselect / checkbox / picture`；
- 普通 Field：其它非 formula 类型；
- formula：不落库，读取后用 `MetadataService.computeFormulas()` 计算。

复杂值在 Field/Blob 中统一 JSON/string 编码，解码由服务按 FieldType 恢复 boolean、number、array/string。

## 5. 权限解析

定义内部 `CustomFormAccess = MANAGE_ALL | VIEW_ALL | MANAGE_OWN`。

`resolveAccess(user, formId, { requireEnabled, forWrite })`：

1. `organizationId + formId` 查询表单；
2. 当前用户为表单管理员 -> `MANAGE_ALL`；
3. 非管理员且 requireEnabled + form disabled -> 403；
4. 查询角色成员；
5. 多角色合并；
6. 无成员关系 -> 403。

写操作：

- `MANAGE_ALL`：全部；
- `MANAGE_OWN`：仅 ownerId = user.id；
- `VIEW_ALL`：拒绝。

读取操作：

- `MANAGE_ALL / VIEW_ALL`：全部；
- `MANAGE_OWN`：仅本人负责。

表单设计/管理员/成员/启停/删除额外要求 `isAdmin=true`。

## 6. API

第一阶段使用 REST 语义但保持 Cordys 领域边界：

```text
GET    /custom-form/list
GET    /custom-form/options
GET    /custom-form/:id
POST   /custom-form
PUT    /custom-form/:id
PATCH  /custom-form/:id/status
DELETE /custom-form/:id

GET    /custom-form/:id/admins
PUT    /custom-form/:id/admins
GET    /custom-form/:id/roles
PUT    /custom-form/:id/roles/:roleKey/users

GET    /custom-form/:id/form-config
POST   /custom-form/:id/fields
PUT    /custom-form/:id/fields/:fieldId
DELETE /custom-form/:id/fields/:fieldId
PUT    /custom-form/:id/fields/reorder

GET    /custom-form/:id/data
GET    /custom-form/:id/data/:dataId
POST   /custom-form/:id/data
PUT    /custom-form/:id/data/:dataId
DELETE /custom-form/:id/data/:dataId
```

导入导出已落在 `/custom-form/:id/data/*`，不复用固定业务对象 endpoint；xlsx 解析复用公共 `SpreadsheetService`，导出复用 `ExportTask + BullMQ worker`，worker module key 为 `customFormData`。

## 7. Web

页面骨架：

```text
CustomFormsView
  ├─ 左侧：表单搜索 / 新建 / 表单列表 / more actions
  └─ 右侧：当前表单 DataTable
       ├─ 关键词
       ├─ 新建数据
       ├─ 动态列
       └─ 编辑/删除

CustomFormConfigDrawer
  ├─ 表单设计
  └─ 成员权限
```

设计 Tab 第一阶段使用 `vuedraggable + 字段编辑 Drawer`，与当前 `ModulesView` 的 FieldVO 编辑契约保持一致；不复制 Cordys Naive UI 组件。

成员权限 Tab：顶部管理员多选；下方三个固定角色分别选择成员。

## 8. Baseline

项目尚未正式发布。若本单元修改 Prisma Schema，提交前按 `prisma-migration-policy.md` 重新生成唯一 pre-release baseline，并执行：

- 空 PostgreSQL `migrate deploy + seed`；
- `prisma migrate diff` 无差异；
- `prisma generate`。

## 9. E 列表增强设计

### 9.1 AdvancedFilter

- PC 继续复用公共 `AdvancedFilter / FilterConditionEditor`，筛选协议仍为 `FilterCondition[]`。
- 自定义表单的系统字段 `name / ownerId` 与动态 Field/Blob 不落在固定业务对象的 `ResourceFieldValueService` 表组，因此不把任意 `formId` 塞入固定 `ResourceFieldType`。
- `CustomFormsService` 针对固定表 `custom_form_data / custom_form_data_field / custom_form_data_field_blob` 编译参数化 PostgreSQL 条件；字段 ID、租户、formId 与条件值全部参数化，只有固定表名/运算符来自白名单。
- 多条件支持 `AND / OR`；临时 AdvancedFilter 使用 `AND`，SavedView 使用其持久化 `searchMode`。
- `formula / picture` 暂不进入 E 阶段筛选字段：formula 是读取时计算值，picture 无稳定比较语义；不为完成率伪造字符串筛选。formula 深层查询能力留给 F 公共 Form Engine 深化评估。

### 9.2 SavedView

- 复用现有 `sys_user_view / sys_user_view_condition`，不创建第二套自定义表单视图表。
- 每个自定义表单使用资源命名空间 `CUSTOM_FORM:<formId>`。`resource_type` 为 `varchar(50)`，当前 cuid formId 加前缀不会超过字段长度。
- 自定义表单 View API 放在 `/custom-form/:id/data/view/*`；每次操作先执行表单访问校验，再调用公共 `UserViewsService`，避免仅凭 viewId 跨表单访问。
- Web `SavedViewBar` 的 module key 使用 `customForm:<formId>`，frontend-shared 将该动态 key 映射为上述 View API；本地 active/column preference 也天然按 formId 隔离。

### 9.3 批量编辑 / 批量删除

- 请求继续复用 `ResourceBatchEditDto / BatchIdsDto`，单次最多 500 条。
- 服务端先加载目标记录并逐条执行 `assertWritableData`：MANAGE_ALL 可管理全部，MANAGE_OWN 只能管理本人数据，VIEW_ALL 无批量写权限。
- 批改字段通过 `MetadataService.resolveEditableField + validateBatchFieldValue`；formula/hidden 拒绝修改。`name / ownerId` 走主表，动态字段按 Field/Blob 存储类型只替换目标字段，不重写其它值。
- 批量 owner 变更继续遵守单条写入规则：非 MANAGE_ALL 不得把数据转交给其他负责人。
- 批量删除只删除当前表单、当前租户且已通过写权限检查的记录，不接受“部分成功”静默跳过。

## 10. F1 附件 / LOCATION

详细源码证据见 [f1-attachment-location-audit.md](./f1-attachment-location-audit.md)。

### 10.1 FieldType / FieldConfig

公共 Metadata 新增：

```text
location
attachment
```

`FieldConfig` 增加：

```text
scope?: 'ALL' | 'CN'
locationType?: 'C' | 'P' | 'PC' | 'PCD' | 'detail'
onlyOne?: boolean
accept?: string
limitSize?: string
```

LOCATION 默认 `ALL + PCD`；ATTACHMENT 默认 `onlyOne=false`、最多 10 个、单文件 20MB。

### 10.2 LOCATION 值契约

保持 Cordys：

```text
<regionCode>-<detail>
```

共享 location helper 提供：

- 按 scope/locationType 获取 Cascader options；
- code -> 完整地区路径；
- value -> 展示文本；
- Excel 文本 -> code/value。

`location` 作为普通 Field 保存，不进入 Blob。

### 10.3 ATTACHMENT 生命周期

`attachment` 作为 Blob 字段保存附件 ID 数组。CustomFormData 的附件目标统一为：

```text
targetType = customFormData
targetId   = dataId
```

服务端保存流程：

1. 校验字段值和附件 field config；
2. 查询当前值涉及的附件；
3. 仅允许当前用户当前租户的 unbound 临时附件，或已经绑定到当前 dataId 的附件；
4. DB 事务写 CustomFormData + Field/Blob；
5. 事务成功后绑定新增附件；
6. 删除被移除的旧附件。

数据详情额外返回：

```text
attachmentMap: Record<fieldKey, AttachmentVO[]>
```

新建表单时附件输入组件直接上传临时附件；编辑时使用 attachmentMap 恢复文件列表。

### 10.4 其它公共能力

- ATTACHMENT：不参与列表显示、AdvancedFilter、SavedView 条件、批量编辑、Excel 导入导出。
- LOCATION：支持普通列表展示、高级筛选 `eq/ne/isEmpty/notEmpty`，Excel 导入导出使用可读地区文本。
- Picture 继续保持既有能力，不与 Attachment 混用数据生命周期。

## 11. F1R 前端结构整改

F1 完成后 `CustomFormsView.vue` 已同时承担表单目录、配置设计、成员权限、数据列表、CRUD、SavedView、AdvancedFilter、导入导出、批量操作与附件编辑生命周期，超过路由页面应承担的“页面编排”职责。F2 DATA_SOURCE、F3 子表、F4 联动继续叠加前，必须先完成结构收口。

### 11.1 目标目录

```text
views/custom-forms/
├── CustomFormsView.vue
├── components/
│   ├── CustomFormSidebar.vue
│   ├── CustomFormDataTable.vue
│   ├── CustomFormConfigDrawer.vue
│   ├── CustomFormDesigner.vue
│   ├── CustomFormPermissionPanel.vue
│   ├── CustomFormFieldDialog.vue
│   └── CustomFormDataDrawer.vue
└── composables/
    ├── useCustomForms.ts
    ├── useCustomFormData.ts
    ├── useCustomFormDesigner.ts
    ├── useCustomFormPermissions.ts
    ├── useCustomFormViews.ts
    ├── useCustomFormTransfer.ts
    └── useCustomFormAttachments.ts
```

### 11.2 责任边界

- 路由 View 只负责页面骨架、active form 协调以及组件间事件串联，不直接维护字段 Dialog、数据 Drawer、权限表单等细粒度状态。
- `components/` 只负责一个稳定 UI 区域，不直接复制 API 调用逻辑；需要读写状态时通过 props/emits 或 composable 暴露的领域动作进入。
- `composables/` 承担跨组件共享的响应式状态、加载流程、副作用和领域 UI 行为；API 仍统一复用 `src/api/custom-form.ts`，不在组件内重复封装 HTTP。
- 附件临时上传的“已绑定 / 本次新上传 / 取消清理”生命周期单独放在 `useCustomFormAttachments`，由数据编辑 composable 显式调用，禁止散落到 Drawer 和页面层。
- 本单元只重构结构，不改现有接口契约、权限语义、筛选/视图/导入导出行为和 Browser Smoke fixture。

### 11.3 完成标准

- `CustomFormsView.vue` 回落为可读的页面编排文件，不再保存完整领域实现。
- F1R 拆分后原 FORM-001 Browser Smoke 与 F1 Attachment/LOCATION Browser Smoke 无需修改业务断言即可通过。
- root typecheck/lint/build、Prettier 与 `git diff --check` 全绿后，F2 才允许开始。

## 12. F2 DATA_SOURCE

### 12.1 值契约

- `data_source`：普通字段表保存单个资源 ID 字符串。
- `data_source_multiple`：Blob 字段表保存 JSON ID 数组。
- `FieldConfig.dataSourceType` 保存目标 source key；当目标是自定义表单时直接保存目标 `customFormId`。
- 字段已有持久化定义后，`dataSourceType` 不允许修改；如需切换目标，删除字段后重建。

### 12.2 Source Registry

公共 Form Engine 使用一份 source registry 描述内置数据源，不在组件内部散落 switch：

- 客户 `CUSTOMER`
- 联系人 `CONTACT`
- 商机 `OPPORTUNITY`
- 产品 `PRODUCT`
- 线索 `CLUE`
- 价格表 `PRICE`
- 合同 `CONTRACT`
- 报价单 `QUOTATION`
- 回款计划 `PAYMENT_PLAN`
- 回款记录 `CONTRACT_PAYMENT_RECORD`
- 工商抬头 `BUSINESS_TITLE`
- 订单 `ORDER`
- 发票 `INVOICE`

自定义表单 source 不进入固定枚举；是否为自定义源通过“未命中 registry 的 dataSourceType”判断，并进一步验证该 ID 属于当前租户真实 CustomForm。

### 12.3 API 与权限

Form Engine 不直接用 Prisma 绕过各业务对象的数据范围。数据源查询服务必须复用业务域已有列表/读取边界；自定义表单源直接复用 `CustomFormsService` 的 AccessState。

自定义源候选配置可显示租户内所有启用表单，但真正加载候选数据时：

- ADMIN / MANAGE_ALL / VIEW_ALL：全部；
- MANAGE_OWN：本人；
- 无权限：空列表；
- 非管理员访问停用目标表单：空列表。

### 12.4 UI

新增独立 `DataSourceFieldInput`，由 DynamicForm 使用，不把业务源查询逻辑重新塞回 `CustomFormsView.vue`。控件负责：

- 远程关键字搜索；
- 分页候选；
- 已选 ID 的名称补全；
- 单选/多选；
- 清空与只读状态。

FieldDialog 只负责 source type 配置；内置源与启用自定义表单在同一候选列表显示，排除当前表单。编辑既有 DATA_SOURCE 字段时 source type 禁用。

### 12.5 F2/F4 分界

F2 只实现引用目标本身。Cordys 的 `combineSearch / showFields / refFields / linkFields / childLinkFields` 会把数据源和当前字段状态产生联动，统一在 F4 实施，避免 F2 同时承担字段联动引擎。

### 12.6 实施与验收结果

- Shared/Metadata 已增加 `data_source / data_source_multiple`、内置 source registry 与动态 `customFormId` source type；单值进入普通字段表，多值进入 Blob JSON。
- `CustomFormsService` 已完成 source 存在性、自引用、租户隔离、保存后 source type 锁定和引用记录存在性校验；自定义表单 source 查询/解析复用目标表单 AccessState，内置 source 继续复用既有业务 API/DataScope。
- Web 已新增 `DataSourceFieldInput`，并接入 DynamicForm、FieldDialog、AdvancedFilter 与批量编辑；列表/详情通过可读名称解析展示，源记录删除或失权时退化显示原始 ID。
- Excel 已完成名称 -> ID 导入、ID -> 名称导出；自定义表单名称反查保持 `organizationId + customFormId` 边界，歧义名称 fail-closed。
- `form001-f2-service-smoke.mjs` 在独立 PostgreSQL acceptance 库 + Redis DB13 + BullMQ worker 上最终 **23/23 PASS**；`form001-f2-browser-smoke.mjs` 最终 **14/14 PASS**。
- 回归继续保持原 FORM-001/E Browser **31/31 PASS**、F1 LOCATION/ATTACHMENT Browser **16/16 PASS**；API Rules **192/192 PASS**，root typecheck/build PASS，lint **0 error / 8 个既有 warning**。
