# W3.6.2 报价源码、DDL 与 API 证据矩阵

> 状态：`SOURCE_AUDITED`
>
> 本文只记录 CordysCRM 源码已经能够直接证明的报价事实，用于约束 W3.6.2 实现；不以 MicroMatrix 现有 Quote 结构反推目标模型。

## 1. 源码范围

### 1.1 Cordys 后端

- `backend/crm/src/main/java/cn/cordys/crm/opportunity/controller/OpportunityQuotationController.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/controller/OpportunityQuotationUserViewController.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/service/OpportunityQuotationService.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/service/OpportunityQuotationFieldService.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/domain/OpportunityQuotation.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/domain/OpportunityQuotationField.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/domain/OpportunityQuotationFieldBlob.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/domain/OpportunityQuotationSnapshot.java`
- `backend/crm/src/main/java/cn/cordys/crm/opportunity/mapper/ExtOpportunityQuotationMapper.xml`
- `backend/crm/src/main/java/cn/cordys/common/constants/BusinessModuleField.java`
- `backend/crm/src/main/java/cn/cordys/crm/system/service/ModuleFieldService.java`
- `backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalResourceService.java`
- `backend/crm/src/main/java/cn/cordys/crm/system/job/NoticeExpireJob.java`

### 1.2 Cordys 前端

- `frontend/packages/web/src/views/opportunity/quotation.vue`
- `frontend/packages/web/src/views/opportunity/components/quotation/quotationTable.vue`
- `frontend/packages/web/src/views/opportunity/components/quotation/detail.vue`
- `frontend/packages/web/src/views/opportunity/components/quotation/approvalModal.vue`
- `frontend/packages/web/src/views/opportunity/components/quotation/exportQuotationPdf.vue`
- `frontend/packages/lib-shared/api/modules/opportunity.ts`
- `frontend/packages/lib-shared/api/requrls/opportunity.ts`
- `frontend/packages/web/src/views/system/module/components/configCard.vue`
- `frontend/packages/web/src/views/system/module/components/opportunity/optQuotationFormDrawer.vue`

### 1.3 DDL

- `migration/1.4.0/ddl/V1.4.0_2__ga_ddl.sql`
- `migration/1.4.2/ddl/V1.4.2_2__ga_ddl.sql`
- `migration/1.4.2/dml/V1.4.2_2_1__data.sql`
- `migration/1.5.0/dml/V1.5.0_2_2__modify_tel.sql`
- `migration/1.5.0/ddl/V1.5.0_3__modify_sub_key.sql`
- `migration/1.5.1/ddl/V1.5.1_3__modify.sql`
- `migration/1.7.0/ddl/V1.7.0_2__ga_ddl.sql`
- `migration/1.7.2/ddl/V1.7.2_2__ga_ddl.sql`

## 2. Cordys 最终直接模型

### 2.1 `opportunity_quotation`

最终业务字段由初始 DDL 与后续 ALTER 共同确定：

| 字段 | 语义 |
| --- | --- |
| `id` | 报价 ID |
| `name` | 报价名称 |
| `opportunity_id` | 关联商机，必填 |
| `until_time` | 有效期至，BIGINT 毫秒 |
| `amount` | 报价累计金额，DECIMAL(14,2) |
| `approval_status` | 通用审批业务状态 |
| `invalid` | 是否作废，0/1 |
| `approved` | 是否曾审批通过 |
| `organization_id` | 组织 ID |
| `create_time/update_time` | BIGINT 毫秒 |
| `create_user/update_user` | 创建/更新用户 |

关键结论：

- Cordys 报价主表没有 `customerId`；客户关系通过 `opportunity_id -> opportunity.customer_id` 得出。
- Cordys 报价主表没有 `ownerId/deptId`；数据范围按 `create_user` 对应组织成员的部门判断。
- Cordys 报价没有 `code`、`status=DRAFT/CONFIRMED/VOID`、`remark`、`customData JSONB` 这些最终字段。
- `invalid` 才是独立作废事实；不能把作废继续编码进自定义 QuoteStatus。

### 2.2 `opportunity_quotation_field` / `opportunity_quotation_field_blob`

两张表都以 `resource_id` 指向报价，Field 为 `VARCHAR(255)`，Blob 为 `TEXT`。

最终还包含：

- `ref_sub_id`
- `row_id`
- `biz_id`

最终唯一 cell 约束为：

`(resource_id, ref_sub_id, row_id, field_id)`

