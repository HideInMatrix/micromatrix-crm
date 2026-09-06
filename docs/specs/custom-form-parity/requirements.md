# FORM-001 自定义表单对齐需求

## 1. 目标

FORM-001 立项时 `/custom-forms` 仅为占位页面，而 CordysCRM 已具备完整的自定义表单定义、表单级管理员/成员权限、动态字段、数据 CRUD、批量操作、导入导出与数据源能力。当前 MicroMatrix 已完成自定义表单核心 runtime、PC 页面、xlsx 导入/异步导出、AdvancedFilter、SavedView、列设置、批量修改/删除，以及 F1～F4 公共 Form Engine 深化；本规格已完成最终验收并封板为 `VERIFIED`。

本执行单元把自定义表单从“菜单存在但无真实能力”推进为可独立承载业务数据的正式模块，并复用项目已经完成的 `sys_module_form / sys_module_field` 元数据底座，不再创建第二套字段定义引擎。

W3.7 之后尚未冻结新的 W3.x 编号，因此本单元固定使用独立编号 `FORM-001`，不臆造 W3.8。

## 2. Cordys 事实基线

- 自定义表单主入口为独立一级菜单，读取权限为 `CUSTOM_FORM:READ`，新建表单使用 `CUSTOM_FORM:ADD`。
- `custom_form.id` 与 `sys_module_form.id` 相同，`sys_module_form.form_key` 也直接使用表单 ID。
- 每个表单固定创建三档内置成员角色：`MANAGE_ALL`、`VIEW_ALL`、`MANAGE_OWN`。
- 表单管理员不依赖三档成员角色，始终按 `MANAGE_ALL` 处理；表单创建人默认成为管理员。
- 非管理员只能访问已启用表单；管理员即使表单停用仍可进入配置。
- `VIEW_ALL` 可查看全部数据但不能创建/修改；`MANAGE_OWN` 只能管理本人负责的数据；`MANAGE_ALL` 管理全部数据。
- 自定义表单数据主表只保存 `name / owner / organization / audit`，其它字段写入 `custom_form_data_field` 与 `custom_form_data_field_blob`。
- 表单设计至少固定包含“名称”和“负责人”两个不可删除的系统字段。

详细源码证据见 [source-api-audit.md](./source-api-audit.md)。

## 3. 第一阶段核心闭环

### R1 表单定义与元数据复用

- 新增真实 `CustomForm` 持久化模型。
- 创建自定义表单时 shall 同时创建同 ID 的 `SysModuleForm`，`formKey = customForm.id`。
- shall 自动创建“名称”和“负责人”两个系统字段，并确保必填、不可删除。
- 自定义字段 shall 继续使用现有 `SysModuleField / SysModuleFieldBlob`，字段 key 继续使用 `cf_*`。
- 表单布局属性 shall 保存到 `SysModuleFormBlob.prop`。
- 自定义表单删除时 shall 同步删除表单数据、成员关系、管理员和对应 ModuleForm/Field 定义，不遗留孤儿元数据。

### R2 表单级管理员与成员权限

- 新表单创建人 shall 自动成为管理员。
- 每个表单 shall 自动创建 `MANAGE_ALL / VIEW_ALL / MANAGE_OWN` 三个内置角色。
- 只有表单管理员可以修改表单设计、启停、删除、设置管理员和调整成员角色。
- 全局角色权限只决定用户是否能进入自定义表单模块；进入后的数据权限必须继续由表单级管理员/成员角色决定。
- 成员同时属于多个表单角色时，权限优先级 shall 为 `MANAGE_ALL > MANAGE_OWN > VIEW_ALL`；查看列表时 `VIEW_ALL` 与 `MANAGE_OWN` 的读取边界按 Cordys 语义处理。
- 非管理员访问停用表单 shall 返回 403/业务拒绝；管理员仍可打开并重新启用。

### R3 自定义表单数据

