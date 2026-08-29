# W3.6.3 合同源码、DDL 与 API 证据矩阵

> 审计日期：2026-08-29
>
> 目标：修改 MicroMatrix 合同实现前，先锁定 CordysCRM 合同主域真实的数据模型、API、审批/快照、阶段流、交易关联和 `/system/modules` 入口。回款计划、回款记录、发票独立实现留给 W3.6.4，但本阶段先锁定它们与合同删除/详情 Tab 的边界。

## 1. Cordys 源码入口

前端重点：`frontend/packages/lib-shared/api/requrls/contract.ts`、`api/modules/contract.ts`、`enums/contractEnum.ts`、`models/contract.ts`、`views/contract/contract/*`、`views/system/module/components/contract/contractFormFormDrawer.vue`。

后端重点：`ContractController`、`ContractStageController`、`ContractUserViewController`、`ContractService`、`ContractFieldService`、`ContractStageService`、`ContractExportService`、`Contract/ContractField/ContractFieldBlob/ContractSnapshot/ContractStageConfig`、`ExtContractMapper.xml`、`ExtContractStageConfigMapper.xml`。

最终 DDL 演进主要来自 `1.4.0`、`1.4.1`、`1.4.2`、`1.7.0`、`1.7.1`、`1.7.2` migration。

## 2. 最终直接模型

Cordys 最终合同主表不是 MicroMatrix 当前的 `contracts + ContractItem + customData + ContractStatus`，而是：

### `contract`

- `id/name/customer_id/owner/amount/number`
- `approval_status/stage/start_time/end_time/void_reason`
- `organization_id/pos/approved`
- `create_time/update_time/create_user/update_user`

关键结论：负责人是真实主字段 `owner`；DataScope 通过负责人所属部门解析，不冗余 `deptId`；`number` 是合同直接字段；Cordys 没有 `opportunityId/quoteId/signedAt/remark/customData` 合同主表字段；合同阶段保存 `contract_stage_config.id`，不是固定枚举；`approved` 是历史审批通过事实位。

### `contract_field` / `contract_field_blob`

动态字段采用直接 Field/Blob 值表，包含 `resource_id/field_id/field_value/ref_sub_id/row_id/biz_id`。产品信息不是 `ContractItem` 独立表，而是合同表单中的 `products` SUB_TABLE，通过 `refSubId/rowId/bizId` 保存。

### `contract_snapshot`

保存 `contract_id/contract_prop/contract_value`。创建合同时即冻结“表单配置 + 业务值”快照；更新、阶段变化、审批状态变化会同步维护快照。

### `contract_stage_config`

包含 `name/type/afoot_roll_back/end_roll_back/pos/organization_id/circulation_type` 与审计字段。阶段最多 15 个；支持新增、改名、排序、回退配置以及 `NORMAL / ADVANCED` 流转。高级流转关系复用通用 `stage_advanced_config`，`module_type=contract`。

## 3. 合同主 API 契约

主契约：`GET /contract/module/form`、`POST /contract/add`、`POST /contract/update`、`GET /contract/delete/{id}`、`GET /contract/get/{id}`、`GET /contract/get/snapshot/{id}`、`GET /contract/module/form/snapshot/{id}`、`POST /contract/page`、`POST /contract/batch/update`、`POST /contract/update/stage`、`GET /contract/tab`、`POST /contract/statistic`、`POST /contract/sort`、导入/导出/template/chart。

User View 使用独立 `/contract/view/*`：add/update/list/detail/fixed/enable/delete/edit-pos。

合同详情还按权限暴露 `/contract/contract-payment-plan/page`、`/contract/contract-payment-record/page`、`/contract/invoice/page`、`/contract/order/page` 与 `/contract/invoice/statistic/{contractId}`。这些边界本阶段保留，独立 direct model 在 W3.6.4/W3.6.5 实施。

## 4. 创建、更新与审批语义

`ContractAddRequest` 直接字段为 `name/customerId/owner/amount/startTime/endTime/number/moduleFields/moduleFormConfigDTO/products`。

创建时：必须有表单配置；默认阶段取组织阶段列表第一项；`pos` 放在该阶段末尾；`approvalStatus=NONE`；`approved=false`；金额空值为 0 且最大 `9999999999`；`products` 作为 SUB_TABLE 保存；创建结束立即写 `contract_snapshot`；CREATE 使用通用 `@HitApproval`。

