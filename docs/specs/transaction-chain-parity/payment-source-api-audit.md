# W3.6.4 回款计划 / 回款记录源码、DDL 与 API 证据矩阵

> 审计日期：2026-08-29
>
> 范围：W3.6.4 task 5.1，仅锁定 CordysCRM 回款计划与回款记录的最终直接模型、Field/Blob、API、User View、DataScope、导入导出、统计、合同/客户详情关联和现有 MicroMatrix 差异。发票、工商抬头及其审批留给 5.2，页面/通知与最终模块设置关闭留给 5.3～5.4。

## 1. Cordys 源码入口

### 1.1 回款计划

- 后端：`ContractPaymentPlanController`、`ContractPaymentPlanUserViewController`、`ContractPaymentPlanService`、`ContractPaymentPlanFieldService`、`ContractPaymentPlanExportService`、`ContractPaymentPlanResourceAccessContextProvider`。
- Domain：`ContractPaymentPlan`、`ContractPaymentPlanField`、`ContractPaymentPlanFieldBlob`。
- Mapper：`ExtContractPaymentPlanMapper.java/.xml`。
- DTO：`ContractPaymentPlanAdd/Update/Page/ExportRequest`、`ContractPaymentPlanGet/ListResponse`。
- 状态：`ContractPaymentPlanStatus`。
- 前端：`views/contract/contractPaymentPlan/*`、`lib-shared/api/requrls/contract.ts`、`api/modules/contract.ts`、`system/module/components/contract/contractPaymentPlanFormDrawer.vue`。

### 1.2 回款记录

- 后端：`ContractPaymentRecordController`、`ContractPaymentRecordUserViewController`、`ContractPaymentRecordService`、`ContractPaymentRecordFieldService`、`ContractPaymentRecordExportService`、`ContractPaymentRecordResourceAccessContextProvider`。
- Domain：`ContractPaymentRecord`、`ContractPaymentRecordField`、`ContractPaymentRecordFieldBlob`。
- Mapper：`ExtContractPaymentRecordMapper.java/.xml`。
- DTO：`ContractPaymentRecordAdd/Update/Page/Export/StatisticRequest`、`ContractPaymentRecordGet/Response/StatisticResponse`。
- 前端：`views/contract/contractPaymentRecord/*`、`lib-shared/api/requrls/contract.ts`、`api/modules/contract.ts`、`system/module/components/contract/contractPaymentRecordFormDrawer.vue`。

### 1.3 最终 DDL 演进

- 回款计划主表与 Field/Blob：`migration/1.4.0/ddl/V1.4.0_2__ga_ddl.sql`。
- 1.5.0 为回款计划增加必填 `name`；同版本创建回款记录主表与 Field/Blob。
- `migration/1.5.1/ddl/V1.5.1_4__record_del.sql` 从回款记录主表删除 `record_bank / record_bank_no`。
- 默认表单字段来自 `backend/crm/src/main/resources/form/field.json`。

## 2. 回款计划最终直接模型

Cordys 最终持久层为：

### `contract_payment_plan`

- `id`
- `name`
- `contract_id`
- `owner`
- `plan_status`
- `plan_amount`
- `plan_end_time`
- `organization_id`
- `create_time / update_time / create_user / update_user`

索引至少覆盖 `contract_id / create_time / owner`。

### `contract_payment_plan_field` / `contract_payment_plan_field_blob`

动态字段分别使用 `VARCHAR(255)` 与 `TEXT` 值表，核心列为 `id/resource_id/field_id/field_value`。因此 MicroMatrix 不得继续使用 `remark`、`period` 等固定列模拟可配置表单字段。

### 默认表单直接字段

`field.json` 与 `BusinessModuleField` 双向确认：

