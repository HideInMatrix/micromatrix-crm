# W3.6.4 5.3 发票页面、通知与任务源码证据

> 审计日期：2026-08-30。范围：W3.6.4 task 5.3。5.2 已完成 direct model、审批 runtime、legacy 物理退出；本阶段只对齐 Cordys 独立发票页面、关联详情、审批通知与真实任务边界。

## 1. 独立发票页面

Cordys 源码入口：`frontend/packages/web/src/views/contract/invoice/index.vue`、`components/invoiceTable.vue`、`components/detail.vue`。

`index.vue` 证明发票是独立页面，不只是合同详情 Tab，并可打开合同详情、客户/公海客户、工商抬头详情 Drawer。

`invoiceTable.vue` 已确认：

- 新建：`CONTRACT_INVOICE:ADD`；导入：`CONTRACT_INVOICE:IMPORT`（独立页）；导出：`CONTRACT_INVOICE:EXPORT`；批删：`CONTRACT_INVOICE:DELETE`。
- Saved View、关键词、高级筛选、列配置。
- 行操作按审批状态动态计算 `edit / review / revoke / delete`。
- `approvalStatus` 使用审批 Popover；合同名称和工商抬头名称可进入关联详情。

因此 MicroMatrix 必须提供真实独立 invoice route/view，不能继续只依赖 `ContractDetailDrawer`。

## 2. API 与审批边界

页面继续消费 5.2 已完成的 `/invoice/*`、`/invoice/view/*`、Import/Export 与 `/approval-resource/push|revoke|simple-detail|detail`。不新增 invoice-only 第二套审批 API。

## 3. 审批通知

Cordys `ApprovalActionService` 在审批结果 APPROVED / UNAPPROVED 时分发：QUOTATION -> `BUSINESS_QUOTATION_APPROVAL`，CONTRACT -> `CONTRACT_APPROVAL`，ORDER -> `ORDER_APPROVAL`，**INVOICE -> `INVOICE_APPROVAL` 且 Module.CONTRACT**。

MicroMatrix 已将 `invoice -> INVOICE_APPROVAL` 接入 `ApprovalsService.approvalResultEvent()`，审批最终结果通过统一 BusinessNotifications channel gate 发送给提交人；Rules 既验证事件映射，也验证真实 `sendApprovalResult()` 调用参数。

## 4. 无发票到期任务

Cordys `contract_invoice` 没有到期时间 direct 字段；全仓搜索 `invoice expiry / 发票到期 / INVOICE_EXPIRED / INVOICE_EXPIRING` 无匹配。因此 5.3 **不新增 invoice expiry cron、expiry 字段或 expiry 事件**；所谓“通知/到期任务”回查结论就是发票域不存在该能力。

## 5. 统计口径

Cordys `calculateCustomerInvoiceAmount / calculateContractInvoiceAmount`：`DictModule.INVOICE_APPROVAL` 启用时只统计 APPROVED，未启用时统计全部。ADD/UPDATE 的额度占用仍独立使用 `APPROVED + APPROVING`。

MicroMatrix 已以本项目真实 invoice approval flow 启用状态实现等价统计，不新增第二套开关表：合同和客户 360 均在审批启用时只累计 `APPROVED`，审批关闭时累计全部；额度占用仍保持 `APPROVED + APPROVING`。

## 6. 最终实施与验收

- 已按 Cordys 合同域子路由注册 `/contract/contractInvoice`，`InvoicesView.vue` 已接 direct `/invoice/*`、Saved View、筛选、新建/编辑/详情、review/revoke、批删与 Import/Export。
- 已注册 `/contract/contractBusinessName`，`BusinessTitlesView.vue` 已接 module form、筛选、新增/编辑/详情、approval/revoke、invoice-check 删除保护与 Import/Export。
- `invoice -> INVOICE_APPROVAL` 已真实接入 BusinessNotifications；合同与客户 360 invoice statistic 已按审批流启用状态切换 `APPROVED-only / all`。
- `MessageExpiryService` 继续只处理报价、合同、回款计划 6 个到期事件，并由测试锁定“不增加 invoice expiry 分支”。

最终验证：

- Rules **117/117**。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 全绿。
- `pnpm smoke:w364-invoice`、`pnpm smoke:w364-invoice-approval` 全绿。
- `pnpm smoke:w364-invoice-browser` **31/31**；API 5xx=0、Runtime exception=0。Browser Smoke 实际发现并修复 `contractInvoiceApi.approvalPush/revoke` 漏传 `formKey: 'invoice'` 导致独立页审批操作 400 的真实缺口，最终已验证 submit → `APPROVING` → revoke。
- 根 `pnpm smoke` **227/227**。
- `pnpm smoke:w345-empty-db` 从零应用全部 **51 migrations**，双次 Seed、旧表/关键索引审计与隔离 API/Web 启动全部通过。
- 最终 runtime legacy 扫描为 0；非测试 runtime 的 invoice expiry 扫描为 0；`/system/modules` 合同卡片回款计划、回款记录、工商抬头 required、发票 form 均保持 REAL，`deferred:` 实例为 0。
- Browser/API 夹具清理后，`W364 Browser` 临时 invoice approval flow、发票和工商抬头均为 0；用户原有 invoice flow 会在 Smoke 结束后恢复。

W3.6.4 task **5.3A～5.3D 到此全部关闭**。下一步只保留 5.5 的 W3.6.4 最终专项验收与本地提交。

