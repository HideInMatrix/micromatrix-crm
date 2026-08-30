# W3.6.4 发票 / 工商抬头源码、DDL 与审批证据矩阵

> 审计日期：2026-08-29
>
> 范围：W3.6.4 task 5.2。目标是锁定 CordysCRM 发票 direct model、工商抬头依赖、审批/撤回/删除语义、快照、DataScope、Import/Export 与现有 MicroMatrix 差异。页面完整对齐、通知和 `/system/modules` 最终交互关闭留给 5.3～5.4。

## 1. Cordys 主域与源码入口

### 1.1 发票

- 主 Controller：`ContractInvoiceController`，根路径 `/invoice`。
- Service：`ContractInvoiceService`，实现 `ApprovalResourceHandler`，CREATE / UPDATE / DELETE 均通过 `@HitApproval` 接入统一审批执行链。
- Domain：`ContractInvoice -> contract_invoice`。
- 动态字段：`contract_invoice_field / contract_invoice_field_blob`。
- 审批快照：`contract_invoice_snapshot`。
- Mapper：`ExtContractInvoiceMapper.xml`。
- User View：`ContractInvoiceUserViewController -> /invoice/view/*`，资源类型 `CONTRACT_INVOICE`。
- 前端：`views/contract/invoice/*`；列表实际通过 `useApprovalOperation + useApprovalResourceAction` 操作提审和撤销。

### 1.2 工商抬头

- 主域：`BusinessTitle -> business_title`，Controller 根路径 `/contract/business-title`。
- 配置：`BusinessTitleConfig -> business_title_config`，Controller 根路径 `/business-title/config`。
- 发票 `business_title_id` 直接引用工商抬头；删除抬头前 Cordys 提供 `invoice/check/{id}` 检查是否已开票。
- `/business-title/config/get` 读取字段必填配置；`/business-title/config/switch/{id}` 使用 `MODULE_SETTING_UPDATE` 切换 required。

## 2. 发票最终 direct model

Cordys 1.5.0 DDL 创建：

### `contract_invoice`

- `id`
- `name`
- `contract_id`
- `owner`
- `amount`
- `invoice_type`
- `tax_rate`
- `approval_status`
- `business_title_id`
- `organization_id`
- `create_time / update_time / create_user / update_user`

1.7.2 额外增加：

- `approved BOOLEAN`：是否曾经审批通过；历史 `approval_status = APPROVED` 数据一次性回填为 `approved = true`。

因此 `approved` 是审批历史事实位，不能用当前 `approvalStatus` 推导替代。

### Field / Blob

`contract_invoice_field` 与 `contract_invoice_field_blob` 保存动态表单字段。1.8.2 又为 Field/Blob 增加 `ref_sub_id / row_id / biz_id` 子表格定位能力；MicroMatrix 当前通用 metadata 后续若暂不支持该增强，也不能把这些自定义字段重新硬编码进主表。

### Snapshot

`contract_invoice_snapshot`：

- `invoice_id`
- `invoice_prop`：表单配置快照
- `invoice_value`：业务值快照

ADD 创建快照；UPDATE 删除旧快照并重新生成；DELETE 删除快照。审批详情可读取 `/invoice/get/snapshot/{id}` 与 `/invoice/module/form/snapshot/{id}`。

## 3. 默认表单：direct 字段与动态字段边界

`field.json + BusinessModuleField` 双向确认以下为主表 direct 字段：

| 页面字段 | internalKey | direct 字段 | 规则 |
| --- | --- | --- | --- |
| 发票名称 | `invoiceName` | `name` | required |
| 合同名称 | `invoiceContract` | `contractId` | required，DATA_SOURCE(CONTRACT) |
| 开票类型 | `invoiceType` | `invoiceType` | required |
| 税率 | `invoiceTaxRate` | `taxRate` | required |
| 工商抬头 | `invoiceBusinessTitle` | `businessTitleId` | required，DATA_SOURCE(BUSINESS_TITLE) |
| 发票金额 | `invoiceAmount` | `amount` | required |
| 负责人 | `invoiceOwner` | `owner` | required，默认当前用户 |