| 页面字段 | internalKey | 直接字段 | 类型 | 规则 |
| --- | --- | --- | --- | --- |
| 回款计划名称 | `contractPaymentPlanName` | `name` | INPUT | required |
| 合同 | `contractPaymentPlanContract` | `contractId` | DATA_SOURCE(CONTRACT) | required |
| 负责人 | `contractPaymentPlanOwner` | `owner` | MEMBER | required，默认当前用户 |
| 计划回款金额 | `contractPaymentPlanPlanAmount` | `planAmount` | INPUT_NUMBER | required |
| 计划回款时间 | `contractPaymentPlanPlanEndTime` | `planEndTime` | DATE_TIME(date) | required |

`planStatus` 是主表直接业务字段，但不在上述可拖拽表单字段集中。前端列表直接提供状态编辑；Service 创建时未传则默认 `PENDING`。

## 3. 回款计划状态语义

Cordys 只定义三种状态：

- `PENDING`：待处理
- `PARTIALLY_COMPLETED`：部分完成
- `COMPLETED`：已完成

源码扫描 `setPlanStatus` 只发现创建/导入默认 `PENDING` 与更新 DTO 的显式写入，没有发现“根据回款记录金额自动重算状态”的业务逻辑。因此实现必须把 `planStatus` 当作**直接持久化且可编辑**的业务字段，不得继续沿用 MicroMatrix 当前 `PAID / PARTIAL / OVERDUE / PENDING` 的运行时自动计算真相源。

到期提醒由 `planEndTime` + 定时消息链判断；“已逾期”不是回款计划主表状态枚举。

## 4. 回款计划 API / User View / DataScope

### 主 API：`/contract/payment-plan/*`

- `GET /module/form`
- `POST /page`
- `GET /get/{id}`
- `POST /add`
- `POST /update`
- `GET /delete/{id}`
- `GET /tab`
- `POST /export-select`
- `POST /export-all`
- `GET /template/download`
- `POST /import/pre-check`
- `POST /import`

前端 requrls 还声明 `/contract/payment-plan/chart`；若后续实现图表，必须以实际 Controller/Service 证据为准，不能只因为 requrls 常量存在就标记 REAL。

### User View：`/contract/payment-plan/view/*`

资源类型为 `CONTRACT_PAYMENT_PLAN`，真实接口：`add/update/delete/detail/list/fixed/edit-pos/enable`。

### DataScope

`page` 先解析动态字段条件，再通过 `DataScopeService.getDeptDataPermission(..., viewId, CONTRACT_PAYMENT_PLAN_READ)` 得到范围。Mapper 以 `owner` 关联用户部门：

- SELF：`cpp.owner = currentUser`
- DEPARTMENT：负责人所属部门在允许部门集合
- 其它带部门范围视图同时允许部门范围或本人
- 所有查询固定 `cpp.organization_id = orgId`

列表额外支持 `contractId / customerId / keyword(name)`，并求交 filters、combineSearch、viewCombineSearch 与排序。

### 跨域入口

- 合同详情：`POST /contract/contract-payment-plan/page`
- 客户 360：`POST /account/contract/payment-plan/page`
- 客户统计：`GET /account/contract/payment-plan/statistic/{accountId}`，当前统计口径为计划金额合计。
- 通知：回款计划新增/删除，以及 `CONTRACT_PAYMENT_EXPIRING / CONTRACT_PAYMENT_EXPIRED` 到期消息链。

## 5. 回款计划 Service 规则

- ADD：owner 空值时回退当前用户；planStatus 空值时默认 `PENDING`；写 audit/org/id；保存 Field/Blob 后写主表并记录操作日志。
- UPDATE：更新直接字段；`moduleFields == null` 时不改动态字段，否则替换 Field/Blob；支持 agent update 分支。
- GET：返回合同名、owner/部门、动态字段、optionMap 和附件映射。
- DELETE：当前 Cordys Service 直接删除主记录并记录资源名，所读源码中**没有“存在回款记录则禁止删除”判断**。MicroMatrix 现有该限制不能凭旧实现继续保留；若后续发现数据库约束或其它 Service 有保护，再按证据补入。
- Import/Export：完整支持 ADD/UPDATE 导入、导入预检、模板下载、选中/全部导出和动态字段。

