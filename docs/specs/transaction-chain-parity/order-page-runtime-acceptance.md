# W3.6.5 订单独立页 / 关联消费 / legacy exit 专项验收

> 验收日期：2026-08-30。范围：W3.6.5 task 6.2E。本文确认 `/order/index` 独立页、direct OrderTable、客户 360 / 合同详情复用、合同转订单深链，以及旧 `/orders` / `OrderStatus` / 小写订单权限的运行时退出；`/system/modules` 订单卡片留在 6.3。

## 1. 独立订单路由

PC 订单入口已切到 Cordys 路由 `/order/index`，route name 为 `order-index`，权限为 `ORDER:READ`；左侧主导航和首页快捷新建订单均同步使用 `/order/index`。

`OrdersView.vue` 只作为独立页面壳，核心能力下沉到可复用 `OrderTable`。

## 2. Direct OrderTable

订单页面不再读取旧 REST `/orders`，全部消费 direct `/order/*`、`/order/view/*` 与统一 `/approval-resource/*`。

独立页已覆盖 Saved View、keyword / AdvancedFilter、动态列、table / billboard、stage 流转与拖拽排序、新建/编辑/删除、batch edit、review/revoke、approval status、detail drawer、business/form snapshot、Import/Export 与 ExportTask，并使用 `ORDER:ADD/UPDATE/DELETE/IMPORT/EXPORT/READ` 权限。

## 3. 合同转订单

合同详情提供真实“转订单”入口：`/order/index?fromContract=<contractId>`。订单页读取 direct contract detail 后打开新建 Drawer，并预填 customer、contract、owner、amount、products 与默认订单名称，承载 Cordys `CONTRACT_TO_ORDER` link scenario。

## 4. 客户 360 / 合同详情复用

客户 360 的订单 Tab 已退出旧 `Customer360OrderVO.code/status/createdAt + ORDER_STATUS_LABELS` 表格，改为复用同一个 `OrderTable` 并传入 `customerId`。

`ContractDetailDrawer` 新增订单 Tab，同样复用 `OrderTable` 并传入 `contractId`，同时提供合同转订单入口。独立订单页、客户 360、合同详情因此共享同一 direct 订单展示与查询语义。

## 5. legacy exit

运行时代码已完成：

- Web `ORDER_STATUS_LABELS`：0 命中。
- Web `ORDER_STATUS_FLOW`：0 命中。
- Web/Shared `OrderStatus`：0 运行时类型命中。
- 小写 `order:create`：0 命中。
- 小写 `order:update`：0 命中。
- 小写 `order:delete`：0 命中；Seed 中最后一个兼容残留已删除。
- 根 `scripts/smoke.mjs` 的订单创建已由 `/orders` 迁到 `/order/add`。
- W3.4.1 首页 Browser Smoke 的订单快捷入口期望已迁到 `/order/index`。

旧 `/orders` 只保留目录名字符串，以及 `w365-order-smoke` 显式请求 `/orders` 并断言 404 的 legacy 退出证据。

当前 Prisma `Order` 映射 `sales_order`，已无旧 `customData Json` 与固定 `status` 字段。旧 `OrderStatus` 仅存在历史 migration 创建记录，新 migration 已显式 `DROP TYPE IF EXISTS "OrderStatus"`。

## 6. Browser Smoke

命令：`pnpm smoke:w365-order-browser`

最终结果：**29 passed / 0 failed / exit 0**。

实测覆盖管理员真实浏览器登录、`/order/index`、module form、Saved View、scope tab、Import/Export、AdvancedFilter、table/billboard、detail + snapshot、`board=true`、统一审批 push/revoke、APPROVING/REVOKED 状态回读、客户 360 direct OrderTable、合同详情 direct OrderTable、合同转订单深链与预填；API 5xx = 0，Runtime exception = 0。

## 7. 其它关闭回归

- `pnpm --filter @micromatrix/web typecheck`：**exit 0**。
- `pnpm --filter @micromatrix/web build`：**exit 0**。
- `pnpm smoke:w365-order`：**PASS / exit 0**。

## 8. 结论

W3.6.5 **6.2E 已关闭**。订单 direct runtime 已从数据库/API 延伸到独立 PC 页面和关联业务场景，并完成旧 `/orders`、固定 `OrderStatus` 和小写旧订单权限的运行时退出。

下一执行指针：**6.3 `/system/modules` 订单卡片**，要求“订单表单设置”和“订单状态流设置”都达到 REAL，不能保留 label-only / placeholder。
