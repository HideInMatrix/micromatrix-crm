# W3.6.5 订单源码与 DDL 证据矩阵

> 审计日期：2026-08-30。范围：W3.6.5 task 6.1。目标是先确定 CordysCRM 订单的真实数据模型、API、状态流、审批、页面和模块设置边界，再实施 MicroMatrix 订单直表迁移；本阶段不以当前 `/orders` 简化实现作为目标契约。

## 1. 结论摘要

Cordys 订单不是一个带固定 `status` 枚举的简化 CRUD，而是一套与合同同级的直表业务模块：

- 主表：`sales_order`。
- 动态字段：`sales_order_field` / `sales_order_field_blob`，包含子表实例字段 `ref_sub_id / row_id / biz_id`。
- 审批/表单冻结快照：`sales_order_snapshot`。
- 订单阶段：`sales_order_stage_config`。
- 高级阶段流转：复用 `stage_advanced_config`，`module_type=order`。
- 独立页面：`/order/index`，权限体系使用 `ORDER:*`。
- CREATE / UPDATE / DELETE 三种执行时机都接统一审批运行时；审批结束发送 `ORDER_APPROVAL`。
- 订单阶段不是代码硬编码枚举；阶段、回退、顺序、NORMAL/ADVANCED 流转和字段条件均是配置。
- 产品明细是订单动态表单中的 `SUB_PRODUCT` 子表字段，不存在一套 Cordys 专属 `order_items` 业务表。

因此 MicroMatrix W3.6.5 必须像 W3.6.3/W3.6.4 一样完成 direct model、metadata、approval、stage、page 和 legacy exit，不能继续扩展当前 `orders + OrderStatus + customData JSON` 兼容实现。

## 1.1 当前实施进度

截至 2026-08-30，6.2A 已完成并具备当前库升级证据：

- Prisma 已切到 `sales_order + sales_order_field/blob + sales_order_snapshot + sales_order_stage_config` direct 模型，固定 `OrderStatus` 已从 Prisma schema 删除。
- 第 52 个 migration `20260830113000_w365_order_direct_models` 已在 `default` 成功 deploy，当前 Prisma migration 总数为 52。
- 旧 `orders` 中 1 条开发数据成功 1:1 升级，原 id/number/customer/contract/owner/amount 保留；旧 `PENDING` 映射到“待发货”。
- 当前组织默认阶段实库为 7/7，顺序与 Cordys DML 一致；旧 `orders` 表已物理退出，`sales_order` 为唯一订单主表。
- order metadata、Seed、Customer 360 订单分支、成员负责人引用检查已经开始迁到 direct 字段；API typecheck 和 API production build 已恢复全绿。
- 6.2B 正在进行：`/order/*` Controller、direct page/detail/snapshot/batch/tab/statistic/sort、DataScope、Saved View、Field/Blob 已落地；Import/Export、完整 HTTP Smoke 尚未关闭，因此 6.2B 仍保持未完成。

## 2. 权威源码入口

### 2.1 后端

- `backend/crm/src/main/java/cn/cordys/crm/order/controller/OrderController.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/controller/OrderStageController.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/controller/OrderUserViewController.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/service/OrderService.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/service/OrderStageService.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/service/OrderExportService.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/domain/Order.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/domain/OrderStageConfig.java`
- `backend/crm/src/main/java/cn/cordys/crm/order/domain/OrderSnapshot.java`
- `backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalActionService.java`
- `backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalResourceService.java`
- `backend/crm/src/main/java/cn/cordys/crm/system/service/StageAdvancedConfigService.java`

### 2.2 DDL / DML / 表单

- `backend/crm/src/main/resources/migration/1.6.0/ddl/V1.6.0_2__ga_ddl.sql`
- `backend/crm/src/main/resources/migration/1.6.0/dml/V1.6.0_2_1__data.sql`
- `backend/crm/src/main/resources/migration/1.7.0/ddl/V1.7.0_2__ga_ddl.sql`
- `backend/crm/src/main/resources/migration/1.7.2/ddl/V1.7.2_2__ga_ddl.sql`
- `backend/crm/src/main/resources/migration/1.7.0/dml/V1.7.0_2_1__data.sql`
- `backend/crm/src/main/resources/form/field.json`