Cordys 更新不限制“仅草稿”；UPDATE 使用通用审批执行时机，并在审批前保存业务快照。DELETE 同样使用通用 `@HitApproval`，命中流程时延迟物理删除。UPDATE 驳回/撤回通过 `revertToSnapshot()` 恢复主字段、Field/Blob 与 products。

## 5. 阶段、作废与归档

`POST /contract/update/stage` 不是简单枚举赋值：目标必须是组织真实 stage；ADVANCED 模式先校验源→目标是否允许；流转可同时提交字段值；阶段变化同步 Snapshot；进入 VOID 记录 `voidReason` 并发合同作废通知；进入 ARCHIVED 发送归档通知。

虽然旧 DTO 注释仍列举固定名称，但 1.7.0 后真实持久层和页面使用 `contract_stage_config.id`，实现必须以最终模型为准。

## 6. 删除保护

物理删除前：存在回款记录则拒绝；存在合同发票则拒绝。删除合同同时清理 Field/Blob 与 Snapshot。不能沿用 MicroMatrix 当前“只允许 DRAFT 删除”的旧规则。

## 7. `/system/modules` 关闭门槛

W3.6.3 完成前必须复验合同表单设置与合同阶段为真实功能。回款计划表单、回款记录表单、发票表单、工商抬头必填保持真实依赖，最终 direct model 由 W3.6.4 关闭，不允许用旧 `/contracts` 或 `customData` 做假 REAL。

## 8. MicroMatrix 当前差异

当前 Prisma 仍是固定 `ContractStatus`、`contracts`、`ContractItem`，并包含 `code/opportunityId/quoteId/signedAt/remark/ownerId/deptId/customData`；Controller 使用 `/contracts` REST；编辑/删除限制 DRAFT；没有合同 Field/Blob、Snapshot、StageConfig；审批仅做状态检查。

因此 W3.6.3 采用与 Opportunity/Product/Quotation 相同的破坏式 direct-model 收口，不做双写和长期兼容层。

## 9. 实施拆分

### 4.2A 直接模型与 migration

- 删除 `ContractStatus` 与 `ContractItem` 真相源。
- `Contract` 收口到 Cordys 主字段并映射 `contract`。
- 新增 `ContractField/ContractFieldBlob/ContractSnapshot/ContractStageConfig`。
- 复用通用 `StageAdvancedConfig`。
- 合法旧合同和产品明细迁到 direct + SUB_TABLE；未发布开发字段不保留兼容列。
- forward repair 补合同表单、默认阶段和 products SUB_TABLE 元数据。

### 4.2B 审批、快照、阶段与关联保护

- contract CREATE/UPDATE/DELETE 接通用 Approval。
- UPDATE 驳回/撤回业务回滚，DELETE 延迟执行。
- NORMAL/ADVANCED 阶段、回退、排序、流转字段、VOID/ARCHIVED 通知。
- 回款记录/发票删除保护。

### 4.3 API 与页面

- 删除旧 `/contracts` REST，建立 `/contract/*`、`/contract/view/*`、`/contract/stage/*`。
- 重建列表/看板/详情/批量/阶段/审批/作废/归档/导入导出/深链。

## 10. 4.3 API / 页面落地矩阵

这一节作为 4.3 的实现与验收基线，后续代码和 Smoke 必须逐项对应，不允许用旧 `/contracts` REST 作为主合同兼容层继续存在。

### 10.1 主合同 API