默认表单中的以下字段没有 `BusinessModuleField` direct 映射，应继续走动态 Field/Blob：

- `invoiceProjectName` 开票项目名称
- `invoiceSpecification` 规格型号
- `invoiceUnit` 单位
- `invoiceQuantity` 数量

## 4. 发票金额校验是真实业务规则

ADD / UPDATE 都调用 `calculateContractInvoiceValidAmount()`。

有效已开票金额的真实 SQL 口径为：

- 同一 `contract_id + organization_id`
- `approval_status in ('APPROVED', 'APPROVING')`
- UPDATE 排除当前 invoice id

当 `request.amount > contract.amount - validInvoiceAmount` 时抛出 `invoice.amount.exceed`。

因此 MicroMatrix 迁移后必须保留“累计有效开票金额不得超过合同金额”的规则，而且 **APPROVING 也占用合同可开票额度**。

合同详情统计 `/contract/invoice/statistic/{contractId}` 的口径受组织级“发票审批是否启用”影响：启用审批时只统计 `APPROVED`，未启用审批时统计全部发票。这个统计口径与 ADD/UPDATE 的额度占用口径不同，不能混成同一个查询。

## 5. 审批不是旧 InvoiceStatus 状态机

Cordys 发票主业务状态使用统一 `ApprovalStatus`：

- `NONE`
- `PENDING`
- `APPROVING`
- `APPROVED`
- `UNAPPROVED`
- `REVOKED`
- `AUTO_APPROVED`
- `AUTO_UNAPPROVED`

创建时：

- `approvalStatus = NONE`
- `approved = false`

UPDATE 明确保留原 `approvalStatus`；审批流负责变更审批状态和 `approved` 历史事实。

MicroMatrix 当前 `InvoiceStatus = PENDING / ISSUED / VOID` 不是 Cordys 发票模型，不能继续作为第二套业务真相。

## 6. 提审 / 撤销主链

Cordys 前端当前发票表格并不直接使用历史 requrl 中声明的 `/invoice/approval`、`/invoice/revoke`。

真实主链为通用审批资源 API：

- `POST /approval-resource/push`：`resourceId + formKey=invoice`
- `POST /approval-resource/revoke`：`resourceId + formKey=invoice`
- `GET /approval-resource/simple-detail/{resourceId}`
- `GET /approval-resource/detail/{resourceId}`

发票列表通过 `useApprovalOperation` 计算 edit/delete/review/revoke 操作，通过 `useApprovalResourceAction` 调用上述通用接口。

因此 MicroMatrix 5.2 应把现有通用 `ApprovalsService` 扩展到 invoice 资源，而不是重新发明一套 invoice-only 审批 Controller。

## 7. CREATE / UPDATE / DELETE 审批时机

`ContractInvoiceService`：

- ADD：`@HitApproval(... executeType=CREATE ...)`
- UPDATE：`@HitApproval(... executeType=UPDATE, updateType, comment ...)`
- DELETE：`@HitApproval(... executeType=DELETE ...)`
- batch delete：先调用统一 approval resource 的 batch delete trigger；命中审批的资源进入审批，未命中的才直接删除。

发票 Service 还实现：

- `getPreUpdateSnapshotData()`：审批更新前保存业务快照。
- `revertToSnapshot()`：审批回退时恢复审批前业务数据。
- `updateSnapshotApprovalStatus()`：同步 invoice snapshot 内审批状态。
- `updateApprovalPostField()`：审批后置字段可更新 direct 字段或动态字段，并同步快照和日志。

这意味着 5.2 的“审批接入”至少要同时覆盖：状态、update 回退快照、create/update/delete execute timing，不能只让发票出现在审批待办列表。

## 8. 发票主 API

`/invoice/*` 已确认：