## 6. 回款记录最终直接模型

### `contract_payment_record`

最终主表字段：

- `id`
- `name`
- `no`
- `owner`
- `contract_id`
- `payment_plan_id`（可空）
- `record_amount`
- `record_end_time`
- `organization_id`
- `create_time / update_time / create_user / update_user`

索引覆盖 `contract_id / payment_plan_id / owner`。

### `contract_payment_record_field` / `contract_payment_record_field_blob`

和回款计划一致使用独立 Field/Blob 值表。

### 1.5.1 银行字段迁移事实

1.5.0 初始主表曾存在 `record_bank / record_bank_no`，1.5.1 明确 `DROP COLUMN`。但最终 `field.json` 仍包含：

- `contractPaymentRecordBank`：收款银行 SELECT
- `contractPaymentRecordBankNo`：收款银行账号 SELECT

且全后端源码中这两个 internalKey 只出现在 `field.json`，没有 `BusinessModuleField` 直接字段映射。因此最终语义是：**银行/账号仍可作为默认动态表单字段存在，但不能重新加回回款记录主表。**

## 7. 回款记录默认直接字段

| 页面字段 | internalKey | 直接字段 | 类型 | 规则 |
| --- | --- | --- | --- | --- |
| 回款记录名称 | `contractPaymentRecordName` | `name` | INPUT | required |
| 回款编码 | `contractPaymentRecordNo` | `no` | SERIAL_NUMBER | required、不可编辑 |
| 合同名称 | `contractPaymentRecordContract` | `contractId` | DATA_SOURCE(CONTRACT) | required |
| 回款计划 | `contractPaymentRecordPlan` | `paymentPlanId` | DATA_SOURCE(PAYMENT_PLAN) | optional |
| 负责人 | `contractPaymentRecordOwner` | `owner` | MEMBER | required、默认当前用户 |
| 回款时间 | `contractPaymentRecordEndTime` | `recordEndTime` | DATE_TIME(date) | required |
| 回款金额 | `contractPaymentRecordAmount` | `recordAmount` | INPUT_NUMBER | required、precision 2 |

默认序列号规则：`PAY-yyyyMM-6位序号`（`["PAY", "-", "yyyyMM", "-", "6"]`）。导入 ADD 也会读取该 SERIAL_NUMBER 字段配置生成 `no`；UPDATE 明确保留旧 `no`，不允许通过请求任意改号。

## 8. 回款记录 API / User View / DataScope

### 主 API：`/contract/payment-record/*`

- `GET /module/form`
- `POST /page`
- `POST /add`
- `POST /update`
- `GET /delete/{id}`
- `GET /get/{id}`
- `GET /tab`
- `GET /template/download`
- `POST /import/pre-check`
- `POST /import`
- `POST /export-select`
- `POST /export-all`
- `POST /statistic`

### User View：`/contract/payment-record/view/*`

资源类型为 `CONTRACT_PAYMENT_RECORD`，同样包含 `add/update/delete/detail/list/fixed/edit-pos/enable`。

### DataScope / filter

与回款计划同样按 `owner` 解析 SELF/部门数据范围，强制 `organization_id`，并支持 `contractId/customerId/keyword(name)` + Saved View + 动态 filters + sort。

### 跨域入口

- 合同详情：`POST /contract/contract-payment-record/page`
- 客户 360 / timeline：回款记录列表与统计。
- 客户统计 Mapper：合同总额 `totalAmount`、已回款 `receivedAmount`、待回款 `pendingAmount = contract amount - received amount`。

## 9. 回款记录 Service 规则

