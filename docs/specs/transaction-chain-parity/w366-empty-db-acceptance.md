# W3.6.6 7.3 隔离空库 migration + 双次 Seed + runtime 验收

## 1. 结论

W3.6.6 7.3 已通过独立空库专项验收。

专项命令：`pnpm smoke:w366-empty-db`。

结果：**PASS / exit 0**。

临时数据库：`w366_empty_ecdd904081`，finally 自动 drop，不修改 `default`。

## 2. migration

- Prisma：**56 migrations found**。
- 56 个 migration 从零全部成功应用。

结果：`migrations56=true`。

## 3. 双次 Seed

在同一个数据库内连续执行两次 `prisma/seed.ts`：

- Seed #1：PASS。
- Seed #2：PASS。

第一次 Seed 后记录关键基线计数，第二次 Seed 后重新读取并做完整对象比较。

第二次 Seed 后计数：

```text
tenants=1
departments=4
roles=3
users=4
user_roles=4
sys_module_form=7
sys_module_field=60
sys_module_field_blob=60
opportunity_stage_config=0
contract_stage_config=7
sales_order_stage_config=7
```

两次计数完全一致：`seedCountsStable=true`。

### Opportunity stage 说明

`opportunity_stage_config=0` 是当前实现的真实事实：Opportunity 默认阶段并非由 Seed 预插，而是在 `/opportunity/stage/get` runtime 中按现有 Service 逻辑懒初始化。

因此本验收没有把 0 伪写成“Seed 已预置”；后续 runtime 实际请求 `/opportunity/stage/get` 并确认默认阶段可用。

## 4. Seed 账号 runtime

双次 Seed 后重新 build/start API，并实际登录：

- `admin@demo.com`
- `zhangwei@demo.com`
- `lina@demo.com`

结果：`demoLogins=true`。

## 5. 模块表单 / 阶段 runtime

实际读取七类 module form：

- Opportunity
- Quotation
- Contract
- Payment Plan
- Payment Record
- Invoice
- Order

结果：`sevenModuleForms=true`。

实际读取三类阶段：

- Opportunity
- Contract
- Order

结果：`threeStageConfigs=true`。

## 6. 最小交易 runtime

在双次 Seed 后的同一个临时库中关闭隔离库审批流，仅用于本项 runtime 稳定性，随后通过 HTTP 真实创建：

- customer
- product
- opportunity
- quotation
- contract
- payment plan
- payment record
- business title
- invoice
- order

Opportunity / Quotation / Contract / Payment Plan / Payment Record / Invoice / Order 七类主资源均再执行 page + detail 回读。

结果：`runtimeSevenResources=true`。

## 7. 最终结构化结果

```text
migrations56=true
seed1=true
seed2=true
seedCountsStable=true
demoLogins=true
sevenModuleForms=true
threeStageConfigs=true
runtimeSevenResources=true
```

因此 W3.6.6 **7.3 可以关闭**。下一步进入 7.4 `/system/modules` 最终卡片全量复查。