- `GET /module/form`
- `POST /page`
- `GET /get/{id}`
- `GET /get/snapshot/{id}`
- `POST /add`
- `POST /update`
- `GET /delete/{id}`
- `POST /batch/delete`
- `GET /module/form/snapshot/{id}`
- `GET /tab`
- `POST /export-select`
- `POST /export-all`
- `GET /template/download`
- `POST /import/pre-check`
- `POST /import`

合同详情额外提供：

- `POST /contract/invoice/page`
- `GET /contract/invoice/statistic/{contractId}`

客户 360 也消费同一 direct 发票模型与统计口径。

## 9. DataScope / User View

Mapper 以 `contract_invoice.owner` 做直接数据范围：

- SELF：`ci.owner = currentUser`
- DEPARTMENT：owner 所属部门在允许部门集合
- 其它部门范围视图按 Cordys 规则允许部门范围，并在非纯 DEPARTMENT 视图中允许本人
- 所有查询强制 `ci.organization_id = orgId`

Page 支持：

- `contractId`
- `customerId`
- `keyword(name)`
- Saved View / filters / combineSearch / viewCombineSearch / sort

User View：`/invoice/view/add|update|delete|detail|list|fixed|edit/pos|enable`，资源类型 `CONTRACT_INVOICE`。

## 10. 权限

Cordys permission tree：

- `CONTRACT_INVOICE:READ`
- `CONTRACT_INVOICE:ADD`
- `CONTRACT_INVOICE:UPDATE`
- `CONTRACT_INVOICE:DELETE`
- `CONTRACT_INVOICE:IMPORT`
- `CONTRACT_INVOICE:EXPORT`

早期 migration 曾出现 `CONTRACT_INVOICE:APPROVAL`，但当前 permission.json 主权限组只保留上述六项；提审/撤回走通用审批资源能力，不应仅凭旧 migration 再暴露一个孤立的 invoice approval 权限。

## 11. 工商抬头 direct model

`business_title` 至少包含：

- `name`
- `type`
- `identification_number`
- `opening_bank`
- `bank_account`
- `registration_address`
- `phone_number`
- `registered_capital`
- `company_size`
- `registration_number`
- `approval_status`
- `unapproved_reason`
- `organization_id`
- audit fields

`BusinessTitleConstants` 还定义 province/city/scale/industry/remark/companyNumber 等表单配置字段；实现时需按真实 Domain/Mapper 再确认哪些为主表演进字段、哪些为外部企业信息扩展，不能把 enum 全部直接塞进主表。

`business_title_config` 是独立 required 配置表，最终结构只有 `id/field/required/organization_id`，没有 BaseModel audit 字段；它不等价于 metadata form required。5.4 的“工商抬头必填设置”必须对接这套配置语义。

## 12. MicroMatrix 当前差异

> 本节记录的是 5.2 开始前的差异基线；5.2B/5.2C 的已完成状态见第 14～15 节。

5.2 开始前 `InvoiceRecord -> invoice_records`：

- `tenantId / contractId / titleId / amount / type`
- `status = PENDING/ISSUED/VOID`
- `invoiceNo / issuedAt / remark / ownerId`
- 无 Field/Blob
- 无 Snapshot
- 无 direct audit fields / organizationId
- 无 `approvalStatus + approved`
- 无 User View / Import/Export
- 仍由 `/contracts/invoices` 简化接口创建，另有 `issueInvoice()` 和 `voidInvoice()` 这套 Cordys 不存在的状态流

5.2 开始前 `InvoiceTitle -> invoice_titles` 也是简化模型，尚未对齐 `business_title + business_title_config + approvalStatus`。

审批配置已经支持 `formType=invoice`，但 `ApprovalFlowConfigService` 明确把 invoice 标记为 `runtimeReady=false` 并禁止启用；`ApprovalModule` 与 `ApprovalsService.targetInfo/status update` 当前也未接入 invoice。这正是 5.2 的审批运行时缺口。

## 13. 5.2 实施边界

### 必做

