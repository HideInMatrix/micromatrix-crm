# FORM-001 Cordys 自定义表单源码 / API / DDL 审计

## 1. 前端入口

Cordys 前端目录：

- `frontend/packages/web/src/views/customForm/index.vue`
- `components/formTable.vue`
- `components/customFormConfigDrawer/index.vue`
- `components/customFormConfigDrawer/memberPermissionTab.vue`

主页面结构为左侧表单列表 + 右侧当前表单数据表格。左侧管理员动作包含启用/关闭、编辑、添加成员、删除；新建表单要求 `CUSTOM_FORM:ADD`。

配置 Drawer 固定两个 Tab：

- `design`：表单设计；
- `memberPermission`：表单成员权限。

新建表单保存前不能进入成员权限 Tab。表单设计未保存切换时有明确的未保存保护。

## 2. API

### 2.1 表单定义

`CustomFormController`：

- `GET /custom-form/list`
- `GET /custom-form/option`
- `GET /custom-form/get/{id}`
- `POST /custom-form/add`
- `POST /custom-form/update`
- `GET /custom-form/delete/{id}`
- `GET /custom-form/enable/{id}`
- `GET /custom-form/disable/{id}`
- `POST /custom-form/admin/set`
- `GET /custom-form/admin/get/{customFormId}`

权限：读取/修改绝大部分使用 `CUSTOM_FORM:READ`，新建使用 `CUSTOM_FORM:ADD`。前端路由自身也要求 `CUSTOM_FORM:READ`。

### 2.2 表单角色

`CustomFormRoleController`：

- `GET /custom-form/role/list/{customFormId}`
- `POST /custom-form/role/users`
- `GET /custom-form/role/user/dept/tree`
- `GET /custom-form/role/user/role/tree`
- `POST /custom-form/role/user/add`
- `POST /custom-form/role/user/remove`

内置角色来自 `CustomFormRoleKey`：

- `MANAGE_ALL`：管理全部数据；
- `VIEW_ALL`：查看全部数据；
- `MANAGE_OWN`：管理本人数据。

表单管理员不依赖上述角色，运行时直接视为 `MANAGE_ALL`。

### 2.3 表单数据

`CustomFormDataController`：

- `POST /custom-form/data/page`
- `GET /custom-form/data/get/{id}`
- `GET /custom-form/data/create-permission/{customFormId}`
- `POST /custom-form/data/add`
- `POST /custom-form/data/update`
- `GET /custom-form/data/delete/{id}`
- `POST /custom-form/data/batch/update`
- `POST /custom-form/data/batch/delete`
- `POST /custom-form/data/export-all`
- `POST /custom-form/data/export-select`
- `GET /custom-form/data/template/download`
- `POST /custom-form/data/import/pre-check`
- `POST /custom-form/data/import`

`CustomFormDataService.getDataScope()` 的事实语义：

1. 表单管理员直接返回 `MANAGE_ALL`；
2. 非管理员访问禁用表单拒绝；
3. 从表单三个内置角色中解析当前成员；
4. 写路径优先级 `MANAGE_ALL > MANAGE_OWN > VIEW_ALL`；
5. 读取路径 `MANAGE_ALL` 看全部，`VIEW_ALL` 看全部，`MANAGE_OWN` 查询额外加 `owner = 当前用户`；
6. `VIEW_ALL` 新建时被 `checkCreatePermission()` 明确拒绝。

## 3. 数据模型

Cordys `V1.7.1_2__ga_ddl.sql` 新增：

- `custom_form`
- `custom_form_admin`
- `custom_form_role`
- `custom_form_role_user`
- `custom_form_data`
- `custom_form_data_field`
- `custom_form_data_field_blob`

`custom_form_data` 直接字段只有：

- `custom_form_id`
- `name`
- `owner`
- `organization_id`
- audit 字段

动态字段全部进入 Field/Blob。

## 4. ModuleForm 关系

`CustomFormService.create()` 明确：

- 先生成 `formId`；
- `custom_form.id = formId`；
- 再创建 `sys_module_form.id = formId`；
- `sys_module_form.form_key = formId`；
- 表单字段继续由通用 `ModuleFormService` 保存。

这说明自定义表单不是另一套字段引擎，而是“动态创建 formKey 的 ModuleForm”。MicroMatrix 现有 `ModuleFormsService.ensureForm()` 已允许任意 formKey，因此该底座可直接复用。

## 5. 默认系统字段

Cordys `BusinessModuleField` 为自定义表单强制定义：

- `CUSTOM_FORM_DATA_NAME` -> business key `name`；
- `CUSTOM_FORM_DATA_OWNER` -> business key `owner`。

前端新建默认设计中也包含“名称”和“负责人”，均为必填且不可删除关键属性。

MicroMatrix 实现时继续使用本项目 FieldType 命名：

- `name` -> `text`；
- `ownerId` -> `member`。

## 6. MicroMatrix 实施结果与剩余差异

立项时 `/custom-forms` 仍是 `PlannedFeatureView.vue`，且没有 CustomForm 主表、表单级管理员/三档角色和 CustomFormData Field/Blob。FORM-001 A～E 实施后，当前代码状态为：

- `/custom-forms` 已替换为真实双栏页面，包含表单设计、管理员/三档成员权限和动态数据 CRUD；
- 已新增 CustomForm / Admin / Role / RoleUser / Data / DataField / DataFieldBlob direct model，并与同 ID `SysModuleForm / SysModuleField / Blob` 复用；
- `ModuleFormsService` 已把自定义表单 Field/Blob 纳入字段值计数与删除保护；
- 已复用 `DynamicForm / DynamicFormItem / PictureFieldInput / AdvancedFilter / SavedViewBar / BatchFieldEditDialog`，没有复制第二套字段定义或视图引擎；
- xlsx ADD/UPDATE 导入、异步 ExportTask 导出、AdvancedFilter、SavedView、列设置和批量修改/删除均已完成真实 API/Browser 验收；
- 当前剩余差异集中在 F 公共 Form Engine 深化：附件、LOCATION、DATA_SOURCE、子表以及显隐/表单联动/字段联动。

结论：原“先补 CustomForm 领域模型与权限/数据 runtime，再接现有 Form Engine”的实施路径已完成；后续继续扩展公共 Form Engine，不为自定义表单复制独立实现。
