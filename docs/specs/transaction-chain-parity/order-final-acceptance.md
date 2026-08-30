# W3.6.5 订单最终验收（6.4）

## 1. 结论

W3.6.5 订单模块已完成 direct model、direct API、状态流、审批、独立页面、客户/合同关联消费以及 `/system/modules` 设置入口的最终关门验收。

最终状态以本文件为准：

- 当前数据库迁移总数：**56**。
- 隔离空库已从零完成 **56/56 migrations + Seed**。
- Root Smoke：**227/227**。
- API Rules：**117/117**。
- Order Browser Smoke：**37/37**。
- workspace typecheck / lint / build：全部 exit 0。
- 订单运行时代码不再依赖旧 `/orders`、`OrderStatus`、`ORDER_STATUS_FLOW`、`ORDER_STATUS_LABELS`、小写 `order:create/update/delete` 或临时 `ORDER:APPROVAL`。

## 2. 6.4 最终验收中发现并修复的问题

### 2.1 `sales_order.contract_id` / `amount` 旧 NOT NULL 漂移

第一次 Root Smoke 在清理历史客户/合同时触发 PostgreSQL `23502`：合同删除的 `ON DELETE SET NULL` 会把 `sales_order.contract_id` 置空，但由旧 `orders` 表升级而来的列仍保留 NOT NULL。

同时复核确认 `amount` 也继承了旧表 NOT NULL，而当前 Prisma/Cordys direct order 目标允许为空。

新增 migration：

- `20260830154500_w365_order_nullable_contract_amount`

处理：

- `sales_order.contract_id DROP NOT NULL`
- `sales_order.amount DROP NOT NULL`

该 migration 已在当前 `default` 成功 deploy，并在最终隔离空库复放中重新验证。

### 2.2 历史角色仍持有旧订单权限码

修复 schema 后 Root Smoke 能完整执行，但 `zhangwei@demo.com` 在 `/order/add` 和客户 360 订单分页仍返回 403。

原因不是 DataScope，也不是临时角色污染，而是已有数据库的正式角色仍保存旧权限：

- `order:create`
- `order:update`
- `order:delete`

只修改 Seed 无法升级已经存在的数据库，因此新增 migration：

- `20260830155500_w365_order_permission_upgrade`

升级规则保持能力等价，不额外扩权：

- 有 `menu:order` -> 补 `ORDER:READ`
- `order:create` -> `ORDER:ADD`
- `order:update` -> `ORDER:UPDATE`
- `order:delete` -> `ORDER:DELETE`
- 删除三个旧小写动作码
- 不自动授予 `ORDER:IMPORT/EXPORT/DOWNLOAD`

迁移后重新登录获取新 token，Root Smoke 的 direct order 创建和客户 360 订单 Tab 均恢复正常。

## 3. 专项 Smoke

### 3.1 Direct Order

命令：

`pnpm smoke:w365-order`

结果：**PASS**。

覆盖 direct `sales_order + sales_order_field/blob + sales_order_snapshot`、module form、CRUD、User View、Import/Export、legacy `/orders -> 404` 等订单直接契约。

### 3.2 Order Stage

命令：

`pnpm smoke:w365-order-stage`

结果：**PASS**。

覆盖：

- stage CRUD / sort
- `stageHasData` 删除保护
- NORMAL rollback
- ADVANCED circulation
- required field conditions
- 真实订单 stage / pos / dynamic field 写入
- finally 恢复原状态流配置

### 3.3 Order Approval

命令：

`pnpm smoke:w365-order-approval`

结果：**PASS**。

覆盖：

- CREATE / UPDATE / DELETE approval
- UPDATE reject rollback
- UPDATE revoke rollback
- DELETE approve 后物理删除
- `approvalStatus`
- `approved` 历史事实位
- snapshot 同步
- `/approval-resource/*`
- `ORDER_APPROVAL` 业务通知

### 3.4 Browser / module settings

命令：

`pnpm smoke:w365-order-browser`

结果：**37 passed, 0 failed**。

实际浏览器覆盖：