### 2.3 前端

- `frontend/packages/web/src/router/routes/modules/order.ts`
- `frontend/packages/web/src/views/order/order/index.vue`
- `frontend/packages/web/src/views/order/order/components/orderTable.vue`
- `frontend/packages/web/src/views/order/order/components/detail.vue`
- `frontend/packages/web/src/views/system/module/components/configCard.vue`
- `frontend/packages/web/src/views/system/module/components/order/orderFormDrawer.vue`

## 3. Cordys 当前订单 DDL

### 3.1 `sales_order`

1.6.0 初始字段：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `id` | varchar(32) | 主键 |
| `number` | varchar(50) | 订单编号 |
| `name` | varchar(255) | 订单名称 |
| `customer_id` | varchar(32) | 客户 |
| `contract_id` | varchar(32) | 合同，可为空 |
| `owner` | varchar(32) | 负责人 |
| `amount` | decimal(20,10) | 订单金额 |
| `stage` | varchar(50) | 当前订单阶段 |
| `organization_id` | varchar(32) | 租户/组织 |
| `create_time/update_time` | bigint | 毫秒时间戳 |
| `create_user/update_user` | varchar(32) | 创建/更新人 |

索引：`customer_id / contract_id / owner / name`。

后续演进：

- 1.7.0：增加 `pos BIGINT`，用于订单看板同阶段排序。
- 1.7.0：增加 `approval_status VARCHAR(50) NOT NULL`。
- 1.7.2：增加 `approved TINYINT(1) DEFAULT 0`，表示“曾经审批通过”的事实位。

最终主表目标字段因此是：`id/number/name/customerId/contractId/owner/amount/stage/approvalStatus/approved/pos/organizationId/audit`。

### 3.2 `sales_order_field` / `sales_order_field_blob`

两表均包含：

- `resource_id`
- `field_id`
- `field_value`
- `ref_sub_id`
- `row_id`
- `biz_id`

其中后三项是动态子表字段实例的关键。订单“产品明细”使用这里的子表语义，不应该落成另一套固定 `OrderItem` 聚合。

### 3.3 `sales_order_snapshot`

字段：`id / order_id / order_prop / order_value`。

`OrderService.add/update/updateStage` 会创建或同步快照；审批详情和字段冻结必须消费这套真实快照语义，不能继续只靠当前订单 JSON。

### 3.4 `sales_order_stage_config`

初始字段：

- `id`
- `name`
- `type`
- `afoot_roll_back`
- `end_roll_back`
- `pos`
- `organization_id`
- audit fields

1.7.2 增加：

- `circulation_type VARCHAR(50) DEFAULT 'NORMAL'`

注意：`circulation_type` 属于 **阶段配置**，不属于 `sales_order` 主表。

### 3.5 `stage_advanced_config`

订单和合同共用：

- `origin_id`
- `target_id`
- `enable`
- `field_config`
- `module_type`，订单为 `order`
- `organization_id`
- audit fields

因此订单状态流必须复用现有通用阶段高级配置模型/服务，不能另建 Order-only advanced table。

## 4. 默认订单阶段与真实流转模型

1.6.0 DML 默认种子为：

| 顺序 | ID | 名称 | type |
| ---: | --- | --- | --- |
| 1 | `CREATE` | 新建 | `AFOOT` |
| 2 | `PENDING_SHIPMENT` | 待发货 | `AFOOT` |
| 3 | `PARTIALLY_SHIPPED` | 部分发货 | `AFOOT` |
| 4 | `SHIPPED` | 已发货 | `AFOOT` |
| 5 | `PENDING_ACCEPTANCE` | 待验收 | `AFOOT` |
| 6 | `COMPLETED` | 已完成 | `END` |
| 7 | `VOIDED` | 已作废 | `END` |