| Cordys API | 方法 | 语义 | MicroMatrix 4.3 落地要求 |
| --- | --- | --- | --- |
| `/contract/module/form` | GET | 当前组织合同表单配置 | 直接复用 ModuleForms，前端新建/编辑先加载 |
| `/contract/add` | POST | 创建合同 | 请求使用 direct 字段 + `moduleFields/moduleFormConfigDTO/products`，CREATE Approval |
| `/contract/update` | POST | 更新合同 | 不限制旧 DRAFT；固定 UPDATE Approval，支持审批任务场景 |
| `/contract/delete/{id}` | GET | 删除合同 | 回款/发票保护；命中 DELETE Approval 时延迟物理删除 |
| `/contract/get/{id}` | GET | 当前合同详情 | 返回 direct VO、动态 Field/Blob、products SUB_TABLE、stage 名称 |
| `/contract/get/snapshot/{id}` | GET | 合同业务快照 | 从 `contract_snapshot.contract_value` 读取冻结业务值 |
| `/contract/module/form/snapshot/{id}` | GET | 合同表单快照 | 从 `contract_snapshot.contract_prop` 读取冻结表单配置 |
| `/contract/page` | POST | 列表 / 阶段看板分页 | 使用 `current/pageSize/viewId/filters/board/stage`，User View + DataScope 一次解析 |
| `/contract/update/stage` | POST | 合同阶段流转 | 使用真实 `contract_stage_config.id`；NORMAL/ADVANCED 校验；流转字段 + voidReason |
| `/contract/batch/update` | POST | 批量字段更新 | 批量权限 + direct/custom field 更新，不回退旧 `customData` 主列 |
| `/contract/approval` | POST | 当前合同审批 | 代理到通用 Approval，保持合同 `approved` 历史事实位 |
| `/contract/batch/approval` | POST | 批量审批 | 返回 success/fail/skip 统计，与报价批量审批语义一致 |
| `/contract/revoke/{id}` | GET | 撤回合同审批 | 通用 Approval cancel；UPDATE 撤回恢复业务快照并保留 `REVOKED` |
| `/contract/tab` | GET | ALL / DEPARTMENT Tab 显隐 | 使用 DataScope 能力，不由前端硬编码 |
| `/contract/statistic` | POST | 合同金额统计 | 与 `viewId/filters` 使用同一过滤条件，至少提供 total/count/amount |
| `/contract/sort` | POST | 阶段看板内拖拽排序 | 更新同阶段 `pos`，跨阶段拖拽必须走 `/update/stage` |

导入/导出/template/chart 属于 Cordys 主合同契约，但 4.3 的关闭标准是先保证运行时主链、Saved View、阶段看板、详情/快照和审批完整；导入/导出沿用现有通用能力时必须使用 direct contract Field/Blob，不能重新引入旧 ContractItem/customData 真相源。

### 10.2 Saved View

Cordys `ContractUserViewController` 使用 `UserViewResourceType.CONTRACT`，完整路由为：

- `POST /contract/view/add`
- `POST /contract/view/update`
- `GET /contract/view/list`
- `GET /contract/view/detail/{id}`
- `GET /contract/view/fixed/{id}`
- `GET /contract/view/enable/{id}`
- `GET /contract/view/delete/{id}`
- `POST /contract/view/edit/pos`

MicroMatrix 通用 UserView 注册必须新增 `contract -> CONTRACT -> contract/view`，列表 `/contract/page` 对 `viewId` 的解析与商机/报价保持一致，不允许 Vue 端自行翻译 Saved View 条件。

### 10.3 阶段 API

阶段设置路由已经按 Cordys 建立：`/contract/stage/get|add|update|delete/:id|sort|update-rollback|circulation-type/:type|advanced/config`。4.3 页面必须直接消费这套组织级配置，不再展示 `DRAFT/EXECUTING/COMPLETED/TERMINATED` 固定枚举。

合同列表支持表格与阶段看板两种展示；阶段列、Tag、操作按钮、作废/归档行为都以 `stage/stageName/type/pos` 为事实源。最多 15 阶段、NORMAL/ADVANCED、回退策略由后端统一校验。

### 10.4 页面与深链

Cordys 前端调用顺序锁定为：表单配置 / Saved View / stage 配置 ready 后，再统一加载 `/contract/page`，避免重复出现报价阶段曾修过的初始化空结果覆盖竞态。

`/contracts?fromQuote=<quotationId>` 仍可作为 MicroMatrix 的前端路由深链，但它只能表示“从已审批且未作废报价预填创建合同”；数据库不得持久化 quoteId/opportunityId。创建提交最终调用 `/contract/add`。

合同详情当前需要保留“合同字段 / products / 附件 / 回款计划 / 回款记录 / 发票 / 订单”的入口边界。其中回款/发票/订单 direct-model 实现分别属于 W3.6.4/W3.6.5；4.3 不允许为了维持旧 Drawer 而继续依赖旧合同主 API。

### 10.5 旧接口清理边界

- `/contracts` 的合同列表、详情、新建、编辑、状态变更、删除全部在 4.3 删除或停止被运行时代码调用。
- `/contracts/*receivable*`、`/contracts/*invoice*`、`/contracts/invoice-titles*` 是 W3.6.4 尚未迁移的临时子域边界，可以短期保留，但 Controller/Service 内不得再读取旧合同字段或 `ContractItem`。
- 4.3 验收扫描必须确认 Web 主合同调用 `/contracts` 为 0；后端旧主合同路由为 0；仅允许上述 W3.6.4 子域临时路由命中。

