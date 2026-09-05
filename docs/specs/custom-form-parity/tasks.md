# FORM-001 自定义表单对齐任务

状态：`IN_PROGRESS`

## A. 源码与设计

- [x] A1 审计 Cordys customForm 前端页面、配置 Drawer 和成员权限 UI。
- [x] A2 审计 `/custom-form/*`、`/custom-form/role/*`、`/custom-form/data/*`。
- [x] A3 审计 CustomForm Domain、角色语义、DDL 和 Field/Blob 数据结构。
- [x] A4 确认自定义表单直接复用 `SysModuleForm / SysModuleField`，不新建第二套字段定义引擎。
- [x] A5 固化 `requirements / design / source-api-audit / tasks`。

## B. 后端核心

- [x] B1 新增 CustomForm / Admin / Role / RoleUser / Data / Field / Blob Prisma direct model。
- [x] B2 创建表单时原子建立同 ID ModuleForm、默认名称/负责人字段、三角色和创建人管理员。
- [x] B3 实现表单列表/详情/创建/更新/启停/删除和管理员管理。
- [x] B4 实现三档角色成员管理及权限解析。
- [x] B5 实现数据列表/详情/创建/更新/删除、Field/Blob、公式和 owner 校验。
- [x] B6 将自定义表单 Field/Blob 纳入 ModuleFormsService 字段值计数/删除保护。
- [x] B7 加入 `menu:customForm + CUSTOM_FORM:READ/ADD` 权限及操作日志。

## C. PC 核心页面

- [x] C1 `/custom-forms` 替换 PlannedFeatureView。
- [x] C2 左侧表单列表、搜索、创建、启停、删除和配置入口。
- [x] C3 表单设计 Drawer：字段新增/编辑/排序/必填/列表显示/栅格。
- [x] C4 成员权限 Tab：管理员 + MANAGE_ALL / VIEW_ALL / MANAGE_OWN。
- [x] C5 右侧动态数据表格与 DynamicForm 新建/编辑/删除。
- [x] C6 停用/普通成员/管理员权限状态在 UI 上正确约束。

## D. 导入导出

- [x] D1 xlsx 模板下载与导入预检查。
- [x] D2 xlsx 正式导入。
- [x] D3 导出全部/选中，接入异步 ExportTask。
  - 模板/解析复用 `SpreadsheetService`；picture/formula 不进入导入列，UPDATE 通过“唯一ID”定位记录且未填写列保持原值。
  - 负责人/member/dept 导入支持租户内 ID、邮箱/唯一姓名或部门唯一名称解析，并继续执行表单三档角色权限。
  - 导出进入 `customFormData` 异步 worker；worker 执行时重新解析当前用户的表单访问权限，负责人/member/dept/创建人/更新人导出为可读名称。
  - `form001-import-export-smoke.mjs` 真实 PostgreSQL + Redis + BullMQ 验证模板、ADD/UPDATE 预校验与导入、Blob/公式、VIEW_ALL 拒绝导入、全量/选中异步导出及下载全部 PASS。

## E. 列表增强

- [x] E1 AdvancedFilter。
- [x] E2 SavedView。
- [x] E3 批量编辑/批量删除。
  - AdvancedFilter 对系统字段与动态 Field/Blob 使用参数化 SQL；SavedView 与临时筛选按 AND 叠加，SavedView 自身继续支持 AND/OR。
  - SavedView 复用 `sys_user_view`，每个表单使用 `CUSTOM_FORM:<formId>` 独立命名空间；删除表单同步清理对应视图，跨表单 viewId 返回 404。
  - 批量修改复用统一 Batch DTO，支持主表名称/负责人和动态字段，修改动态字段后公式实时重算；批量删除/修改继续执行 `MANAGE_ALL / MANAGE_OWN / VIEW_ALL` 边界。
  - `form001-list-enhancements-smoke.mjs` 真实 PostgreSQL 验证动态筛选、负责人筛选、OR SavedView、SavedView + 临时筛选、跨表单隔离、公式字段拒绝、三档权限与批量删除全部 PASS。
  - `form001-browser-smoke.mjs` 最终 **31/31 PASS**，新增真实浏览器高级筛选、SavedView 创建/自动应用/默认视图恢复、列设置、UI 批量修改并重算公式、UI 批量删除。

## F. 公共 Form Engine 深化

