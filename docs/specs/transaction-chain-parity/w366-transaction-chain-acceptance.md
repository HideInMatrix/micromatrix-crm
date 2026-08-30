# W3.6.6 7.1 全交易链连续生命周期验收

## 1. 结论

W3.6.6 7.1 已通过独立隔离环境专项 Smoke 验收。

本次不是把各模块 Smoke 简单串行执行，而是创建同一条真实关联链：

`客户 -> 商机 -> 报价 -> 合同 -> 回款计划/回款记录 + 发票 + 订单`

核心业务主链：

`商机 -> 报价 -> 合同 -> 回款/发票 -> 订单`

专项命令：

`pnpm smoke:w366-transaction-chain`

最终结果：**PASS / exit 0**。

Root Smoke 回归：`pnpm smoke` -> **227/227 / exit 0**。

## 2. 隔离环境

专项 Smoke 使用临时数据库与临时 API 进程，不修改当前 `default`：

- 临时数据库：`w366_chain_eb05cad01b`
- Prisma：**56 migrations found**，56 个 migration 全部成功应用
- Seed：成功
- API：使用本次临时数据库重新 build 后启动
- finally：关闭临时 API、断开 Prisma、terminate connection、drop 临时数据库

因此本次验收不会留下客户、产品、审批流、报价、合同、回款、发票或订单夹具。

## 3. 报价审批前置

`Contract.fromQuotationId` 的真实 Service 约束是：

- 当前租户报价
- `invalid=false`
- `approvalStatus=APPROVED`

7.1 不绕过这个约束。

在临时数据库中：

1. 关闭 Seed 中可能影响确定性的 quotation/contract/invoice/order 流程。
2. 仅创建一个 quotation CREATE 测试审批流。
3. 创建报价后断言 `approvalStatus=APPROVING`。
4. 通过 `/opportunity/quotation/approve` 推进为 `APPROVED`。
5. 再使用该报价创建合同。

该流程只发生在会被 drop 的临时数据库，不改变 `default` 正式审批配置。

## 4. 商机 -> 报价

实际断言：

- 商机 `customerId` 等于本次客户 ID。
- 商机 `products` 包含本次产品 ID。
- 报价 `opportunityId` 等于本次商机 ID。
- 报价产品行 `productId` 等于同一产品 ID。
- 报价进入 CREATE 审批并最终为 `APPROVED`。
- 报价 `approved=true`、`invalid=false`。

结果：**PASS**。

## 5. 报价 -> 合同

合同创建没有手工复制报价产品数组，而是实际传：

`fromQuotationId: quotation.id`

并且不显式传合同 `products` 与 `amount`，强制 Service 从已审批报价读取产品并计算合同金额。

实际断言：

- 合同 `customerId` 与商机客户一致。
- 合同金额自动得到 `30000`。
- 合同产品 `productId` 与报价产品一致。
- 合同产品金额为 `30000`。

结果：**PASS**。

这证明 W3.6 各模块之间不是“数据长得一样”，而是 `fromQuotationId` 真转换入口已经连通。

## 6. 合同 -> 回款

创建：

- 回款计划
- 回款记录

实际断言：

- `paymentPlan.contractId === contract.id`
- `paymentRecord.contractId === contract.id`
- `paymentRecord.paymentPlanId === plan.id`
- `/contract/get/:id` 返回 `paidAmount=30000`

结果：**PASS**。

## 7. 合同 -> 发票

创建当前租户工商抬头和 direct invoice。

实际断言：

- `invoice.contractId === contract.id`
- `invoice.businessTitleId === businessTitle.id`
- `/contract/invoice/statistic/:contractId`：
  - `contractAmount=30000`
  - `invoicedAmount=30000`
  - `uninvoicedAmount=0`

结果：**PASS**。

## 8. 合同 -> 订单

订单使用同一 customer / contract，并继续消费合同中的同一产品：

- `order.customerId === customer.id`
- `order.contractId === contract.id`
- direct `order.number` 正常生成
- 订单产品 `productId` 等于商机/报价/合同中的同一产品 ID

结果：**PASS**。

产品关联连续性实际为：

`Opportunity.products -> Quotation.products -> Contract.products -> Order.products`

## 9. 客户 360 反向消费

对同一个 `customerId` 实际调用：

- `/account/opportunity/page`
- `/account/contract/page`
- `/account/contract/payment-plan/page`
- `/account/contract/payment-record/page`
- `/account/invoice/page`
- `/account/order/page`

六个分页全部读回本次链路对应资源。

结果：**6/6 PASS**。

## 10. 合同详情关联消费

对同一个 `contractId` 实际调用：

- `/contract/payment-plan/page`
- `/contract/payment-record/page`
- `/invoice/page`
- `/order/page`

四个 direct 关联分页全部读回本次合同资源。

结果：**4/4 PASS**。

这与当前 `ContractDetailDrawer` 的真实消费路径一致。

## 11. 输出证据

专项 Smoke 最终输出：

- `migrationsAndSeed: true`
- `opportunityToQuotation: true`
- `quotationApproved: true`
- `quotationToContractViaFromQuotationId: true`
- `productContinuity: true`
- `paymentPlanAndRecord: true`
- `contractPaidAmount: true`
- `invoiceAndBusinessTitle: true`
- `directOrder: true`
- `customer360SixResources: true`
- `contractRelatedConsumers: true`
- `invoiceStatistic: true`

## 12. Root 回归

专项验收后重新执行：

`pnpm smoke`

结果：**227 passed, 0 failed**。

说明独立交易链专项没有破坏现有全系统 Root Smoke。

## 13. 7.1 关闭条件

- 独立 transaction-chain Smoke：PASS
- `fromQuotationId`：真实通过
- 产品连续性：PASS
- 客户 360 六资源：PASS
- 合同四关联消费：PASS
- 临时库自动清理：PASS
- Root Smoke：227/227

因此 W3.6.6 **7.1 可以关闭**。

下一步：7.2 全角色 / DataScope / 第二租户权限矩阵。
