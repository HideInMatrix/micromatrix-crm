# W3.6.4 回款与发票最终专项验收

> 封版日期：2026-08-30。范围：W3.6.4 task 5.1～5.5。目标是把合同后的回款计划、回款记录、发票、工商抬头及其审批/通知/系统模块能力按 Cordys direct 模型收口，并彻底退出旧 receivable/invoice 运行时。

## 1. 源码证据与实施范围

- 回款源码/API/DDL 证据：[payment-source-api-audit.md](./payment-source-api-audit.md)。
- 发票 direct model、审批 runtime、legacy 退出证据：[invoice-source-approval-audit.md](./invoice-source-approval-audit.md)。
- 独立发票/工商抬头页面、通知与无 invoice expiry 边界：[invoice-page-notification-audit.md](./invoice-page-notification-audit.md)。

本阶段最终落地：

- `contract_payment_plan + field/blob` 与 `contract_payment_record + field/blob` direct 模型和真实 API。
- `business_title + business_title_config`、`contract_invoice + field/blob + snapshot` direct 模型和真实 API。
- 回款计划/回款记录合同详情与客户 360 消费 direct 数据，旧 `receivable_*` 运行时物理退出。
- 发票 CREATE/UPDATE/DELETE 审批执行时机、提审/撤回、UPDATE rollback、DELETE 审批后删除、`approved` 历史事实位。
- 独立 `/contract/contractInvoice` 与 `/contract/contractBusinessName` 页面。
- `INVOICE_APPROVAL` 审批完成业务消息；保持 Cordys 无 invoice expiry 的真实边界。
- `/system/modules` 合同卡片中的回款计划表单、回款记录表单、工商抬头必填、发票表单全部 REAL。

## 2. Migration 与 legacy 退出

W3.6.4 新增 4 个 migration：

1. `20260829220000_w364_contract_payment_direct_models`
2. `20260829223000_w364_drop_legacy_receivables`
3. `20260829231000_w364_invoice_direct_models`
4. `20260830094000_w364_drop_legacy_invoice_tables`

最终隔离空库验收：

- Prisma 共 **51 migrations**，从零全部成功应用。
- Seed 连续执行两次保持幂等。
- 目标 direct 表、关键索引、Seed 样例与旧表删除审计通过。
- 隔离 API/Web 使用空库启动通过。
- `receivable_plans / receivable_records / invoice_records / invoice_titles` 不再作为运行时表存在。

## 3. 专项 Smoke

- `pnpm smoke:w364-contract-payment`：通过。
- `pnpm smoke:w364-invoice`：通过。
- `pnpm smoke:w364-invoice-approval`：通过。
- `pnpm smoke:w364-invoice-browser`：**31/31**。
  - 发票独立路由、module form、Saved View、scope tab、Import/Export、详情/新建均通过。
  - 页面真实提交审批后后端进入 `APPROVING`，撤回成功。
  - 工商抬头独立路由、module form、真实 page、Import/Export、详情/新建、invoice-check 删除保护均通过。
  - API 5xx = **0**，Runtime exception = **0**。
  - Browser 实跑发现并修复 `approvalPush/revoke` 漏传 `formKey: 'invoice'` 导致 400 的真实页面集成缺口。
  - Smoke 增加历史 `W364 Browser` 夹具自清理；最终临时审批流/发票/工商抬头残留 **0/0/0**。

## 4. 全局回归

- 根 `pnpm smoke`：**227/227**。
- API Rules：**117/117**。
  - 包含 `invoice -> INVOICE_APPROVAL` 映射。
  - 包含审批结束真实调用 BusinessNotifications 并通知提交人的测试。
  - 包含 `MessageExpiryService` 严格保持 Cordys 六个到期事件、无 invoice expiry 分支的测试。
- `pnpm typecheck`：exit 0。
- `pnpm lint`：exit 0。
- `pnpm build`：exit 0。
- `pnpm smoke:w345-empty-db`：exit 0，覆盖全部 **51 migrations**、双次 Seed、旧表/索引审计、隔离 API/Web 启动。
- `git diff --check`：通过。

## 5. 最终静态与模块审计

最终 runtime 扫描结果：

- `InvoiceStatus / InvoiceVO / InvoiceTitleVO / InvoicesService / invoiceRecord / invoiceTitle / 旧 /contracts invoice routes / 旧 invoice 权限`：**0 匹配**。
- invoice expiry runtime：**0 匹配**；不新增 Cordys 不存在的发票到期字段、cron 或事件。
- `deferred:`：**0 匹配**。

`/system/modules` 合同卡片最终保持：

- 回款计划表单设置：REAL。
- 回款记录表单设置：REAL。
- 工商抬头表单必填设置：REAL。
- 发票表单设置：REAL。

提交前变更集合审计没有发现订单/W3.6.5 命名文件被纳入本阶段；下一阶段订单仍从 task 6.1 开始，不在 W3.6.4 中提前实现。

## 6. 结论

W3.6.4 task 5.1～5.4 的实现、专项测试、全局回归、migration/空库回放、legacy 清理和 `/system/modules` 回查全部满足关闭条件。task 5.5 在本次本地提交完成后关闭；本阶段不执行远端 push。

