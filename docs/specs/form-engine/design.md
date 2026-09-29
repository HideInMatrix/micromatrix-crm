# Form Engine 与自定义表单设计

## 1. 分层

```text
ModuleForm / Field metadata
        │
        ├── shared form-runtime
        ├── API MetadataService
        ├── PC DynamicForm / Designer
        └── Mobile DynamicForm
              │
              ▼
resource main table + Field / FieldBlob
```

业务资源保存固定列，Form Engine 只管理可配置字段和值。自定义表单是唯一例外：它用 `CustomFormData` 作为轻量主表，再复用同一 Field/Blob 体系承载业务字段。

## 2. Metadata 边界

`ModuleFormsService` 负责表单属性、字段定义、系统字段补种和排序；业务 Service 只通过公开 Metadata API 解析可编辑字段、校验值和读写动态字段。

缓存只用于事务外读模型：`getConfig/listFields` 可以进入租户派生缓存，`listFieldsInTransaction` 必须直接读取当前 Prisma transaction。

## 3. 值存储

```text
resource row
  ├── fixed business columns
  ├── Field(resourceId, fieldId, scalar)
  └── FieldBlob(resourceId, fieldId, json/text)
```

字段类型决定 Field/Blob 编码。复杂值在 API 边界恢复成稳定类型；Formula 读取后计算。删除资源时动态值必须与主资源在同一事务或数据库 cascade 语义下收敛。

## 4. Attachment

Attachment 字段保存附件 ID 数组。保存流程：校验临时/已绑定附件 → transaction 写业务值 → commit 后 claim 新附件 → 清理移除附件。新建失败或取消编辑时必须清理当前会话临时上传，避免孤儿文件。

## 5. Data Source

公共 source adapter 提供 `page / resolve / fields / record snapshot`，内置 source 为 Customer、Contact、Lead；自定义表单 source 由目标 formId 动态解析。

Adapter 必须进入目标资源的 Service/DataScope，不允许 Form Engine 直接拼 Prisma 查询绕过权限。

## 6. Sub-table

`sub_product` 父字段在 FieldBlob 配置中保存 `subFields / fixedColumn / sumColumns`。单元格使用 `refSubId / rowId / bizId` 维度存入 Field/FieldBlob；顶层值和子表值使用不同 partial unique index 保证唯一性。

读取时按父字段和 rowId 重建稳定行数组；写入保留已有 bizId。子字段复用普通字段的类型校验、Data Source、Formula 和选项规则。

## 7. 联动运行时

`packages/shared` 的 form runtime 是 Web/API 共用事实源：

- 计算字段显隐；
- 执行 AUTO 联动；
- 计算 HIDDEN 选项范围；
- 应用 DATA_SOURCE combineSearch；
- 处理 showFields 的只读派生展示；
- 执行 linkFields / childLinkFields；
- 检查配置循环和类型兼容。

服务端最终校验不能依赖浏览器已执行过规则。

## 8. 自定义表单权限

`CustomFormAdmin` 决定表单配置权限；`CustomFormRoleUser` 决定数据权限。访问优先级为 `MANAGE_ALL > MANAGE_OWN > VIEW_ALL`。全局 RBAC 只决定能否进入自定义表单能力，不能替代表单内部数据授权。

SavedView 复用公共 UserView，以 `CUSTOM_FORM:<formId>` 隔离。导入复用 SpreadsheetService；导出使用 ExportTask + BullMQ，module key 为 `customFormData`。

## 9. 前端结构

路由 View 只做页面编排。表单目录、数据表、设计器、权限面板、字段 Dialog、数据 Drawer、附件状态和 SavedView/Filter 状态应分到稳定组件/composable，禁止再次把整套领域状态堆回一个 View。

## 10. 维护规则

- 不新增第二套 Metadata/Field 表。
- 不新增只在某个前端生效的字段规则。
- 不把已删除交易模块重新加入 Data Source registry。
- 新字段类型必须同步考虑 API 校验、Field/Blob 存储、列表、筛选、导入导出、PC/Mobile 和附件生命周期。