1. `contract_invoice + field/blob + snapshot` direct Prisma 与 forward migration。
2. 旧 `invoice_records` 有效数据一次性升级，之后删除旧模型/旧表，不双写。
3. `business_title + business_title_config` 作为 invoice 依赖 direct 化；旧 `invoice_titles` 数据升级。
4. metadata FormKey `invoice` direct 字段与动态字段接入。
5. `CONTRACT_INVOICE:*` 权限、User View、DataScope。
6. `/invoice/*` CRUD、batch delete、snapshot、Import/Export。
7. 通用 `ApprovalsService` 接入 invoice，解除 `runtimeReady=false`，支持 CREATE/UPDATE/DELETE execute timing 与撤回。
8. ADD/UPDATE 开票额度校验严格按 `APPROVED + APPROVING`。
9. 合同详情/客户 360 迁移到 direct 发票模型。
10. 专项 migration/upgrade/API/approval Smoke，最后再移除 `/contracts/invoices` 旧主调用链。

### 不提前做

- 5.3 才关闭独立发票页面完整 UI、通知等页面级链路。
- 5.4 才最终关闭 `/system/modules` 的工商抬头 required 开关与发票表单入口。
- 不保留 `PENDING/ISSUED/VOID` 与 `approvalStatus` 双状态。
- 不新增没有源码依据的“发票作废业务状态”；用户口中的“作废”应先映射到 Cordys 当前撤回/驳回/删除审批语义，除非后续源码找到独立 VOID 字段或动作证据。

## 14. 5.2B 实施结果

- 新增 `business_title / business_title_config / contract_invoice / contract_invoice_field / contract_invoice_field_blob / contract_invoice_snapshot` Prisma 模型。
- 第 50 个 forward migration：`20260829231000_w364_invoice_direct_models` 已在当前库成功执行。
- 旧工商抬头属于迁移前已可使用的数据，升级为 `type=CUSTOM + approvalStatus=APPROVED`，保留原 id/name/税号/银行/地址/电话与 audit 时间；缺失 create/update user 时按关联发票 owner、租户最早用户、`system` 依次兜底。
- 旧发票状态一次性映射：`PENDING -> NONE`、`ISSUED -> APPROVED + approved=true`、`VOID -> REVOKED + approved=false`。旧 VOID 模型没有保存“是否曾 ISSUED”的历史，因此不伪造 approved 事实。
- 旧模型没有 taxRate，升级安全初始化为 `0`；后续 direct ADD/UPDATE 按 Cordys DTO 要求真实填写。
- `invoiceNo / issuedAt / remark / legacyStatus / legacyTitleId` 保存在 migration snapshot 中，不重新加入 Cordys direct 主表。
- 当前库验证：legacy title/direct title = `16/16`，legacy invoice/direct invoice/snapshot = `1/1/1`，35 个租户 × 14 条 business title config = `490/490`。
- 5.2B 阶段不删除 legacy 表，也不写双份数据；5.2C/D 完成 runtime 切换并通过升级 Smoke 后，5.2E 再删除 legacy 模型/表。

## 15. 5.2C direct runtime / API 实施结果

### 15.1 发票 direct runtime

- 新增 `ContractInvoiceService / ContractInvoiceController / contract-invoice.dto.ts`，运行时读写统一落到 `contract_invoice + contract_invoice_field/blob + contract_invoice_snapshot`。
- `/invoice/*` 已具备 module form、page/get/add/update/delete、batch delete、snapshot/form snapshot、tab、User View、Import/Export。
- owner 默认当前用户；DataScope 使用 `CONTRACT_INVOICE:READ` 对 `contract_invoice.owner` 展开，Saved View 与动态字段筛选继续复用统一 User View / Field 设施。
- ADD/UPDATE 合同金额保护按源码以 `APPROVED + APPROVING` 作为有效额度占用，UPDATE 排除当前发票。
- 合同详情 `/contract/invoice/page|statistic/:contractId` 与客户 360 page/statistic 均已切到 direct model。

### 15.2 工商抬头与 `/system/modules`