- ADD/UPDATE 均调用 `checkContractPaymentAmount()`。
- 当前真实实现只校验：`recordAmount > 0` 且 `contractId` 对应合同存在。
- 虽然方法注释写“校验回款金额是否超出”，源码创建了记录查询条件，但**没有执行累计回款金额与合同金额比较**。因此不得凭注释推测并新增“累计回款不得超过合同金额”规则。
- `paymentPlanId` 可选；详情会补回款计划名称/option。
- UPDATE 强制保留旧 `no`。
- DELETE 只要求记录存在，删除主记录 + Field/Blob 并写日志；没有通用 Approval，也没有旧 MicroMatrix `approvalStatus=PENDING` 删除保护。
- Import/Export、User View、Tab、Statistic 均为真实功能。

## 10. MicroMatrix 实施结果

5.1 已按本证据矩阵完成 direct 迁移，迁移前差异全部关闭：

- Prisma 现以 `ContractPaymentPlan / ContractPaymentPlanField / ContractPaymentPlanFieldBlob` 与 `ContractPaymentRecord / ContractPaymentRecordField / ContractPaymentRecordFieldBlob` 为唯一回款真相源。
- `20260829220000_w364_contract_payment_direct_models` 将旧有效回款数据升级到 direct 表；`20260829223000_w364_drop_legacy_receivables` 随后删除 `receivable_records / receivable_plans`，不保留双写或兼容读。
- 计划运行时不再使用 `period / PAID / PARTIAL / OVERDUE / dueDate`；状态直接持久化为 `PENDING / PARTIALLY_COMPLETED / COMPLETED`。
- 记录运行时不再使用 `method / remark / approvalStatus / deptId` 主表语义；银行与账号仅作为动态 Field 存储，`no` 使用服务端 `PAY-yyyyMM-6` 生成器，更新与导入不能覆盖已有编号。
- Seed 已补齐 `CONTRACT_PAYMENT_PLAN:* / CONTRACT_PAYMENT_RECORD:*` 权限，旧 `receivable:manage` 兼容权限已删除。
- User View 已注册 `CONTRACT_PAYMENT_PLAN / CONTRACT_PAYMENT_RECORD`，并由对应 `/contract/payment-*/view/*` 路由真实提供。
- `/system/modules` 中回款计划、回款记录表单入口已由 deferred 切为 REAL，分别对应 `contractPaymentPlan / contractPaymentRecord` metadata；工商抬头与发票仍按 5.2～5.4 独立关闭。
- 合同详情、客户 360、到期提醒均已消费 direct model；客户 360 内部资源 key/VO 也已统一改为 `contractPaymentPlans / contractPaymentRecords`，运行时不再保留 `receivable*` 兼容命名。

## 11. 旧数据迁移边界

以下是 MicroMatrix → Cordys direct model 的实施决策边界，不伪装成 Cordys 源码事实：

### 计划

- 保留合法旧 `id/contractId/tenantId/amount/dueDate/createdAt/updatedAt`。
- `tenantId -> organizationId`；`amount -> planAmount`；`dueDate -> planEndTime(epoch ms)`。
- Cordys 要求 `name`，而旧模型只有 `period`。迁移旧开发数据时可使用稳定可读的 `第 N 期回款计划` 作为一次性兼容名称；新业务不再持久化 `period`。
- `period/remark` 不保留为主表列。若需保留 remark，必须作为真实动态字段迁入 Field/Blob，不能新增 Cordys 不存在的列。
- 旧状态没有持久化且枚举不兼容。Migration 应基于现有合法回款数据一次性得到 `PENDING / PARTIALLY_COMPLETED / COMPLETED`，或在没有足够事实时安全初始化 `PENDING`；实现时用升级 Smoke 锁定选择，之后状态作为直接字段，不再自动重算。

### 记录

- `tenantId -> organizationId`；`planId -> paymentPlanId`；`amount -> recordAmount`；`receivedAt -> recordEndTime(epoch ms)`；`ownerId -> owner`。
- Cordys 要求 name，新旧数据迁移需生成稳定名称；新记录由表单直接录入名称。
- `method/remark` 不能继续作为主表列；如决定保留历史值，必须映射为真实动态字段。
- `approvalStatus/deptId` 不迁为主表字段；部门继续由 owner 实时解析。
- `no` 对迁移旧记录可生成稳定不冲突编号；新记录按 `PAY-yyyyMM-6` 规则生成。