因此报价产品明细不是 `quote_items`，而是报价动态表单里的子表字段值；必须复用与 Price `SUB_PRODUCT` 同类的行实例语义。

### 2.3 `opportunity_quotation_snapshot`

字段：

- `id`
- `quotation_id`
- `quotation_prop`：表单配置快照，后续升级为 LONGTEXT
- `quotation_value`：报价值快照

报价新增、更新和批量编辑都会重建/更新快照。详情提供“当前值”和“快照值”两套读取入口，PDF 使用快照表单和值。

### 2.4 审批表结论

1.4.0 曾建立 `opportunity_quotation_approval`，但 1.7.0 明确 `DROP TABLE opportunity_quotation_approval`。

因此最终实现不得新建或保留一张 Quote 专属审批表作为真相源。报价审批接 Cordys 通用审批链，业务主表只保留 `approval_status / approved / invalid`，审批实例/任务由通用 Approval 域承担。

## 3. 默认报价表单系统字段

`BusinessModuleField` 明确给出四个报价业务主字段：

1. `quotationName -> name`，required
2. `quotationOpportunity -> opportunityId`，required，数据源字段
3. `quotationUntilTime -> untilTime`，required
4. `quotationTotalAmount -> amount`，required

`OpportunityQuotationService` 另外把请求中的 `products` 加入 `moduleFields`，按子表存进 quotation Field/Blob；产品明细不是主表固定列。

## 4. Cordys 报价 API

`OpportunityQuotationController` 的正式契约：

| Method | Path | 语义 |
| --- | --- | --- |
| GET | `/opportunity/quotation/module/form` | 当前报价表单配置 |
| POST | `/opportunity/quotation/page` | 报价分页 |
| POST | `/opportunity/quotation/add` | 新增 |
| POST | `/opportunity/quotation/update` | 更新 |
| GET | `/opportunity/quotation/get/snapshot/{id}` | 快照详情 |
| GET | `/opportunity/quotation/get/{id}` | 当前详情 |
| GET | `/opportunity/quotation/module/form/snapshot/{id}` | 快照表单配置 |
| GET | `/opportunity/quotation/revoke/{id}` | 撤销审批 |
| GET | `/opportunity/quotation/voided/{id}` | 作废 |
| POST | `/opportunity/quotation/batch/voided` | 批量作废 |
| POST | `/opportunity/quotation/approve` | 审批 |
| POST | `/opportunity/quotation/batch/approve` | 批量审批 |
| POST | `/opportunity/quotation/batch/update` | 批量编辑 |
| GET | `/opportunity/quotation/delete/{id}` | 删除 |
| GET | `/opportunity/quotation/tab` | ALL/DEPARTMENT 标签能力 |
| GET | `/opportunity/quotation/download/{id}` | 记录报价下载操作日志 |

前端 `requrls/opportunity.ts` 与 Controller 一一对应，不存在 `/quotes` REST 兼容入口。

## 5. User View

`OpportunityQuotationUserViewController` 独立暴露：

- POST `/opportunity/quotation/view/add`
- POST `/opportunity/quotation/view/update`
- GET `/opportunity/quotation/view/delete/{id}`
- GET `/opportunity/quotation/view/detail/{id}`
- GET `/opportunity/quotation/view/list`
- GET `/opportunity/quotation/view/fixed/{id}`
- POST `/opportunity/quotation/view/edit/pos`
- GET `/opportunity/quotation/view/enable/{id}`

MicroMatrix 已有通用 UserViews 直接模型，W3.6.2 应扩展/映射到 quotation 资源，不再设计第二套报价视图表。

## 6. 核心业务语义

### 6.1 新增

- `name/opportunityId/moduleFields/moduleFormConfigDTO` 由请求提供；untilTime/amount/products 同步写入。
- 默认：`invalid=false`、`approvalStatus=NONE`、`approved=false`。
- 产品列表以 `products` 子表字段写入报价 Field/Blob。
- 新增后立即保存“表单配置快照 + 值快照”。
- CREATE 可以触发通用审批链。

### 6.2 更新

- 保留原 create audit、invalid、approvalStatus。
- 重写当前动态字段和 `products` 子表。
- 删除旧报价快照并按当前表单配置和值重建快照。
- UPDATE 可以触发通用审批；Cordys 支持 `updateType/comment`。

### 6.3 当前详情与快照详情