默认 `afoot_roll_back=true`、`end_roll_back=false`。

`OrderStageController` 暴露真实模块设置 API：

- `GET /order/stage/get`
- `POST /order/stage/add`
- `GET /order/stage/delete/{id}`
- `POST /order/stage/update-rollback`
- `POST /order/stage/update`
- `POST /order/stage/sort`
- `GET /order/stage/circulation-type/{type}`
- `POST /order/stage/advanced/config`

业务订单的 `POST /order/update/stage` 会调用 `StageAdvancedConfigService.checkStage(origin,target,order)`；允许流转后才写新 `stage`，并同步允许变更的字段和订单快照。

因此当前 MicroMatrix `OrderStatus(PENDING/DELIVERING/ACCEPTED/COMPLETED/CANCELED)` + `ORDER_STATUS_FLOW` 必须退出，不能与 Cordys 阶段并存。

## 5. Cordys 订单主 API 矩阵

`OrderController` 的真实 namespace 是 `/order`：

| API | 权限/用途 |
| --- | --- |
| `GET /order/module/form` | `ORDER:READ`，表单配置 |
| `POST /order/add` | `ORDER:ADD` |
| `POST /order/update` | `ORDER:UPDATE` |
| `POST /order/update/stage` | `ORDER:UPDATE` |
| `POST /order/batch/update` | `ORDER:UPDATE` |
| `GET /order/delete/{id}` | `ORDER:DELETE`，带审批检查 |
| `GET /order/get/{id}` | `ORDER:READ` |
| `GET /order/get/snapshot/{id}` | `ORDER:READ` |
| `GET /order/module/form/snapshot/{id}` | `ORDER:READ` |
| `POST /order/page` | `ORDER:READ` + DataScope + Saved View/Condition |
| `GET /order/tab` | `ORDER:READ` |
| `GET /order/download/{id}` | `ORDER:DOWNLOAD` |
| `POST /order/statistic` | `ORDER:READ` |
| `POST /order/sort` | 看板拖拽排序 |
| `POST /order/export-select` | `ORDER:EXPORT` |
| `POST /order/export-all` | `ORDER:EXPORT` |
| `GET /order/template/download` | `ORDER:IMPORT` |
| `POST /order/import/pre-check` | `ORDER:IMPORT` |
| `POST /order/import` | `ORDER:IMPORT` |

此外 Cordys 有独立 `OrderUserViewController`，resourceType/formKey 为 `ORDER/order`。MicroMatrix 应继续使用已经形成的 direct User View 模式，而不是为订单保留旧 GET query contract。

## 6. 表单与产品明细

`form/field.json` 的订单默认表单包含：

- 订单编号 `orderNo`：`SERIAL_NUMBER`，默认规则 `XSDD-yyyyMM-6`，不可手输。
- 关联客户 `orderCustomer`：`CUSTOMER` 数据源，required。
- 关联合同 `orderContract`：`CONTRACT` 数据源，可为空。
- 订单名称 `orderName`：required + unique。
- 负责人 `orderOwner`：MEMBER + required。
- 产品明细 `orderProducts`：`SUB_PRODUCT`。
  - 产品名称 `orderProduct`
  - 产品单价 `orderProductPrice`
  - 数量 `orderProductNumber`
  - 金额 `orderProductAmount` formula
- 订单金额 `orderAmount`：formula + required。
- 收货地址 `orderDeliveryAddress`。
- 收货人 `orderConsignee`。
- 收货人联系方式 `orderPhone`。

`BusinessModuleField` 将 direct 主字段映射到 `name/customerId/contractId/owner/number/amount`；其余业务字段和产品子表继续由 metadata field/blob 体系承载。

`OrderService` 在快照中明确处理产品子表字段，进一步证明产品明细属于动态表单，不是另一套固定明细表。

## 7. 审批与消息

Cordys `OrderService`：

