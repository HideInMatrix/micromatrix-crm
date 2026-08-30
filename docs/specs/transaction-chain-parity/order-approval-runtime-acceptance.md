# W3.6.5 订单审批 runtime 专项验收

> 验收日期：2026-08-30。范围：W3.6.5 task 6.2D。本文确认订单 CREATE/UPDATE/DELETE 三执行时机、direct 业务快照、reject/revoke rollback、`approvalStatus + approved`、统一 `approval-resource` 与 `ORDER_APPROVAL` 业务消息。独立订单页面上的 review/revoke UI 仍严格留在 6.2E。

## 1. Cordys 审批边界

订单审批按 Cordys `OrderService` 的 HitApproval 语义实现：

- ADD：CREATE。
- UPDATE：UPDATE。
- DELETE：DELETE。
- UPDATE DTO 继续保留 `updateType / comment` 兼容字段，但业务真相由统一审批引擎控制。
- 订单主表保留 `approval_status` 与 `approved` 永久事实位。

Cordys `OrderController` 主 API 矩阵没有 order-only `/order/approval`、`/order/batch/approval`、`/order/revoke`，也没有独立 `ORDER:APPROVAL` 权限。本轮实现曾在开发中短暂按合同模式加入这套接口，源码复核后已全部删除；最终运行时只保留自动 HitApproval、统一 `/approval-resource/*` 与 `/approvals/tasks/*`，避免形成第二套审批 API。

## 2. Approval flow runtime gating

原审批配置层对 order 仍保留历史 CREATE-only 门槛。审批专项 Smoke 首次创建 CREATE/UPDATE/DELETE 测试流程时真实返回：

`422 当前业务对象的编辑和删除审批尚未接入`

现已修复：

- `order` 与 quotation/contract/invoice 一样，可选择 CREATE / UPDATE / DELETE 任意有效执行时机组合。
- `validateRunnable()` 不再对 order 只检查 CREATE。
- 测试流程 `runtimeReady=true`，CREATE/UPDATE/DELETE 均可真实启用。
- 尚未实现的高级审批配置仍继续拒绝，不借 6.2D 扩大范围。

## 3. CREATE 审批

`POST /order/add` 的 direct 数据、动态 Field/Blob、产品子表与当前订单 snapshot 在事务内保存完成后，按金额和 CREATE 执行时机判断审批流：

- 未命中流程：保持普通 direct add 行为。
- 命中流程：自动提交统一审批实例，订单进入 `APPROVING`。
- CREATE reject：订单保留，状态转 `UNAPPROVED`，`approved=false`。
- reject 后可通过 `POST /approval-resource/push`、`formKey=order` 重新提交。
- APPROVED：状态转 `APPROVED`，并永久写入 `approved=true`。

专项 Smoke 使用管理员创建、销售主管审批，验证 CREATE reject -> generic push -> approve 全链路。

## 4. UPDATE business snapshot 与 rollback

UPDATE 命中审批流时，在修改订单前调用统一 `captureBusinessSnapshot(user, 'order', id)`，保存：

- direct `sales_order`：number/name/customer/contract/owner/amount/stage/pos。
- `sales_order_field`。
- `sales_order_field_blob`，包含 SUB_PRODUCT 子表行。
- `sales_order_snapshot`。

更新完成后写当前业务 snapshot，再提交 UPDATE 审批。

驳回或撤回时：

1. 恢复审批前 direct 字段。
2. 删除当前 Field/Blob/Snapshot。
3. 恢复审批前 Field/Blob/Snapshot。
4. 保留当前审批结果状态。
5. 保留历史 `approved=true`，不因后续 UPDATE reject/revoke 清零。
6. 再同步 snapshot 中的 `approvalStatus / approved`。

专项 Smoke 实测同时修改：

- `name`
- `amount`
- 动态字段 `orderConsignee`

UPDATE reject 后三项全部恢复，snapshot 同步恢复；随后再次 UPDATE 并通过 `/approval-resource/revoke` 撤回，三项再次恢复，状态为 `REVOKED`，`approved` 仍为 true。

## 5. DELETE 审批

`GET /order/delete/:id` 命中 DELETE 审批流时不立即删除：

- 返回 `pendingApproval=true + approvalId`。
- 资源仍可读取，状态为 `APPROVING`。
- 审批通过后由统一 `effectApproved()` 执行真实 `sales_order` 删除。
- 审批未通过或撤回时没有提前执行物理删除。

专项 Smoke 已验证 DELETE 提交后资源存在，审批通过后 `/order/get/:id` 返回 404。

