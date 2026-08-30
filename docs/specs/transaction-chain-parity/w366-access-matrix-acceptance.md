# W3.6.6 7.2 全角色 / DataScope / 第二租户权限矩阵验收

## 1. 结论

W3.6.6 7.2 已通过独立隔离环境专项 Smoke。

专项命令：`pnpm smoke:w366-access-matrix`。

结果：**PASS / exit 0**。

临时数据库：`w366_scope_39256b259c`，从零执行 **56 migrations + Seed + API build/start**，finally 自动 drop，不修改 `default`。

## 2. 真实权限与 DataScope

本次没有造统一权限别名，而是使用各 Service 当前真实 read permission：

- Opportunity：`menu:opportunity`，owner scope。
- Quotation：`menu:quote`，createUser scope。
- Contract：`menu:contract`，owner scope。
- Payment Plan：`CONTRACT_PAYMENT_PLAN:READ`，owner scope。
- Payment Record：`CONTRACT_PAYMENT_RECORD:READ`，owner scope。
- Invoice：`CONTRACT_INVOICE:READ`，owner scope。
- Order：`ORDER:READ`，owner scope。

## 3. 角色矩阵

固定使用 Seed 真实角色：

- admin：ALL。
- zhangwei：DEPT_AND_CHILD（销售部及下级）。
- lina：SELF（销售一部）。

创建两组完整交易资源：

- Lina 创建/负责链：部门树内正例。
- admin/root 创建/负责链：同租户但 zhangwei 部门树外负例。

七类资源均实际验证：

- admin page 能看到两组，两个 known ID 详情均可读。
- zhangwei page 只包含 Lina 组，不包含 admin/root 组；Lina ID 可读，admin/root ID 详情 403/404。
- Lina page 只包含自己的 Lina 组；admin/root ID 详情 403/404。

结果：

- `allScopeSevenResources: true`
- `deptAndChildSevenResources: true`
- `selfScopeSevenResources: true`
- `listAndKnownIdFailClosed: true`

## 4. Quotation 特殊边界

报价 DataScope 使用 `createUser` 而不是 owner。

因此两组报价分别由 Lina 与 admin 实际创建，没有通过修改 owner 冒充 creator scope。

该项与其它 owner-scoped 资源在同一矩阵内通过。

## 5. customer 360 旁路

对 admin/root 客户 ID，使用 zhangwei 与 Lina 调用：

- `/account/opportunity/page`
- `/account/contract/page`
- `/account/contract/payment-plan/page`
- `/account/contract/payment-record/page`
- `/account/invoice/page`
- `/account/order/page`

接口返回 403/404 或合法空列表，不得返回 admin/root 链资源。

结果：`customer360NoBypass: true`。

## 6. contract relation 旁路

对 admin/root contract ID，使用 zhangwei 与 Lina 调用：

- `/contract/payment-plan/page`
- `/contract/payment-record/page`
- `/invoice/page`
- `/order/page`

均未泄漏对应回款/发票/订单。

结果：`contractRelationNoBypass: true`。

## 7. 第二租户

通过 `/auth/register` 创建第二租户管理员，保持真实 tenant token。

第二租户对第一租户七类 known ID 全部不可读；各 page 使用第一租户 Smoke 前缀也不返回第一租户资源。

另外直接在临时库为第二租户创建一条最小 direct Order：

- 第二租户管理员可以读取自己的 Order。
- 第一租户 admin known-ID 读取返回 403/404。
- 第一租户 `/order/page` 不出现第二租户 Order。

结果：

- `secondTenantKnownIdIsolation: true`
- `secondTenantReverseOrderIsolation: true`

## 8. 首次 Smoke 修正

第一次运行在 relation helper 中把 POST page 成功状态硬编码为 200，但 Nest `@Post` 默认返回 201，导致测试自身失败。

修正为接受 200/201 后重新运行，业务矩阵全部通过。该问题没有修改业务 Service 或放宽任何权限断言。

## 9. 最终结构化结果

```text
allScopeSevenResources=true
deptAndChildSevenResources=true
selfScopeSevenResources=true
listAndKnownIdFailClosed=true
customer360NoBypass=true
contractRelationNoBypass=true
secondTenantKnownIdIsolation=true
secondTenantReverseOrderIsolation=true
```

因此 W3.6.6 **7.2 可以关闭**。下一步进入 7.3 隔离空库全 migration + 双次 Seed + runtime Smoke。