- ADD：`@HitApproval(... CREATE ...)`。
- UPDATE：`@HitApproval(... UPDATE ...)`，包含 updateType/comment，保留不可编辑的 number/create/stage/approvalStatus，并生成新快照。
- DELETE：`@HitApproval(... DELETE ...)`。

因此订单审批必须支持 CREATE / UPDATE / DELETE 三执行时机，而不是当前 MicroMatrix 对 order 的 CREATE-only 特例。

订单主表有：

- `approval_status`
- `approved` 永久事实位

审批结束通知：`ApprovalActionService` 将 `ORDER` 映射为：

- module：`ORDER`
- event：`ORDER_APPROVAL`
- recipient：审批提交人

MicroMatrix 35 事件目录和 `ApprovalsService.approvalResultEvent()` 已经存在 `ORDER_APPROVAL` 基础映射，但 6.2 仍需把 direct order snapshot/rollback/status 与统一 approval-resource 运行时真正闭环。

## 8. 独立页面能力

Cordys 路由：

- parent：`/order`
- page：`/order/index`
- permission：`ORDER:READ`

`orderTable.vue` 已确认独立页具备：

- Create：`ORDER:ADD`
- Import：`ORDER:IMPORT`
- Export all / selected：`ORDER:EXPORT`
- Saved View
- keyword / advanced filter / dynamic columns
- 表格 / billboard 看板切换
- 看板 stage 拖拽与排序
- batch edit：`ORDER:UPDATE`
- edit / delete / review / revoke
- approval status popover
- detail drawer
- 合同详情和客户 360 复用同一 OrderTable，但会按 Tab 场景隐藏独立页能力
- 合同转订单使用 `CONTRACT_TO_ORDER` link scenario

因此 MicroMatrix 当前 `/orders` 简化页必须升级为与 Cordys 相同的独立订单业务页；不能只在现页补几个按钮。

## 9. `/system/modules` 真实边界

Cordys `configCard.vue` 对订单明确提供：

1. `newForm` -> 订单表单 Drawer，`FormDesignKeyEnum.ORDER`。
2. `orderStateFlow` -> 通用状态流 Drawer，`FormDesignKeyEnum.ORDER`。

当前 MicroMatrix `NavigationModulesView.vue`：

- `订单表单设置` 已有 `/system/modules/fields?module=order` 路径，但当前 order metadata 仍基于旧模型，需要随 6.2 direct model 真正对齐。
- `订单状态流设置` 只有 label，没有 path/drawer，是明确的 PLACEHOLDER/MISSING。

6.3 关闭条件必须是两项都 REAL，不能只把按钮做成可点击的空壳。

## 10. 当前 MicroMatrix 差距

当前 Prisma `Order` 仍是旧模型：

- 表名 `orders`
- `tenantId`
- `code`
- `name`
- required `contractId`
- `amount decimal(14,2)`
- `status OrderStatus`
- `approvalStatus`
- `deliveredAt / acceptedAt / remark`
- `ownerId / deptId`
- `customData Json`
- DateTime audit

当前 API 是 `/orders` REST 风格，只提供 list/create/update/changeStatus/delete；缺失 direct `/order/*` 的 module form、snapshot、page/tab/statistic/sort、batch edit、User View、Import/Export 等完整契约。

当前业务还存在以下 Cordys 不兼容点：

- 合同当前是 required；Cordys `contract_id` 可空，独立创建订单成立。
- 客户当前从 contract 间接推导；Cordys `customer_id` 是订单 direct 字段且表单 required。
- 当前 `code` 与 Cordys `number`/SERIAL_NUMBER 语义不一致。
- 当前固定 `OrderStatus` 与 Cordys可配置 stage 冲突。
- 当前 `deliveredAt/acceptedAt/remark` 不是 Cordys direct 主表字段。
- 当前 `customData Json` 与 `sales_order_field/blob` 不一致。
- 当前没有 `approved/pos/snapshot`。
- 当前审批配置代码对 order 保留 CREATE-only 特例；Cordys 是 CREATE/UPDATE/DELETE。
- 当前 `/system/modules` 的订单状态流是占位项。