- `/order/index`
- module form / Saved View / scope tab
- Import / Export
- 高级筛选
- table / billboard
- detail + approval detail + snapshot
- review / revoke
- 客户 360 direct OrderTable
- 合同详情 direct OrderTable
- 合同转订单预填
- `/system/modules` 订单表单设置 REAL
- `/system/modules` 订单状态流设置 REAL
- `/metadata/order/fields`
- `/order/stage/get`
- API 5xx = 0
- Runtime exception = 0

## 4. Root / Rules / static checks

### 4.1 Root Smoke

命令：`pnpm smoke`

最终结果：**227 passed, 0 failed**。

Root Smoke 已实际穿过报价 -> 合同 -> 回款 -> direct 订单 -> 发票，并验证客户 360 订单分页。

### 4.2 Rules

命令：`pnpm --filter @micromatrix/api test:rules`

结果：**117 tests / 117 pass / 0 fail**。

### 4.3 Typecheck

命令：`pnpm typecheck`

结果：**exit 0**，包含：

- `@micromatrix/shared build`
- `@micromatrix/shared typecheck`
- `@micromatrix/api typecheck`
- `@micromatrix/web typecheck`

### 4.4 Lint

命令：`pnpm lint`

结果：**exit 0**。

### 4.5 Production build

命令：`pnpm build`

结果：**exit 0**，shared / API / Web 全部成功。

## 5. 56/56 隔离空库复放

使用 W3.6.3 contract direct HTTP smoke 新建临时库：

- `w363_contract_api_dd8c85eafe`

结果：

- Prisma 检测到 **56 migrations**。
- 从 `20260813025747_init` 到 `20260830155500_w365_order_permission_upgrade` 全部成功应用。
- Seed 成功。
- contract module form / page / get / snapshot / update 全绿。
- User View 全绿。
- NORMAL / ADVANCED stage 全绿。
- batch update / sort / statistic 全绿。
- DataScope ALL / DEPT / SELF 全绿。
- CREATE / UPDATE / DELETE approval 全绿。
- revoke rollback 全绿。
- batch approval 全绿。
- legacy contract main route 404 断言全绿。
- 进程 **exit 0**。

该结果同时证明新增第 55、56 个 migration 可以在真正空库链路中按顺序复放，不依赖当前开发库的历史状态。

## 6. Legacy / deferred 最终扫描

对 `apps / packages / scripts` 运行时代码进行大小写敏感扫描，并排除 generated / dist / migrations：

- `order:create`：0
- `order:update`：0
- `order:delete`：0
- `ORDER:APPROVAL`：0
- `ORDER_STATUS_FLOW`：0
- `ORDER_STATUS_LABELS`：0

`OrderStatus` 有 3 个字符串命中，全部来自 `scripts/w365-order-browser-smoke.mjs` 的辅助函数名 `waitForOrderStatus`；函数实际轮询的是 direct order 的 `approvalStatus`，不引用旧 `OrderStatus` 类型或旧状态流。

`/orders` 字符串命中中：

- `apps/api/scripts/w365-order-smoke.ts` 保留旧 `/orders -> 404` 断言，属于 legacy exit 证据。
- 其余均为 `views/orders` 目录、`OrdersModule/OrdersService/OrdersController` import 路径，不是旧 HTTP route。

另外扫描 `order + deferred/planned/占位/待对齐`：**0 命中**。

## 7. 最终边界

W3.6.5 完成后，订单运行时边界为：

- direct `sales_order` 数据模型
- `/order/*`
- `/order/view/*`
- `/approval-resource/*`
- `/approvals/tasks/*`
- `ORDER:*` 权限
- `/order/index`
- customer / contract 复用 direct `OrderTable`
- `/system/modules` direct order metadata + direct order stage runtime

不存在第二套旧订单 runtime，也不保留旧状态枚举兼容页面。

## 8. 下一阶段

W3.6.5 封版后进入 W3.6.6 全交易链最终验收：

- 商机 -> 报价 -> 合同 -> 回款/发票 -> 订单连续生命周期
- 全角色 / DataScope / 第二租户矩阵
- 隔离空库全 migration + 双次 Seed + runtime Smoke
- `/system/modules` 全量复查
- Root / Rules / Browser / typecheck / lint / production build 总验收