### 10.6 4.3 验收清单

1. HTTP Smoke：module form、add/page/get/snapshot/update、Saved View、stage、approval/revoke/delete、batch update/approval、tab/statistic/sort。
2. Browser Smoke：表格初始化无竞态、Saved View 切换、创建/编辑、从报价深链、详情、阶段看板拖拽、作废原因、审批状态。
3. DataScope：ALL / DEPARTMENT / SELF 至少三档验证合同 `/page/get/update/delete`。
4. 静态扫描：固定 `ContractStatus`/旧 `row.status`/旧 `row.items`/旧主 `/contracts` 调用清零。
5. 4.3 完成后立刻回查 `/system/modules` 合同表单 + 合同阶段，进入 4.4；不能等 W3.6.3 最后才补模块设置。

### 10.7 4.3 隔离 HTTP 实测记录

2026-08-29 使用 `apps/api/scripts/w363-contract-http-smoke.mjs` 在独立 PostgreSQL 数据库启动真实 API 进程验证，测试库结束后自动删除，不污染 `default`：

- 47/47 migrations 从零复放并执行 Seed。
- `/contract/module/form`、`/contract/add`、`/contract/page`、`/contract/get/:id`、业务/表单 Snapshot、`/contract/update` 全绿。
- `/contract/view/*` CRUD 与 Saved View + ad-hoc filters 求交全绿。
- NORMAL 阶段流转、作废原因、ADVANCED 流转保护全绿。
- `/contract/batch/update`、`/contract/sort`、`/contract/statistic` 全绿。
- ALL / DEPARTMENT / SELF 三档 DataScope 对 `/page/get/update/delete` 的访问边界全绿。
- CREATE / UPDATE / DELETE Approval、UPDATE 撤回快照恢复、批量审批全绿。
- 旧主 `/contracts` REST 404 已验证；W3.6.4 临时回款/发票子域不计入旧主路由残留。

Browser 侧随后使用 `scripts/w363-contract-browser-smoke.mjs` 完成同一契约的真实 UI 验收，最终结果 **56 passed / 0 failed**：

- 首屏在 form / stage / Saved View ready 后只触发 **1 次** `POST /contract/page`，未重现报价模块曾出现的初始化竞态。
- Saved View 切换、direct 创建/编辑、详情 Drawer、业务 Snapshot、表单 Snapshot 全绿。
- 阶段看板真实 drag/drop 通过页面原生 `DataTransfer + DragEvent` 事件链验证 Vue DOM 处理，实际调用 `POST /contract/update/stage` 并持久化真实 `contract_stage_config.id`；列表阶段切换与作废原因同步通过。
- `/contracts?fromQuote=<quotationId>` 在 SPA 深链下读取报价详情、报价 Snapshot、商机客户上下文，预填并成功创建合同；创建后的 ContractVO 不含 `quotationId/opportunityId`，产品进入 direct products SUB_TABLE。
- CREATE 审批合同在列表展示通过/驳回/撤回动作，浏览器实际调用 `POST /contract/approval`，审批后 `approvalStatus=APPROVED` 且 `approved=true`。
- Browser 全程 API 5xx=0、Runtime exception=0。
- 静态扫描：`ContractStatus` 运行时代码 0；合同页 `row.status` / `row.items` 0；Web `/contracts` 仅剩页面路由和 W3.6.4 临时回款/发票/工商抬头子域；旧主 `/contracts` CRUD 已由隔离 HTTP Smoke 验证为 404。

因此 **W3.6.3 task 4.3 正式关闭**。下一步立即进入 4.4 `/system/modules` 合同卡片审计，不允许把合同表单/合同阶段设置拖到 W3.6.3 最后再补。

### 4.4 `/system/modules`

Cordys `configCard.vue` 的合同卡片固定暴露六个入口。四个表单 Drawer 均复用统一 `CrmFormDrawer`，只是 form key 分别为 `CONTRACT / CONTRACT_PAYMENT / CONTRACT_PAYMENT_RECORD / INVOICE`；工商抬头必填使用独立配置 API；合同阶段复用状态流 Drawer。

