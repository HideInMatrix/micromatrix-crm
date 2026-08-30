# W3.6.6 7.2 全角色 / DataScope / 第二租户权限矩阵计划

## 1. 目标

7.2 不重复 7.1 的成功业务链，而是验证交易链所有主要资源在真实权限码、真实 DataScope 与租户边界下 fail-closed。

固定身份：

- `admin@demo.com`：管理员，`ALL`。
- `zhangwei@demo.com`：销售主管，`DEPT_AND_CHILD`，销售部及其下级。
- `lina@demo.com`：销售专员，`SELF`，销售一部。
- 第二租户管理员：独立注册，用于跨租户 ID 直查与列表隔离。

Seed 中管理员位于组织根部门，因此 admin/root 创建或负责的资源是 zhangwei 的“同租户但部门树外”负例；Lina 创建/负责的资源是 zhangwei 的部门树内正例。

## 2. 真实 READ permission / Scope 事实

按当前已对齐 Service 使用真实权限码，不虚构统一命名：

| 资源 | READ permission | DataScope 事实 |
| --- | --- | --- |
| Opportunity | `menu:opportunity` | owner |
| Quotation | `menu:quote` | createUser |
| Contract | `menu:contract` | owner |
| Payment Plan | `CONTRACT_PAYMENT_PLAN:READ` | owner |
| Payment Record | `CONTRACT_PAYMENT_RECORD:READ` | owner |
| Invoice | `CONTRACT_INVOICE:READ` | owner |
| Order | `ORDER:READ` | owner |

7.2 只按这些真实 code 调用，不为了测试方便改角色权限。

## 3. 同租户矩阵

在隔离临时数据库中创建两组资源：

### 3.1 部门树内链（Lina）

由 Lina 创建/负责：

- customer
- opportunity
- quotation
- contract
- payment plan
- payment record
- invoice
- order

必须满足：

- admin 能读全部。
- zhangwei 能读 Lina 资源。
- Lina 能读自己的资源。

### 3.2 部门树外链（admin/root）

由 admin 创建/负责同类资源。

必须满足：

- admin 能读。
- zhangwei 的列表不返回这些资源，ID 直查返回 404/不可见。
- Lina 的列表不返回这些资源，ID 直查返回 404/不可见。

报价特殊：DataScope 按 `createUser`，因此必须分别由 Lina 与 admin 实际发起创建，不能只改 owner。

## 4. 列表 + ID 直查双重验收

每个主资源同时验证：

1. page/list 不泄漏越权资源；
2. `get/:id` 或等价详情接口不能通过已知 ID 绕过 DataScope。

只测列表不足以关闭 7.2。

回款计划/记录、发票、订单同样至少验证分页过滤；存在详情接口时追加 ID 直查。

## 5. 第二租户

通过 `/auth/register` 创建独立租户管理员。

必须验证：

- 第二租户 token 对第一租户 Opportunity/Quotation/Contract/Payment/Invoice/Order 已知 ID 均不可读。
- 第一租户 page 请求永远不混入第二租户资源。
- 若第二租户标准业务初始化足以创建交易资源，则创建至少一条第二租户资源，再反向验证第一租户无法读取；若注册租户未自动初始化某业务模块，则直接使用数据库夹具创建第二租户 direct 资源，但 HTTP 读取边界仍必须真实验证。

## 6. 关联资源 fail-closed

除了各模块主列表/详情，再验证客户 360 与合同关联消费：

- Lina/zhangwei 只能通过 `/account/*` 看到其 DataScope 合法资源。
- 对无权 customer/contract 直接传已知 ID，接口不能借关联分页泄漏订单、发票、回款等子资源。

## 7. 隔离与清理

新增独立 `w366-access-matrix-smoke`：

- 临时 PostgreSQL 数据库。
- 全 56 migrations。
- Seed。
- 独立 API build/start。
- finally 停 API、断连接并 drop 临时库。
- 不修改当前 `default`。

## 8. 关闭条件

7.2 只有以下全部成立才可 `[x]`：

1. ALL / DEPT_AND_CHILD / SELF 三层正负矩阵通过。
2. Opportunity / Quotation / Contract / Payment Plan / Payment Record / Invoice / Order 全覆盖。
3. 列表与 ID 直查均 fail-closed。
4. 第二租户已知 ID 无法跨租户读取。
5. customer 360 / contract relation 不形成旁路泄漏。
6. 专项 Smoke finally 清理完成。
7. 文档记录真实结果，不能用管理员结果代替角色矩阵。
