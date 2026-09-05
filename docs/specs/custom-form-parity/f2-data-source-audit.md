# FORM-001F2 DATA_SOURCE 源码审计

## 1. Cordys 字段模型

Cordys 把数据源拆为两个字段类型：

- `DATA_SOURCE`：单选，业务值最终保存为单个资源 ID。
- `DATA_SOURCE_MULTIPLE`：多选，业务值保存为资源 ID 数组，并进入 Blob 字段表。

字段公共配置至少包含：

- `dataSourceType`：目标数据源类型。
- `combineSearch`：数据源候选过滤条件。
- `showFields / refFields`：引用显示字段。
- `linkFields / childLinkFields`：字段联动。
- `listDisplayFields`：数据源选择列表显示字段。

本执行单元只关闭“数据源选择与引用值”的核心能力；`combineSearch / showFields / linkFields / childLinkFields` 中涉及字段联动、引用字段派生的部分继续归 FORM-001F4，不提前混入 F2。

## 2. 数据源类型编码

Cordys 的内置 `FieldDataSourceTypeEnum` 包含：

`CUSTOMER / CONTACT / OPPORTUNITY / PRODUCT / CLUE / PRICE / CONTRACT / QUOTATION / PAYMENT_PLAN / CONTRACT_PAYMENT_RECORD / BUSINESS_TITLE / ORDER / INVOICE`。

自定义表单不是额外固定枚举。Cordys 前端将任何“不属于内置枚举”的 `dataSourceType` 判断为自定义表单数据源；该字符串本身就是目标 `customFormId`。后端 `FieldSourceType.safeValueOf(type)` 同样把未知内置枚举的字符串归为 `CUSTOM_FORM`。

因此 MicroMatrix F2 冻结以下契约：

- 内置数据源：`dataSourceType = <内置 source key>`。
- 自定义表单数据源：`dataSourceType = <targetCustomFormId>`。
- 不增加第二套 `CUSTOM_FORM:<id>` 编码，也不增加数据源关系表。

## 3. 设计器语义

Cordys 数据源候选由“内置业务源 + 已启用自定义表单”组成。

自定义表单候选：

- 只返回启用表单。
- 当前正在设计的自定义表单从候选中排除，避免直接自引用。
- 数据源字段第一次保存后，`dataSourceType` 被锁定，不允许再切换目标类型。

Cordys `/custom-form/option` 只按组织和 `enable=true` 返回表单，并不按当前用户是否已加入目标表单角色过滤。权限边界发生在真正加载目标表单数据时。

## 4. 运行时权限

Cordys 自定义表单数据源通过 `/field/source/custom-form-data` 调用 `CustomFormDataService.page(..., catchPermissionException=true)`：

- 表单管理员：查看全部。
- `MANAGE_ALL / VIEW_ALL`：查看全部。
- `MANAGE_OWN`：只返回本人负责的数据。
- 无目标表单角色、目标表单被停用等权限异常：数据源模式返回空列表，不把异常升级成当前业务表单不可编辑。

因此引用字段不能借“当前表单”的权限读取“目标表单”数据。

## 5. 值与展示

Cordys 表单组件内部统一以 ID 数组维护数据源选择：

- `DATA_SOURCE` 提交前收敛为单个 ID。
- `DATA_SOURCE_MULTIPLE` 保持 ID 数组。

列表、详情、Excel 均把 ID 解析为源记录名称。Excel 导入按可读名称反查 ID；导出使用名称而不是内部 ID。

F2 对自定义表单数据源要求名称解析始终带 `organizationId + customFormId`，禁止跨表单同名数据串用。名称不唯一时导入必须报明确错误，不静默取第一条。

## 6. 本执行单元边界

F2 必须完成：

- 单选/多选 DATA_SOURCE 元数据类型。
- 内置数据源注册表与自定义表单动态 source type。
- 远程搜索、已选值回显、单/多选保存。
- 自定义表单作为数据源，并保持目标表单数据权限。
- 列表展示、AdvancedFilter、批量编辑、Excel 导入导出基础语义。
- 保存后禁止修改 `dataSourceType`。

F2 不包含：

- `showFields/refFields` 自动生成引用显示字段。
- `combineSearch` 依赖当前表单字段的动态过滤。
- `linkFields/childLinkFields` 字段联动。
- 子表中的数据源行联动。

这些继续进入 F3/F4。

## 7. MicroMatrix 实施结果

- `data_source` 与 `data_source_multiple` 已进入公共 FieldType；前者保存单个 ID，后者保存 ID 数组并使用 Blob 分表。
- 内置业务 source 使用固定 registry；自定义表单 source 直接保存目标 `customFormId`。设计器候选只列租户内启用表单并排除当前表单，API 同时校验不存在、跨租户和自引用。
- 已保存数据源字段的 `dataSourceType` 在 UI 和 API 两层锁定，不能通过直接接口绕过修改。
- 自定义表单 source 的 page/resolve 继续执行目标表单 ADMIN / MANAGE_ALL / VIEW_ALL / MANAGE_OWN 数据范围；无目标表单访问权时返回空候选，不借消费表单权限越权读取。
- DynamicForm、AdvancedFilter、批量编辑、列表名称展示与 xlsx 名称往返均已完成。F4 所属 `combineSearch / showFields / refFields / linkFields / childLinkFields` 未提前实施。
- 专项验收：Service **23/23 PASS**、Browser **14/14 PASS**；原 FORM-001/E Browser **31/31 PASS**、F1 Browser **16/16 PASS**；API Rules **192/192 PASS**。