- 新增 `CustomFormData`、`CustomFormDataField`、`CustomFormDataFieldBlob`。
- 主表 shall 固定保存：表单 ID、名称、负责人、组织、创建/更新人和时间。
- 普通字段与大字段 shall 根据现有 FieldType 存入 Field/Blob 表；公式字段不落值，读取时实时计算。
- 新建/编辑 shall 服务端再次校验 required、字段类型和表单归属，不能只依赖前端 DynamicForm。
- `MANAGE_OWN` 列表/详情/编辑/删除只允许 `ownerId = 当前用户`；`VIEW_ALL` 只读；`MANAGE_ALL` 可管理全部数据。
- owner 必须是当前租户有效成员。
- 所有查询必须带 organizationId，跨租户表单 ID/数据 ID 返回 404。

### R4 PC 页面

- `/custom-forms` shall 替换 `PlannedFeatureView.vue`。
- 页面采用 Cordys 的双栏语义：左侧表单列表，右侧当前表单数据表格。
- 左侧支持搜索；管理员可新建、编辑、配置成员、启停和删除。
- 右侧根据动态字段生成列表列；提供关键词搜索、新建、编辑、删除和详情/编辑抽屉。
- 创建/编辑数据 shall 复用现有 `DynamicForm`、成员和部门引用数据。
- 表单配置 Drawer shall 至少提供“表单设计”和“成员权限”两个 Tab。
- 表单设计第一阶段使用项目现有字段编辑能力完成字段新增、编辑、排序、必填、列表显示和栅格宽度，不伪装已经完成 Cordys 尚未迁移的字段联动/子表/数据源能力。

### R5 权限与日志

- 增加独立菜单权限 `menu:customForm`，其子权限至少包含 `CUSTOM_FORM:READ`、`CUSTOM_FORM:ADD`。
- 现有左侧菜单不得继续使用 `menu:system` 作为自定义表单权限。
- 表单创建/编辑/启停/删除、管理员/成员变更、数据新增/编辑/删除 shall 进入 `@LogOperation` 操作日志链路。

## 4. 子任务状态

第一阶段核心闭环完成后，FORM-001 按以下顺序补齐：

1. `FORM-001D`：xlsx 导入预检查、正式导入、全量/选中导出，复用现有 `SpreadsheetService / ExportTask`。**已完成并验收。**
2. `FORM-001E`：AdvancedFilter / SavedView / 列设置 / 批量编辑与批量删除。**已完成并验收。**
3. `FORM-001F`：补齐公共 Form Engine 的附件、LOCATION、数据源、子表、显隐/字段联动，再开放自定义表单对应设计能力。**F1 附件 / LOCATION、F2 DATA_SOURCE、F3 SUB_TABLE / SUB_PRODUCT、F4 显隐/表单联动/字段联动均已完成并验收。**

F1～F4 已完成实现、专项 Smoke、Browser 回归、空库 baseline/seed/diff 与 root gates，FORM-001 当前正式状态为 `VERIFIED`。后续若继续扩展 SERIAL_NUMBER、DIVIDER 或其它公共 Metadata 高级语义，应建立新的独立执行单元，不重新打开 FORM-001 已完成范围。

## 5. 验收

- 从空库创建一个真实表单，确认 CustomForm 与同 ID ModuleForm 同时存在。
- 创建至少文本、数字、单选、多选、图片、公式字段并保存/刷新恢复。
- 设置管理员与三档成员角色，真实验证 `MANAGE_ALL / VIEW_ALL / MANAGE_OWN` 的读取/写入边界。
- 创建、编辑、删除真实表单数据，并验证 Field/Blob/公式读取。
- 禁用表单后验证管理员仍可进入、普通成员不可进入。
- 验证跨租户表单和数据 ID 不可访问。
- PC Browser Smoke 覆盖表单创建、字段设计、成员配置、数据 CRUD 与启停。
- Prisma validate/generate、API Rules、typecheck、lint、build、`git diff --check` 全绿。
