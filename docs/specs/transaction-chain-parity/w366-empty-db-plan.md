# W3.6.6 7.3 隔离空库 migration + 双次 Seed + runtime 计划

## 1. 目标

7.3 验证发布级空库路径，而不是当前 `default` 的增量升级路径。必须在**同一个全新数据库**上完成：

1. 全量 migration。
2. 第一次 Seed。
3. 记录关键基线表计数。
4. 第二次 Seed。
5. 基线计数完全一致。
6. 启动 API 并执行真实交易 runtime Smoke。
7. finally 自动 drop 临时库。

两个不同临时库各 Seed 一次不能替代“双次 Seed 幂等”。

## 2. 幂等计数基线

第一次/第二次 Seed 后比较：

- `tenants`
- `departments`
- `roles`
- `users`
- `user_roles`
- `sys_module_form`
- `sys_module_field`
- `sys_module_field_blob`
- `opportunity_stage_config`
- `contract_stage_config`
- `sales_order_stage_config`

第二次 Seed 必须 exit 0 且以上计数完全不变。

## 3. Runtime Smoke

双次 Seed 后重新 build/start API，验证：

- admin / zhangwei / lina 三个 Seed 账号可登录。
- Opportunity / Quotation / Contract / Payment Plan / Payment Record / Invoice / Order module form 可读。
- Opportunity / Contract / Order 默认 stage 配置存在。
- 关闭隔离库内审批流后，真实创建 customer、product、opportunity、quotation、contract、payment plan、payment record、business title、invoice、order。
- 各主资源 detail/page 能读回本次 runtime 夹具。

该项只验证空库产物可运行，不重复 7.1 的 `fromQuotationId` 和 7.2 的权限矩阵。

## 4. 关闭条件

- 56/56 migrations 成功。
- Seed #1 PASS。
- Seed #2 PASS。
- 关键基线计数一致。
- 三角色登录成功。
- 七类 module form + 三类 stage 配置可用。
- 最小 direct 交易 runtime 全绿。
- finally drop 临时数据库。