| 入口 | Cordys 证据 | MicroMatrix 关闭策略 | 状态 |
| --- | --- | --- | --- |
| 合同表单设置 | `ContractFormFormDrawer -> CONTRACT` | `/system/modules/fields?module=contract` 已消费 direct contract metadata | REAL |
| 回款计划表单设置 | `ContractPaymentPlanFormDrawer -> CONTRACT_PAYMENT` | `ReceivablePlan` 仍是旧模型，W3.6.4 direct model + runtime form consumption 后开放 | DEFERRED W3.6.4 |
| 回款记录表单设置 | `ContractPaymentRecordFormDrawer -> CONTRACT_PAYMENT_RECORD` | `ReceivableRecord` 仍是旧模型，W3.6.4 关闭 | DEFERRED W3.6.4 |
| 工商抬头表单必填设置 | `businessTitleValidate.vue`；`GET /business-title/config/get` + `GET /business-title/config/switch/{id}` | 当前 `InvoiceTitle` 仍是旧模型且没有 Cordys config API；随 W3.6.4 direct 化关闭 | DEFERRED W3.6.4 |
| 发票表单设置 | `ContractInvoiceFormDrawer -> INVOICE` | `InvoiceRecord/InvoiceStatus` 仍是旧模型；W3.6.4 direct 化后接 Form Designer | DEFERRED W3.6.4 |
| 合同阶段设置 | `contractStateFlow -> CONTRACT` | `/contract/stage/*` direct backend 已完成；本阶段接 REAL Drawer，覆盖新增/改名/删除/排序、回退、NORMAL/ADVANCED 与高级转移矩阵 | REAL |

MicroMatrix 定点扫描补充证据：当前 API/Web/Prisma 中不存在 `CONTRACT_PAYMENT` / `CONTRACT_PAYMENT_RECORD` direct 表单元数据与运行时消费链；工商抬头仅存在旧 `invoice_titles` CRUD，没有 Cordys `/business-title/config/get|switch/{id}` 必填配置契约；发票仍使用旧 `InvoiceRecord/InvoiceStatus`，且审批配置 UI 对 invoice runtime 仍保持未就绪限制。因此上述四项必须等 W3.6.4 direct model 落地后再转 REAL，不能提前挂一个只会保存配置但业务不读取的假表单设置。

关闭规则：DEFERRED 入口在 `/system/modules` 必须明确说明 W3.6.4 依赖并保持不可执行，不能用“按钮可点击但业务不消费配置”的方式伪装 REAL；W3.6.4 完成对应 direct model 后必须回到同一合同卡片逐项转为 REAL。

### 4.5 验收

- Service/API/Approval/Stage/Browser Smoke。
- 根 Smoke、Rules、typecheck、ESLint、production build。
- 正式库 migrate deploy；隔离空库 migration replay + 双次 Seed。
- `/system/modules` Browser 专项复验。

2026-08-29 最终实测结果：

- direct HTTP Smoke 全绿；隔离库从零 **47/47 migrations**，并覆盖 Saved View、NORMAL/ADVANCED stage、作废、批量、CREATE/UPDATE/DELETE Approval、撤回回滚、ALL/DEPT/SELF DataScope 与旧主 `/contracts` 404。
- 合同业务 Browser **56/56**；`/system/modules` 合同卡片 Browser **14/14**。后者确认合同表单/合同阶段为 REAL，回款计划/记录、工商抬头必填、发票四项均明确 `DEFERRED W3.6.4` 且不可执行。
- 根级 `pnpm smoke` **224/224**；API Rules **114/114**；全仓 typecheck、ESLint、Shared/API/Web production build 全部 exit 0。根 Smoke 中唯一被 direct model 暴露的旧测试契约——历史客户清理按 `contract.tenantId` 查询——已同步改为 `contract.organizationId`。
- 正式 `default` Prisma status 确认 **47 migrations / schema up to date**；migration Smoke：**47/47** replay、Seed **2/2**、direct tables **5/5**、legacy tables **0/2**、默认阶段 **7**。46→47 upgrade Smoke：legacy contract/item **1/1** 成功迁移，products SUB_TABLE cell **4/4**、Snapshot **1/1**、stage **7/7**，旧 `EXECUTING` 映射“履行中”并保留 `approved=true`。
- 手写运行时代码扫描：`ContractStatus=0`、`ContractItem=0`；`ContractsView` 的 `row.status=0`、`row.items=0`、`contractApi.list=0`。旧 `@Controller('contracts')` 仅保留 W3.6.4 的 invoice-title/receivable/invoice 临时子域。

因此 **W3.6.3 合同 4.1～4.5 全部正式关闭**；下一执行指针为 **W3.6.4 task 5.1：回款计划/回款记录源码与最终 DDL 证据矩阵**。