- `BusinessTitleService` 已真实提供 page/get/option/add/update/delete/invoice-check/approval/revoke；`CUSTOM -> APPROVING`，审核通过后才进入发票 option。
- `/business-title/config/get|switch/:id` 已真实消费 `business_title_config`，保持 14 项/租户 required 配置。
- `/system/modules` 合同卡片的“工商抬头表单必填设置”已替换 deferred 为真实 Drawer；“发票表单设置”已进入 `/system/modules/fields?module=invoice`。

### 15.3 caller 与旧真相退出进度

- `ContractDetailDrawer` 已使用 direct invoice / business-title API，旧“标记已开票 / 作废”按钮退出，页面统一展示 `approvalStatus`。
- Customer 360、合同删除引用检查、成员删除引用检查均已迁到 direct model；客户合并不再维护 Cordys `business_title` 不存在的 customerId 关系。
- 5.2C 关闭时旧 `InvoicesService` 只作为 5.2E 删除前的 URL 兼容适配层，内部已不再访问 `invoice_records / invoice_titles`；5.2E 已进一步物理删除该兼容层。
- 最终运行时扫描：`prisma.invoiceRecord / prisma.invoiceTitle / tx.invoiceTitle / invoice:manage / invoiceTitle:manage` **0 匹配**；发票相关 `/system/modules` deferred **0 匹配**。

### 15.4 验收证据与下一阶段

- `pnpm smoke:w364-invoice` 全绿，覆盖 module form/User View/tab、14 项工商抬头 config、CUSTOM 审核、approved options、invoice CRUD/update/snapshot、合同详情/客户 360、Import/Export、旧 issue 路由退出、引用检查与清理，输出 `W3.6.4 invoice direct smoke passed`。
- 根级 `pnpm typecheck`、`pnpm lint`、`pnpm build` 全绿。
- 5.2C 到此关闭。5.2D 只处理 **invoice 审批 runtime**：解除 `runtimeReady=false`、接入通用 `approval-resource push/revoke`、CREATE/UPDATE/DELETE execute timing、`approved` 历史事实位、UPDATE rollback snapshot 与审批状态同步。
- 旧 `/contracts/invoices` URL、legacy Prisma 模型/表和 `InvoiceStatus(PENDING/ISSUED/VOID)` 的物理删除仍严格留在 5.2E。


## 16. 5.2D invoice 审批 runtime 实施结果

### 16.1 统一审批引擎接入

- shared `ApprovalModule` 已加入 `invoice`，`FORM_TYPE_TO_MODULE / MODULE_TO_FORM_TYPE` 完成 `invoice <-> ApprovalFormType.INVOICE` 映射。
- `ApprovalFlowConfigService` 不再把 invoice 标为 `runtimeReady=false`，也不再禁止启用；invoice 与 quotation/contract 一样允许 CREATE / UPDATE / DELETE 三种 execute timing，订单仍保持既有 CREATE-only 边界。
- 审批流程配置 UI 已移除“发票仅配置底座”警告和禁用开关，发票可真实配置三执行时机；高级审批设置仍保持既有未接入限制，不因 5.2D 伪造能力。

### 16.2 发票审批状态、事实位与 rollback

- `ApprovalsService.targetInfo()` 已直接读取 `contract_invoice`；审批引擎内部 PENDING/REJECTED 与业务 `APPROVING/UNAPPROVED` 做统一转换，撤回落 `REVOKED`。
- `setBizStatus(invoice)` 只在 APPROVED 时把 `approved=true`；UPDATE 后续驳回或撤回只改变当前 `approvalStatus`，不会清理“曾审批通过”的历史事实。
- invoice snapshot 的 `approvalStatus/approved` 会随审批状态同步。
- UPDATE 命中流程前调用 `captureBusinessSnapshot(invoice)`，保存 direct 字段、Field/Blob 与业务 snapshot；驳回/撤回时恢复编辑前数据，同时保留当前审批状态和历史 `approved`。
- 发票 UPDATE 写 snapshot 时改为先删除旧 snapshot 再创建当前 snapshot，与 Cordys “当前表单/值快照”语义一致。