- 当前详情的主表状态以 `opportunity_quotation` 为准，动态字段读取当前 Field/Blob。
- 快照详情读取 snapshot 的 `quotation_value`。
- snapshot form 读取 `quotation_prop`；没有 snapshot 时退回当前表单配置。

### 6.4 作废

- 作废设置 `invalid=true`，不删除记录。
- 快照同步 `invalid=true`。
- 已被合同动态字段引用的报价不可作废。
- 重复批量作废会进入 skip，不应创建第二套状态。

### 6.5 删除

- 已被合同引用不可删除。
- 删除报价主记录、Field/Blob、Snapshot，并记录操作日志/发送通知。
- 删除可受通用 Approval DELETE 规则约束。

### 6.6 审批

- 最终审批事实属于通用审批系统。
- 报价主表同步 `approval_status`，快照也同步审批状态。
- CREATE / UPDATE / DELETE 都能由 Cordys Approval 规则触发。
- `approved` 表示曾经审批通过过，不等价于当前 `approval_status=APPROVED`。

### 6.7 DataScope

`ExtOpportunityQuotationMapper.list` 的组织隔离是 `organization_id`；部门/本人范围以 `create_user` 对应 `sys_organization_user.department_id` 计算。

因此 MicroMatrix 旧 `ownerId/deptId` Quote Scope 必须删除，不能继续作为报价权限事实。

### 6.8 到期通知

Cordys `NoticeExpireJob` 会按 `until_time` 发送：

- `BUSINESS_QUOTATION_EXPIRING`
- `BUSINESS_QUOTATION_EXPIRED`

W3.6.2 应接入现有 Message Expiry/Business Notification 机制，不另造轮询框架。

## 7. Cordys 页面行为

报价页入口 `views/opportunity/quotation.vue` 使用统一 `quotationTable`。

表格/详情源码明确包含：

- 新建、编辑、删除
- 审批、撤销审批、批量审批
- 作废、批量作废
- 批量编辑
- 当前详情 / 审批详情 / 快照详情
- 报价 PDF 页面
- 关联商机跳转/抽屉
- User View
- ALL/DEPARTMENT tab

PDF 页面使用 `OPPORTUNITY_QUOTATION_SNAPSHOT` 表单和值进行渲染；`/download/{id}` 本身是下载操作日志入口，不是“服务端生成 PDF 文件”的证据。MicroMatrix Web 可以继续用前端 PDF 渲染，只要快照数据和下载日志契约对齐。

## 8. `/system/modules` 回查事实

Cordys 商机卡片包含 `newFormOpportunityQuotation`，打开报价表单设置抽屉。

W3.6.2 关闭前必须确认 MicroMatrix 的“报价表单设置”：

- 真实读取 quotation 表单元数据；
- 字段最终落 `opportunity_quotation` + quotation Field/Blob；
- `products` 使用子表字段模型；
- 不再映射到旧 `quotes.customData/quote_items`。

## 9. MicroMatrix 当前差距

当前 MicroMatrix `Quote` 是旧自定义模型：

- 表：`quotes` + `quote_items`
- 字段：`tenantId/code/customerId/totalAmount/status/validUntil/remark/ownerId/deptId/customData/createdAt`
- API：`/quotes` REST
- 数据范围：owner/dept
- 动态字段：`customData JSONB`

与 Cordys 最终模型在主表、产品子表、DataScope、API、快照和审批语义上均冲突。

## 10. W3.6.2 实施约束

1. 破坏式替换旧 `quotes/quote_items`，迁到 `opportunity_quotation`、`opportunity_quotation_field/blob`、`opportunity_quotation_snapshot`。
2. 不创建 Cordys 已删除的 `opportunity_quotation_approval`。
3. quotation Field/Blob 必须支持 `refSubId/rowId/bizId`，复用 Price 已验证的 SUB_PRODUCT cell 语义。
4. 报价 DataScope 改为 createUser/部门，不保留 ownerId/deptId 兼容。
5. 只暴露 `/opportunity/quotation/*` 与 quotation User View；删除旧 `/quotes` 前后端调用。
6. 审批复用现有 ApprovalFlow/Instance/Task，迁移其 Quote target 访问到新直接模型。
7. Snapshot 必须保存表单配置和值，并随更新、批改、审批状态、作废同步。
8. 合同引用报价的阻断逻辑最终由 W3.6.3 合同直接 Field/Blob 完成；本阶段不得为旧 Contract customData 再加永久兼容层。
9. `/system/modules` 商机卡片“报价表单设置”必须在本阶段回查为 REAL。
