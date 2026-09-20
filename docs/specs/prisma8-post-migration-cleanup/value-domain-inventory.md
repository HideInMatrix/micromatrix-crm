# PRISMA8-002 Numeric / JSON Domain 收口

状态：`P4 VERIFIED`

## 1. Contract inventory

canonical contract 当前包含：

- **12 个 Numeric 字段**
  - `BiddingInfos.budget numeric(16,2)`
  - `Contract.amount numeric(14,2)`
  - `ContractInvoice.amount/taxRate numeric(20,10)`
  - `ContractPaymentPlan.planAmount numeric(20,10)`
  - `ContractPaymentRecord.recordAmount numeric(20,10)`
  - `Opportunity.amount/possible numeric(20,10)`
  - `OpportunityQuotation.amount numeric(14,2)`
  - `Plans.price numeric(10,2)`
  - `Product.price numeric(14,4)`
  - `SalesOrder.amount numeric(20,10)`
- **21 个 Jsonb 字段**，覆盖公告接收人、审批配置/快照、企业任务输入输出、导出任务 payload、组织同步、消息配置、操作日志等。

P4 开始时共有：

- `prisma8Numeric`：**66 calls / 23 files**，其中 production **43 / 11 files**；
- `prisma8JsonValue`：**52 calls / 24 files**，其中 production **27 / 12 files**。

## 2. Numeric canonical domain

新增 `src/prisma/numeric-value.ts`：

- `DecimalString`：通过独立 brand 表示已校验的十进制文本；
- `decimalString(value, precision, scale)`：只接受 string/number，拒绝非有限数、科学计数法、precision/scale 越界；
- `numericValue(decimal, precision, scale)`：只有已经过 `decimalString` 校验的值才能进入 Prisma Numeric input；
- `tryNumericValues(...)`：高级筛选 fail-closed，不再先 `Number()` 再查询 Numeric。

production **43/43** Numeric ORM 写入均严格走：

```text
raw input
  -> decimalString(...)
  -> numericValue(...)
  -> Prisma Numeric
```

已删除 Numeric 筛选中的 `map(Number)` 路径，并修复 Contract / SalesOrder 更新时“金额未修改但 DB Numeric -> Number -> Numeric 回写”的浮点往返：只有 DTO 金额变化或产品重算时才更新 Numeric 列。

专项验证明确要求 `0.1 + 0.2` 对 scale=2 **必须拒绝**，不允许自动舍入后伪装成精确 decimal。

## 3. JSON canonical domain

新增 `src/prisma/json-value.ts`，所有新 JSONB 对象写入统一经过 `jsonValue()`：

- JSON stringify/parse 归一化；
- top-level `undefined` 拒绝；
- BigInt / circular 等不可 JSON 序列化输入拒绝；
- NaN / Infinity 显式拒绝，避免 `JSON.stringify` 静默转换为 `null`。

production 中 `as JsonValue` 只保留 canonical serializer 内部唯一 cast；ExportTasks 原有私有 JSON cast 已删除并改用统一 serializer。

## 4. Compatibility cleanup

- 删除 `src/prisma/prisma8-values.ts`；
- `prisma8Numeric` / `prisma8JsonValue` / `prisma8-values` **0 refs**；
- 不修改 PostgreSQL numeric/jsonb 物理 schema，本阶段只正规化应用 domain。

## 5. Gate

- API typecheck：PASS；
- API production build：PASS；
- `git diff --check`：PASS；
- value-domain 专项：**2/2 PASS**；
- 完整 API Rules：**348/348 PASS、0 fail、0 skip**。