## 6. approvalStatus / approved / snapshot 同步

统一审批状态写回订单：

- `PENDING -> APPROVING`
- `REJECTED -> UNAPPROVED`
- `APPROVED -> APPROVED`
- `CANCELED -> REVOKED`

只有审批通过会将 `approved` 置为 true；之后 UPDATE 驳回/撤回不会清除这个历史事实位。

每次状态变化同时同步 `sales_order_snapshot.order_value` 中的：

- `approvalStatus`
- `approved`

专项 Smoke 已从 `/order/get/snapshot/:id` 实际读取并验证 APPROVED、UNAPPROVED 两阶段的 snapshot 状态。

## 7. 统一 approval-resource

订单没有新建第二套审批资源协议，复用现有：

- `POST /approval-resource/push`
- `POST /approval-resource/revoke`
- `GET /approval-resource/simple-detail/:resourceId`
- `GET /approval-resource/detail/:resourceId`

`ApprovalResourceBaseDto.formKey` 现支持 `invoice | order`：

- push/revoke 通过 `formKey` 分派。
- order push/revoke 继续使用 Cordys 已有 `ORDER:UPDATE` 业务权限与 direct DataScope，不引入虚构的 `ORDER:APPROVAL`。
- simple-detail/detail 对资源类型进行实际解析；非 NotFound 异常不会被 fallback 吞掉。
- generic controller 已从 invoice-only 命名清理为 `ApprovalResourceController`。

发票仍走原 `ContractInvoiceService` 分支，订单走 `OrdersService` 分支。

## 8. ORDER_APPROVAL 业务消息

统一 `ApprovalsService.approvalResultEvent()`：

- `order -> ORDER_APPROVAL`

审批结束使用 `BusinessNotificationsService.send()`，收件人为审批提交人，并排除当前操作人。

订单专项 Smoke 使用：

- 提交人：`admin@demo.com`
- 审批人：`zhangwei@demo.com`

审批通过后从管理员 `/notifications` 中实际读取到本次唯一订单对应的：

- title：`审批已通过`
- content：包含本次订单名称

从而确认不是同一人审批导致的 `excludeSelf` 空验证。`ORDER_APPROVAL` 在 35 事件目录中默认 `systemEnabled=true`。

## 9. 专项 Smoke

新增：

`pnpm smoke:w365-order-approval`

最终结果：**PASS / exit 0**。

覆盖：

1. order 审批流程 runtimeReady 与 CREATE/UPDATE/DELETE 三执行时机。
2. CREATE 自动提审。
3. generic simple-detail/detail。
4. CREATE reject -> generic push -> approve。
5. `approved` 永久事实位。
6. `ORDER_APPROVAL` 提交人业务消息。
7. UPDATE direct 字段 + metadata 字段 reject rollback。
8. UPDATE snapshot rollback 与审批状态同步。
9. UPDATE generic revoke rollback。
10. DELETE pending -> approve -> 物理删除。
11. finally 临时停用测试 flow、清理夹具并恢复原 order 审批流程配置。

## 10. 回归矩阵

6.2D 关闭前最终结果：

- `pnpm smoke:w365-order-approval`：**PASS**。
- `pnpm smoke:w365-order`：**PASS**。
- `pnpm smoke:w365-order-stage`：**PASS**。
- `pnpm smoke:w364-invoice-approval`：**PASS**，确认通用 `approval-resource` invoice 分支未回归。
- W3.6.3 合同隔离 HTTP Smoke：**PASS / exit 0**。
  - 临时库 `w363_contract_api_2c85436628`。
  - 本阶段当时为 **54/54 migrations + Seed**；W3.6.5 6.4 最终验收已完成 **56/56 migrations + Seed** 空库复放。
  - CREATE/UPDATE/DELETE approval、revoke rollback、batch approval 全绿。
- API Rules：**117/117 PASS**。
- `pnpm --filter @micromatrix/api typecheck`：**exit 0**。
- `pnpm --filter @micromatrix/api build`：最终源码边界清理后再次执行，**exit 0**。

## 11. 结论与下一边界

W3.6.5 **6.2D 已关闭**。订单 CREATE/UPDATE/DELETE 审批、业务快照与回滚、`approved` 永久事实位、统一 approval-resource 和 `ORDER_APPROVAL` 通知均已形成真实 runtime 闭环。

下一执行指针为 **6.2E：独立订单页面 + 客户/合同关联消费 + legacy exit**。页面 review/revoke、approval status popover 等 UI 只在 6.2E 落地；6.2D 不提前标记页面能力完成。