## 12. 5.1 实施关闭条件

5.1 不是“只建两张表”即可完成，关闭必须包含：

1. direct Prisma + plan/record Field/Blob + forward migration/旧数据升级。
2. `ResourceFieldValueService` 与 metadata FormKey/默认字段/序列号真实接入。
3. `/contract/payment-plan/*` 与 `/contract/payment-record/*` 主 API。
4. 两套 User View + DataScope + filters/sort/tab/statistic。
5. Import/Export/模板与操作日志不丢失。
6. 合同详情/客户 360 读取 direct plan/record；旧 `/contracts/receivable-*` 兼容子域退出主调用链。
7. 回款计划到期提醒切 `planEndTime/planStatus` direct model。
8. 专项 migration/upgrade/API Smoke + typecheck；回款计划/记录 `/system/modules` 入口随 5.1 已 REAL，工商抬头/发票页面和模块设置继续由 5.2～5.4 最终关闭。

## 13. 明确禁止的兼容做法

- 不保留 `ReceivablePlan/ReceivableRecord` 双写作为第二真相源。
- 不把 `period/OVERDUE/PAID/PARTIAL` 留在新 plan 业务模型。
- 不把 `approvalStatus/method/remark/deptId` 留在 record 主表。
- 不把 `record_bank/record_bank_no` 重新加回 direct 主表；银行相关默认值只能走动态 Field/Blob。
- 不凭方法注释增加累计回款上限规则。
- 不把 W3.6.3 的 deferred `/system/modules` 按钮提前改成“看似可点击但无 direct runtime”的假 REAL。

## 14. 5.1 收尾验收记录

2026-08-29 最终收尾验证结果：

- 当前 migration 总数为 49；`pnpm smoke:w345-empty-db` 在隔离 PostgreSQL 空库从零应用全部 migrations，并完成 Seed 连续两次幂等、目标直表/旧表删除审计、隔离 API/Web 启动，命令 exit 0。
- `pnpm smoke:w364-contract-payment` 在最新 build API 上通过，覆盖：
  - plan/record module form 与两套 User View；
  - 客户 360 plan/record page + statistic；
  - plan CRUD、owner 默认、显式 planStatus、batch update；
  - record CRUD、`PAY-yyyyMM-6` 自动编号、UPDATE 不可改号、动态银行字段与 batch update；
  - record statistic；
  - plan/record 模板、Import pre-check、Import、Export all；
  - 旧 `/contracts/:id/receivable-plans` 与 `/contracts/:id/receivable-records` 为 404；
  - Smoke 启动时仅清理自身 `W364 Smoke/Imported` 命名空间的历史残留，本轮结束后残留 plan/record 均为 0。
- 根级 `pnpm smoke` 中原有交易链夹具已从旧 `/contracts/receivable-*` 改为 direct `/contract/payment-plan/add`、`/contract/payment-record/add`；最终 **224/224**，合同汇总与客户 360 plan/record 两个历史断言全部恢复通过。
- 全仓 `pnpm typecheck` 通过：shared build/typecheck、API Prisma generate + tsc、Web vue-tsc 均无错误。
- 全仓 `pnpm lint` 通过，0 warning / 0 error。
- 全仓 `pnpm build` 通过，shared/API/Web production build 全绿。
- Rules 回归在本轮 direct 迁移期间完成 114/114；其中到期提醒测试 mock 已同步切到 `contractPaymentPlan`。
- 最终运行时代码扫描 `apps/api/src + apps/web/src + packages/shared/src + prisma/schema.prisma`：`receivablePlan / receivableRecord / ReceivablePlan / ReceivableRecord / RECEIVABLE_PLAN_STATUS_LABELS / RECEIVABLE_METHODS / /receivable-plans / /receivable-records / receivable:manage` 均为 0。旧表名只允许存在于历史 migration 与本次升级证据文档中。