- [x] F1 附件 / LOCATION。
  - [x] F1.1 审计 Cordys LOCATION / ATTACHMENT 字段配置、运行时值、导入导出与批量编辑语义。
  - [x] F1.2 固化字段类型、地区值契约、附件临时上传/绑定/清理设计。
  - [x] F1.3 公共 Metadata + DynamicForm 增加 LOCATION / ATTACHMENT。
  - [x] F1.4 CustomFormData 完成附件归属校验、绑定、替换/删除清理与 attachmentMap。
  - [x] F1.5 LOCATION 接入列表展示、AdvancedFilter 与 xlsx 导入导出；ATTACHMENT 按 Cordys 排除这些场景。
  - [x] F1.6 API + PostgreSQL + Browser Smoke 与全仓门槛。
  - `form001-f1-service-smoke.mjs`：真实 Nest application context + PostgreSQL + 文件存储 + Redis/BullMQ worker，最终 **26/26 PASS**；覆盖附件 claim、防业务域绕过、MANAGE_OWN、替换/删数据/删字段/删表单物理清理，以及 LOCATION AdvancedFilter、xlsx 模板/导入/导出。
  - LOCATION Excel 文本已按 Cordys `RegionUtils` 语义使用 `-` 分隔，例如 `北京市-市辖区-东城区-东华门`；内部值仍为 `110101-东华门`，Web 展示继续使用 `/` 可读路径。
  - `form001-f1-browser-smoke.mjs`：隔离 5177 前端 + 3101 acceptance API + Chrome CDP，最终 **16/16 PASS**；覆盖设计器配置回显、数据 Drawer Cascader/附件上传、LOCATION 筛选控件，以及 ATTACHMENT 不进入筛选/列设置/导出候选。
- [x] F1R 前端结构整改（F2 前置门槛）。
  - [x] F1R.1 将 `CustomFormsView.vue` 收口为页面编排层，只保留 active form、区域组合和顶层事件串联。
  - [x] F1R.2 拆出表单侧栏、数据表格、配置 Drawer、字段设计器、成员权限、字段 Dialog、数据 Drawer 等领域组件。
  - [x] F1R.3 将表单列表、数据 CRUD、设计器、权限、SavedView/Filter、导入导出/批量操作、附件编辑生命周期抽为 `useCustomForm*` composable。
  - [x] F1R.4 保持现有 API、权限、DOM 业务语义与 Browser Smoke fixture 不变，不在本单元引入 F2/F3/F4 新业务能力。
  - [x] F1R.5 Web/root typecheck、lint、build、Prettier、`git diff --check` 与 FORM-001 Browser/F1 Browser 回归全部 PASS。
  - `CustomFormsView.vue` 已由约 1370 行 / 47KB 收口到约 323 行 / 9KB；页面只做 composable 组合和跨域事件编排。当前拆分为 7 个领域组件与 8 个 `useCustomForm*` composable，不再在路由页面直接维护字段设计、权限、SavedView/Filter、导入导出、批量操作和附件生命周期实现。
  - 回归证据：原 FORM-001 + E Browser **31/31 PASS**；F1 LOCATION / ATTACHMENT Browser **16/16 PASS**；API Rules **192/192 PASS**；root typecheck/build PASS；lint **0 error / 8 个既有 warning**；当前变更集 Prettier 与 `git diff --check` PASS。
- [x] F2 DATA_SOURCE 与自定义表单作为数据源。
  - [x] F2.1 审计 Cordys 单/多选数据源、source type、自定义表单编码、权限、Excel 与保存后锁定语义。
  - [x] F2.2 shared/Metadata 增加 `data_source / data_source_multiple` 与数据源注册表，服务端校验 `dataSourceType`。
  - [x] F2.3 建立公共数据源查询/解析 API；内置源复用现有业务权限，自定义表单源复用 CustomForm AccessState。
  - [x] F2.4 DynamicForm / FieldDialog 接入远程数据源单选/多选；当前表单禁止自引用，已保存字段锁定 source type。
  - [x] F2.5 DATA_SOURCE 接入列表展示、AdvancedFilter、批量编辑与 xlsx 名称往返。
  - [x] F2.6 PostgreSQL/API/Browser Smoke + root gates + 文档封板。
  - 验收证据：`form001-f2-service-smoke.mjs` **23/23 PASS**；`form001-f2-browser-smoke.mjs` **14/14 PASS**；原 FORM-001 + E Browser **31/31 PASS**；F1 Browser **16/16 PASS**；API Rules **192/192 PASS**；root typecheck/build PASS；lint **0 error / 8 个既有 warning**。
- [ ] F3 SUB_TABLE / SUB_PRODUCT 同类行模型抽象。
- [ ] F4 显隐规则、表单联动、字段联动。

## G. 验收

- [x] G1 API 专项：租户隔离、管理员、三档角色、停用、Field/Blob、公式。
- [x] G2 真实 PostgreSQL Smoke：创建表单 -> 设计 -> 成员 -> 数据 CRUD。
- [x] G3 Browser Smoke：PC 核心 + D/E 完整往返最终 31/31 PASS；含导入/导出、UI CRUD、公式、高级筛选、SavedView、列设置、批量修改/删除。
- [x] G4 Prisma baseline 空库 deploy/seed/diff，并确认两条 PostgreSQL partial unique index 保留。
- [x] G5 API Rules、typecheck、lint、build、Prettier、`git diff --check`。
  - API Rules `192/192 PASS`；root typecheck/build PASS；lint `0 error / 8 个既有 warning`；Prettier 与 diff check PASS。
- [x] G6 更新 `cordys-parity / project-progress / cordys-menu-parity / alignment-log` 并完成文档过期扫描。
  - 已清理“占位页 / 尚未实施 / 正在替换占位页”等过期描述；FORM-001 目前只剩 F 公共 Form Engine 深化，整体仍保持 `IN_PROGRESS`。