## 11. 迁移原则

6.2 实现遵循以下硬边界：

1. 新建 direct `sales_order` 对应 Prisma model，并迁移可映射旧数据。
2. 新建/复用 `sales_order_field/blob/snapshot/stage_config` 对应模型；字段/blob 必须支持现有 metadata 的子表实例列。
3. 复用通用 `stage_advanced_config`，不复制 advanced flow 引擎。
4. 将 order 纳入现有 `ResourceFieldValueService` direct field/blob 体系，退出 `customData Json`。
5. 将审批运行时扩展为 order CREATE/UPDATE/DELETE + snapshot rollback + approved 永久事实位。
6. 新 `/order/*` 形成稳定契约后，删除旧 `/orders` Controller/DTO/Service 路径及 `OrderStatus/ORDER_STATUS_FLOW`，不长期双轨。
7. 客户 360、合同详情、首页/统计等所有 order 消费方迁移到 direct model。
8. `/system/modules` 订单表单和状态流都达到 REAL 后才能关闭 6.3。

## 12. W3.6.5 实施拆分

### 6.2A Direct schema + migration/data upgrade

- `sales_order` direct model。
- `sales_order_field/blob/snapshot/stage_config`。
- 复用 `stage_advanced_config`。
- 旧 `orders` 数据做可验证升级；无法等价的旧固定状态映射到默认 Cordys stage，并在 migration 文档中明确规则。
- 补齐默认 7 阶段与 order module form seed。

### 6.2B Direct API + DataScope + metadata + I/O

- `/order/module/form`
- `/order/add|update|delete|get|get/snapshot|module/form/snapshot`
- `/order/page|tab|statistic|sort|batch/update`
- `/order/view/*`
- Import template/precheck/import
- Export all/select
- direct field/blob/subtable、serial number、customer/contract/member refs。

### 6.2C Stage runtime + `/system/modules` backend

- `/order/stage/*` CRUD/sort/rollback。
- NORMAL/ADVANCED circulation。
- `stage_advanced_config` 字段条件。
- 业务 `/order/update/stage`、billboard pos。
- stageHasData 删除保护。

### 6.2D Approval + snapshot + notification

- CREATE / UPDATE / DELETE 三执行时机。
- direct order snapshot。
- reject/revoke rollback。
- `approvalStatus` + `approved` 永久事实位。
- `ORDER_APPROVAL` BusinessNotifications 真实验收。
- approval detail/simple-detail 与页面 review/revoke。

### 6.2E Independent page + relation consumers + legacy exit

- `/order/index` 独立页：Saved View、高级筛选、动态列、table/billboard、CRUD、batch edit、review/revoke、Import/Export。
- 客户 360 / 合同详情复用 direct OrderTable 语义。
- 合同转订单 link scenario 按 Cordys 表单字段映射落地。
- 首页/统计/成员引用检查迁到 direct order。
- 删除 `/orders` 旧 API、固定 `OrderStatus/ORDER_STATUS_FLOW`、旧 `customData` 运行时。

### 6.3 `/system/modules` 订单模块关闭条件

- 订单表单设置：REAL direct metadata。
- 订单状态流设置：REAL Drawer + stage CRUD/sort/rollback + advanced circulation。
- 无 placeholder/deferred。

### 6.4 最终专项验收与提交

- order direct API Smoke。
- order approval Smoke。
- order stage/module-settings Smoke。
- Browser Smoke：独立页 + billboard + review/revoke + system/modules。
- 根 Smoke、Rules、typecheck/lint/build。
- migration deploy + isolated empty DB replay/seed/idempotency。
- legacy runtime scan = 0；`/system/modules` placeholder/deferred = 0。
- 文档封版后本地 commit，不自动 push。

## 13. 6.1 结论

W3.6.5 订单的目标边界已由 Cordys 源码和 DDL 固定。下一执行指针是 **6.2A Direct schema + migration/data upgrade**；在 direct schema 稳定前，不继续扩展当前 `/orders` 旧运行时。
