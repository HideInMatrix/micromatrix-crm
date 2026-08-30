# W3.6.6 全交易链最终验收计划

## 1. 目标

W3.6.6 不再重做各交易模块，而是在 W3.6.0～W3.6.5 已完成的 Cordys direct runtime 上做跨模块最终验收。

第一项 7.1 必须验证同一条业务链的关联事实连续存在，而不是分别创建几条彼此无关的记录：

`客户 -> 商机 -> 报价 -> 合同 -> 回款计划/回款记录 + 发票 + 订单`

其中任务标题仍按业务主链表达为：

`商机 -> 报价 -> 合同 -> 回款/发票 -> 订单`

## 2. 7.1 连续生命周期 Smoke

新增独立 `w366-transaction-chain-smoke`，不要只依赖 Root Smoke。

Root Smoke 继续保留全系统广度回归；W3.6.6 专项 Smoke 负责精确指出交易链在哪一段断裂。

### 2.1 固定夹具

使用 admin/manager 演示账号，创建唯一前缀夹具：

- 客户
- 产品
- 商机
- 报价
- 合同
- 回款计划
- 回款记录
- 工商抬头
- 发票
- 订单

所有夹具在 finally 清理，失败也不能长期污染开发库。

### 2.2 商机 -> 报价

必须断言：

- 商机 `customerId` 指向本次客户。
- 商机意向产品包含本次产品。
- 报价 `opportunityId` 指向本次商机。
- 报价产品行指向同一产品。
- 报价金额/产品金额保持一致。
- 若 CREATE 命中审批，则先完成报价审批，后续只使用已审批且未作废报价。

### 2.3 报价 -> 合同

合同创建必须真实传 `fromQuotationId`，不能由 Smoke 手工复制报价产品数组来冒充转换。

必须断言：

- `fromQuotationId` 能读取已审批且未作废报价。
- 合同 `customerId` 与商机客户一致。
- 合同产品来自报价产品。
- 合同金额与报价保持业务一致。
- 报价被作废/未审批时的保护语义仍由报价/合同专项 Smoke 负责，本项只验证成功主链。

### 2.4 合同 -> 回款

必须断言：

- 回款计划 `contractId` 指向本次合同。
- 回款记录同时指向本次合同与本次回款计划。
- 合同详情的 `paidAmount` 汇总能看到本次回款记录。

### 2.5 合同 -> 发票

必须断言：

- 工商抬头在当前租户创建。
- 发票 `contractId` 指向本次合同。
- 发票 `businessTitleId` 指向本次抬头。
- 客户 360 发票分页能从同一客户读回本次发票。

### 2.6 合同 -> 订单

必须断言：

- 订单 `customerId` 与商机/合同客户一致。
- 订单 `contractId` 指向本次合同。
- 订单 direct `number` 正常生成。
- 合同详情订单分页能读回本次订单。
- 客户 360 订单分页能读回本次订单。

### 2.7 反向消费验收

对同一个 `customerId` 验证：

- `/account/opportunity/page`
- `/account/contract/page`
- `/account/contract/payment-plan/page`
- `/account/contract/payment-record/page`
- `/account/invoice/page`
- `/account/order/page`

六个分页都必须找到同一条 Smoke 链上的对应资源。

对同一个 `contractId` 验证合同详情关联消费至少能读取：

- 回款计划/回款记录
- 发票
- 订单

## 3. 审批处理原则

7.1 不重新测试完整 approval engine；报价/合同/发票/订单的 CREATE/UPDATE/DELETE 审批已经有各自专项 Smoke。

但连续链路依赖“已审批报价 -> 合同”时，Smoke 必须把报价推进到可消费状态。

对其它模块：

- 若当前租户配置命中 CREATE 审批，使用已经存在的统一审批入口完成必要的通过动作；
- 不修改正式审批配置来绕过业务规则；
- 7.1 只记录审批是链路前置条件，不重复覆盖 reject/revoke 等分支。

实际执行时 7.1 使用会在 finally 中 drop 的隔离临时数据库：仅在该临时库中关闭不属于本项范围的 contract/invoice/order 审批流，并创建确定性的 quotation CREATE 流以满足 `fromQuotationId` 的 `APPROVED` 前置。当前 `default` 的正式审批配置未被修改。

## 4. DataScope 与权限边界

7.1 使用能够合法访问完整链路的角色完成成功主链。

完整角色矩阵、第二租户和 fail-closed 由 7.2 专门验收，避免 7.1 与 7.2 职责重叠。

## 5. 验收条件

7.1 只有同时满足以下条件才可 `[x]`：

1. 独立 W3.6.6 transaction-chain Smoke PASS。
2. `fromQuotationId` 真实路径通过。
3. 客户 360 六个交易子资源均能反向读回同一链夹具。
4. 合同关联消费能读回回款/发票/订单。
5. Smoke finally 清理完成。
6. Root Smoke 回归仍全绿。
7. 文档记录真实运行结果。

## 6. 后续 7.2～7.5

7.1 关闭后按 tasks 顺序继续：

- 7.2 全角色 / DataScope / 第二租户权限矩阵。
- 7.3 隔离空库全 migration + 双次 Seed + runtime Smoke。
- 7.4 `/system/modules` 最终卡片全量复查并更新 DB-001～005、DB-021、DB-022。
- 7.5 Root / Rules / Browser / typecheck / lint / production build 最终封板。

## 7. 7.1 实际结果

- `pnpm smoke:w366-transaction-chain`：PASS / exit 0。
- 临时库：`w366_chain_eb05cad01b`，56 migrations + Seed 成功，结束后自动 drop。
- `fromQuotationId` 真实链路：PASS。
- 客户 360 六资源：6/6 PASS。
- 合同关联消费：4/4 PASS。
- Root Smoke 回归：227/227。
- 详见 [W3.6.6 7.1 全交易链连续生命周期验收](./w366-transaction-chain-acceptance.md)。