### 16.3 CREATE / DELETE / batch delete 与 approval-resource

- ADD 命中 CREATE 流程后自动创建统一审批实例并进入 `APPROVING`。
- DELETE 命中流程时不直接删发票；审批通过后 `effectApproved()` 才删除 `contract_invoice`，驳回/撤回时资源保留。
- batch delete 已按 Cordys `batchDeleteTriggerApproval` 源码语义拆分：命中 DELETE 流程的 id 逐个进入审批，未命中的 id 才直接删除，不再整批 `deleteMany`。
- 新增 Cordys 兼容路径 `/approval-resource/push`、`/approval-resource/revoke`、`/approval-resource/simple-detail/:resourceId`、`/approval-resource/detail/:resourceId` 的 invoice 分支；所有入口先经过 direct invoice DataScope/权限检查，再进入统一审批引擎。
- ADD/UPDATE 的额度保护仍以同合同 `APPROVED + APPROVING` 合计占用，因此审批中的发票真实占用可开票额度。

### 16.4 验收证据

- 新增 `apps/api/scripts/w364-invoice-approval-smoke.ts` 与根/API `smoke:w364-invoice-approval` 脚本入口。Smoke 会保存并临时停用既有 invoice 审批流、清理 `W364D_` 测试数据、执行测试后恢复原流程配置，避免污染开发库。
- `pnpm smoke:w364-invoice-approval`：CREATE 自动提审、APPROVING 额度占用、CREATE 驳回后 `/approval-resource/push` 重提、APPROVED + approved、UPDATE 驳回 rollback、UPDATE revoke rollback、DELETE 审批后删除、batch delete 审批分流全部通过，输出 `W3.6.4 invoice approval smoke passed`。
- `pnpm smoke:w364-invoice` 复跑通过，证明普通 direct API/工商抬头/Import/Export 链路未被审批接入破坏。
- Rules `114/114`，根级 `pnpm typecheck`、`pnpm lint`、`pnpm build` 全绿。
- 根 `pnpm smoke` 同步删除 W2.5 “invoice runtime 未接入”旧断言，改为验证 invoice runtimeReady 与三执行时机可启用，最终 **224/224**。
- runtime gating 扫描 `runtimeReady: formType !== 'invoice'` 与“发票审批业务链路尚未接入”均为 0 匹配。

5.2D 到此关闭。5.2E 继续负责旧 `/contracts/invoices` 兼容 URL、legacy Prisma `InvoiceRecord/InvoiceTitle`、`InvoiceStatus(PENDING/ISSUED/VOID)` 与旧表的物理退出，以及 migration/upgrade/API/approval 最终专项验收。

## 17. 5.2E legacy 发票链物理退出与最终验收

### 17.1 运行时与类型清理

- 删除旧 `ContractsController`、`InvoicesService`、`dto/invoice.dto.ts`，不再注册 `/contracts/invoices*` 与 `/contracts/invoice-titles*`。
- 删除 shared `InvoiceStatus(PENDING/ISSUED/VOID)`、`INVOICE_STATUS_LABELS`、`InvoiceVO`、`InvoiceTitleVO`；保留仍由 direct UI 使用的发票类型展示常量，不再保留第二套业务状态。
- Prisma schema 删除 legacy `InvoiceRecord / InvoiceTitle / InvoiceStatus` 及 Contract 的旧 relation；合同汇总改为读取 `contractInvoices` 并按 direct `APPROVED` 事实统计。
- Dashboard“新建发票”迁到 `businessTitleApi.options + contractInvoiceApi.create`；根 Smoke 交易链同步改用 `/contract/business-title/add + /invoice/add`，不再依赖兼容 URL。

### 17.2 第 51 个 forward migration

