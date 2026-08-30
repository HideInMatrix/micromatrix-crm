# W3.6.6 7.4 `/system/modules` 最终卡片与 Deferred Backlog 验收

## 1. 结论

7.4 已完成。

- `pnpm smoke:w366-system-modules-browser`：**47/47 / exit 0**。
- 更新后的合同模块设置 Browser Smoke：**23/23 / exit 0**。
- W3.6.3 isolated contract HTTP Smoke：PASS / exit 0，并实际验证合同作废/归档通知。
- DB-003 继续引用 W3.6.4 已封版的 `pnpm smoke:w364-invoice-approval` PASS 证据；7.4 未改发票审批 runtime。

## 2. `/system/modules` 最终入口

四张交易链卡片共 15 个入口全部 REAL：

- Opportunity：商机表单、报价表单、商机阶段、关闭规则、失败原因。
- Product：产品表单、价格表表单。
- Contract：合同表单、回款计划表单、回款记录表单、工商抬头必填、发票表单、合同阶段。
- Order：订单表单、订单状态流。

最终 Browser 实际验证 8 个字段路由消费对应 direct metadata，Invoice metadata 可达，Opportunity 3 个 Drawer、Contract 2 个 Drawer、Order stage Drawer 可打开；API 5xx=0、Runtime exception=0。

## 3. DB-001 / DB-002

合同 direct stage 已有 `VOID/作废`、`ARCHIVED/合同完结`，作废原因必填，阶段变更同步 Snapshot/pos/audit。

7.4 补齐最后消息缺口：

- 作废 -> `CONTRACT_VOID` -> 通知标题 `合同已作废`。
- 合同完结 -> `CONTRACT_ARCHIVED` -> 通知标题 `合同已归档`。
- 两者都把 owner/createUser 传给配置收件范围。

W3.6.3 isolated HTTP Smoke 已实际执行上述断言。DB-001、DB-002 均更新为 `VERIFIED`。

## 4. DB-003～005

- DB-003：W3.6.4 direct Invoice CREATE/UPDATE/DELETE approval、Snapshot rollback、延迟删除、`INVOICE_APPROVAL` 已闭环；沿用 W3.6.4 已通过的专项验收 -> `VERIFIED`。
- DB-004：Quote/Contract/Payment/Invoice/Order 均保存真实 `createUser`；报价/合同/回款计划到期及合同作废/归档发送点均传 `createUserId` -> `VERIFIED`。
- DB-005：`ContractPaymentPlan.owner` 已独立用于 CRUD、批改、DataScope、到期通知，不再借合同负责人 -> `VERIFIED`。

## 5. DB-021

W3.6 交易链范围已完成独立 Field/Blob：Opportunity、Product、Price、Quotation、Contract、Payment Plan、Payment Record、Invoice、Order。

本轮再次确认 Contract/Payment/Invoice/Order 对应 10 张 Field/Blob model 全部存在。

但 DB-021 原始范围还包含 FollowUpPlan，当前 `FollowUpPlanField/Blob` 不存在。因此 DB-021 **保持 `IN_PROGRESS`**，剩余缺口只保留 FollowUpPlan；不能为了封板提前标 VERIFIED。

## 6. DB-022

线索/客户此前已完成；本轮四张交易链卡片最终 Browser **47/47**，合同卡补充回归 **23/23**。当前模块设置入口均绑定真实 route/drawer，没有交易链 label-only 占位。

DB-022 更新为 `VERIFIED`。

## 7. Browser / UI 竞态记录

- 旧 W3.6.3 Browser Smoke 仍把 W3.6.4 后已完成的回款/发票入口写成 deferred；本轮改为 REAL，并实际点击合同、回款计划、回款记录、发票字段页与工商抬头/合同阶段 Drawer，最终 **23/23**。
- 复查时发现真实 UI 缺口：`ContractStageSettingsDrawer` 首次打开在特定导航序列下可能只显示回退/流转控件、不加载阶段。后端 `/contract/stage/get` 为 200 且 7 阶段正常；组件改为在 Element Plus Drawer `open` 生命周期执行 `load()`，避免依赖旧 `opened` 时机。
- 总模块 Browser 还暴露 CDP 测试自身的导航竞态：字段页 helper 原先只等 `requestWillBeSent` 就跳下一页，会中断尚未完成的 metadata 请求，失败点会在 contract/price 等模块间漂移。现已改为每页等待对应 metadata **HTTP 200 response** 后再继续，并把 Drawer 验收前置，避免长链路互相污染。
- 修正后 `pnpm smoke:w366-system-modules-browser` 稳定 **47/47 / exit 0**，API 5xx=0、Runtime exception=0。

因此 W3.6.6 **7.4 可以关闭**，进入 7.5 最终封板。