- 新增并执行 `20260830094000_w364_drop_legacy_invoice_tables`：先删除 `invoice_records`，再删除 `invoice_titles`。
- deploy 前 direct `business_title / contract_invoice / contract_invoice_snapshot = 1/1/1`；deploy 后仍为 `1/1/1`，证明 drop legacy 表未影响 direct 数据。
- PostgreSQL `to_regclass('public.invoice_records')` 与 `to_regclass('public.invoice_titles')` 均返回 `null`。
- 当前 migration 总数为 **51**。

### 17.3 最终验收

- `pnpm smoke:w364-invoice`：全绿，legacy issue URL 现在明确验证 404。
- `pnpm smoke:w364-invoice-approval`：全绿，CREATE/UPDATE/DELETE/batch-delete/rollback/approved/APPROVING 额度占用无回归。
- 根 `pnpm smoke`：direct 工商抬头 + direct invoice 夹具、旧合同发票/抬头 URL 404 均通过，最终 **227/227**。
- Rules：**114/114**；根级 `pnpm typecheck`、`pnpm lint`、`pnpm build` 全绿。
- `pnpm smoke:w345-empty-db`：隔离空库从零应用全部 **51 migrations**，Seed 连续两次幂等，旧表删除审计、隔离 API/Web 启动均通过。
- runtime 扫描范围 `apps/api/src + prisma/schema.prisma + seed + apps/web/src + packages/shared/src` 中，`InvoiceStatus / InvoiceVO / InvoiceTitleVO / InvoicesService / invoiceRecord / invoiceTitle / /contracts/invoices / /contracts/invoice-titles / invoice:manage / invoiceTitle:manage` **0 匹配**。
- `/system/modules` 合同卡片复查：工商抬头 required 使用真实 drawer，发票表单进入 `/system/modules/fields?module=invoice`，均无 deferred；`git diff --check` 通过。

5.2A～5.2E 到此全部关闭，W3.6.4 发票 direct model 与审批运行时不存在 legacy 第二真相源。下一步进入 5.3 页面、通知/到期任务对齐；5.5 仍保留最终专项验收与提交。

## 18. 5.3 独立页面、审批结果通知与到期任务源码证据

### 18.1 独立发票页面

Cordys `frontend/packages/web/src/router/routes/modules/contract.ts` 注册 `contractInvoice` 子路由，页面为 `views/contract/invoice/index.vue`，读取权限为 `CONTRACT_INVOICE:READ`。这证明合同详情里的发票 Tab 不能替代独立发票页面。

`views/contract/invoice/components/invoiceTable.vue` 已确认独立列表具备：新建、Import、Export all/selected、Saved View、高级筛选、审批状态筛选、动态表单列、批量删除，以及 `edit / delete / review / revoke` 行操作；发票名称、合同、客户、工商抬头都可打开对应详情。合同详情内复用同一表格，但 `isContractTab=true` 时会隐藏独立 Saved View/Import 并固定 contractId。

`views/contract/invoice/components/detail.vue` 使用 `CrmApprovalDetail + INVOICE_SNAPSHOT` 展示审批详情与快照，并按权限/审批状态提供 edit/delete/review/revoke；审批节点字段权限允许时还能在审批详情中保存允许修改的字段。

### 18.2 独立工商抬头页面

Cordys 同一路由文件注册 `contractBusinessName -> views/contract/businessTitle/index.vue`，读取权限为 `CONTRACT_BUSINESS_TITLE:READ`。`businessTitleTable.vue` 具备新增、Import、Export all/selected、keyword/advanced filter、详情/编辑、approval/revoke，以及删除前 `invoice-check` 保护。

因此 MicroMatrix 5.3C 需要把当前仅用于发票创建和 `/system/modules` required 设置的工商抬头能力提升为真实独立业务页面。

### 18.3 `INVOICE_APPROVAL` 是真实审批结束通知

Cordys `ApprovalActionService.sendFinishNotice()` 只在审批最终状态为 `APPROVED` 或 `UNAPPROVED` 时发送结果通知。`FormKey.INVOICE` 明确映射：module=`CONTRACT`、event=`INVOICE_APPROVAL`、recipient=`instance.submitterId`。`message_task.json`、`NotificationConstants` 和 1.7.0 DML 也都真实包含该事件。

MicroMatrix 的 35 事件目录与审批运行时现已统一：`ApprovalsService.approvalResultEvent()` 已映射 `invoice -> INVOICE_APPROVAL`，审批结束由 BusinessNotifications 发给提交人，不再退回通用通知。

### 18.4 Cordys 没有 invoice expiry

Cordys `NoticeExpireJob.onEvent()` 只处理报价、合同、回款计划的 expiring/expired。源码没有 `ContractInvoice` 数据源、invoice 到期字段或 invoice expiring/expired 事件。

所以 5.3D 的正确对齐是保持 MicroMatrix `MessageExpiryService` 只处理报价、合同、回款计划，并通过测试锁定“不新增发票到期分支”，不能发明新的 invoice 日期字段或到期事件。

### 18.5 5.3 缺口矩阵

| 能力 | Cordys | MicroMatrix 5.2E 后 | 5.3 |
| --- | --- | --- | --- |
| 独立发票页 | REAL | 仅合同详情/客户360/首页快捷创建 | 5.3B |
| 发票 Saved View/高级筛选 | REAL | API 已有，独立 UI 缺失 | 5.3B |
| 发票 review/revoke/edit/delete UI | REAL | runtime 已有，独立 UI 缺失 | 5.3B |
| 发票 Import/Export UI | REAL | API 已有，独立 UI 缺失 | 5.3B |
| 独立工商抬头页 | REAL | 辅助 API/弹窗为主 | 5.3C |
| 工商抬头 Import/Export | REAL | 尚未形成独立闭环 | 5.3C |
| `INVOICE_APPROVAL` | REAL | 目录存在但审批结束未触发业务事件 | 5.3D |
| invoice expiry | 不存在 | 不存在 | 保持不新增 |

5.3A 源码审计到此关闭。实现顺序：5.3B 独立发票页 → 5.3C 独立工商抬头页 → 5.3D 通知与专项回归。

### 18.6 5.3 最终实施与验收

- 5.3B 独立发票页已落到 `/contract/contractInvoice`，复用 direct invoice/User View/Import/Export/approval-resource，不建立第二套发票 API。
- 5.3C 独立工商抬头页已落到 `/contract/contractBusinessName`，支持筛选、新增/编辑/详情、approval/revoke、invoice-check 删除保护与 Import/Export。
- `invoice -> INVOICE_APPROVAL` 已接入统一审批结果业务消息，并由 Rules 验证真实 BusinessNotifications 调用与提交人收件人语义。
- 合同/客户 invoice statistic 已按审批流是否启用决定 `APPROVED-only / all`；开票额度保护继续独立使用 `APPROVED + APPROVING`。
- `MessageExpiryService` 保持无 invoice 分支，并由测试锁定该源码边界。
- `w364-invoice-browser` 最终 **31/31**，API 5xx=0、Runtime exception=0；Browser 实跑发现并修复 `approvalPush/revoke` 漏传 `formKey: 'invoice'` 的真实 UI 集成缺口，submit → `APPROVING` → revoke 已在浏览器验证。
- `w364-invoice`、`w364-invoice-approval` 最终复跑全绿；Rules **117/117**，根级 typecheck/lint/build 全部 exit 0；根 Smoke **227/227**。
- 空库验收从零应用全部 **51 migrations**、双次 Seed、旧表/关键索引审计及隔离 API/Web 启动均通过。
- 最终 runtime legacy 扫描 0，非测试 runtime 的 invoice expiry 扫描 0；`/system/modules` 合同卡片四项仍为 REAL 且无 `deferred:` 实例；测试结束后 `W364 Browser` 临时 invoice flow 与发票/工商抬头夹具均为 0，用户原有 invoice flow 已恢复。

5.3A～5.3D 到此全部关闭；W3.6.4 下一执行指针为 **5.5 最终专项验收与本地提交**。
