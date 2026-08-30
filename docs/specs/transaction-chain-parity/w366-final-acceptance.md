# W3.6.6 7.5 最终封板验收

## 1. 最终结论

本文件用于记录 W3.6.6 最终封板的**本轮实跑**结果。

W3.6.6 7.5 最终封板已完成，以下均为本轮真实执行结果：

- Root `pnpm smoke`：**227/227，0 fail，exit 0**。
- API Rules：**118/118，0 fail，exit 0**。
- `pnpm smoke:w366-transaction-chain`：PASS / exit 0。
- `pnpm smoke:w366-access-matrix`：PASS / exit 0。
- `pnpm smoke:w366-empty-db`：PASS / exit 0。
- `pnpm smoke:w366-system-modules-browser`：**47/47，0 fail，exit 0**。
- 合同模块设置补充 Browser Smoke：**23/23，0 fail，exit 0**。
- W3.6.3 isolated contract HTTP Smoke：PASS / exit 0，包含合同作废/归档通知断言。
- Workspace `pnpm typecheck`：PASS / exit 0。
- Workspace `pnpm lint`：PASS / exit 0。
- Workspace `pnpm build`：PASS / exit 0。
- 最终 runtime legacy/deferred sanity scan：7 类硬检查全部 0。

因此 W3.6.6 7.1～7.5 均满足关闭条件。

## 2. Root Smoke

本轮执行：`pnpm smoke`。

结果：**227 passed / 0 failed / exit 0**。

交易链关键断言继续通过：

- Opportunity / Quotation / Contract 主链。
- 报价产品带入 direct 合同。
- 回款进入合同汇总。
- direct Order 创建。
- customer 360 的 Opportunity / Contract / Payment Plan / Payment Record / Invoice / Order 六个 Tab。
- 合同审批与 `CONTRACT_APPROVAL` 通知。

## 3. API Rules

本轮执行：`pnpm --filter @micromatrix/api test:rules`。

结果：

```text
tests 118
pass 118
fail 0
```

较 W3.6.5 最终基线 117 条增加 1 条，本文件按本轮真实 **118/118** 记录。

## 4. 7.1 transaction-chain 最终复跑

临时库：`w366_chain_04658c0542`。

- 56 migrations 全部成功。
- Seed 成功。
- API build/start 成功。
- Opportunity -> Quotation：PASS。
- Quotation 审批：PASS。
- Contract 必须走 `fromQuotationId`：PASS。
- 产品连续性：PASS。
- Payment Plan / Payment Record：PASS。
- 合同已回款金额：PASS。
- Invoice + Business Title：PASS。
- direct Order：PASS。
- customer 360 六资源：PASS。
- contract related consumers：PASS。
- invoice statistic：PASS。

专项命令最终 **exit 0**，finally 自动清理临时库。

## 5. 7.2 access-matrix 最终复跑

临时库：`w366_scope_1e8d6baf11`。

- 56 migrations + Seed + API build/start：PASS。
- ALL 七资源：PASS。
- DEPT_AND_CHILD 七资源：PASS。
- SELF 七资源：PASS。
- page + known-ID fail-closed：PASS。
- customer 360 无 DataScope 旁路：PASS。
- contract relation 无 DataScope 旁路：PASS。
- 第二租户 known-ID 隔离：PASS。
- 第二租户 reverse Order 隔离：PASS。

专项命令最终 **exit 0**，finally 自动清理临时库。

## 6. 7.3 empty-db 最终复跑

临时库：`w366_empty_a31b1e4c59`。

- **56/56 migrations**：PASS。
- Seed #1：PASS。
- Seed #2：PASS。
- `seedCountsStable=true`。
- 三演示账号登录：PASS。
- 七类 module form：PASS。
- Opportunity / Contract / Order 三类 stage：PASS。
- 七类 direct runtime 资源：PASS。

第二次 Seed 后关键基线计数：

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

`opportunity_stage_config=0` 继续按现有 runtime 懒初始化设计解释，不伪记为 Seed 预置。

## 7. 7.4 `/system/modules` 最终状态

- 总 Browser：**47/47 / exit 0**。
- 合同卡补充 Browser：**23/23 / exit 0**。
- 四张交易链卡片 15 个入口全部 REAL。
- 字段路由均等待对应 metadata HTTP 200 后再进入下一页，避免 CDP 连续导航中断未完成请求。
- Contract stage / Opportunity stage / Order stage 等 Drawer 均真实打开并消费 direct config API。
- API 5xx=0。
- Runtime exception=0。

Deferred backlog 当前：

- DB-001～005：`VERIFIED`。
- DB-022：`VERIFIED`。
- DB-021：`IN_PROGRESS`，只剩 FollowUpPlan 独立 Field/Blob；W3.6 交易链子范围已全部关闭。

## 8. Workspace 静态检查与 production build

### 8.1 Typecheck

`pnpm typecheck`：**PASS / exit 0**。

覆盖：

- shared build。
- shared `tsc --noEmit`。
- API Prisma generate + `tsc --noEmit`。
- Web `vue-tsc --build`。

### 8.2 ESLint

首次 `pnpm lint` 暴露 20 个 `no-useless-escape`，全部位于本轮新增/更新 Smoke 的字符串转义，不涉及业务逻辑：

- 三份 W3.6.6 isolated Smoke 的 `.env` DATABASE_URL 引号清理正则。
- W3.6.3 合同模块设置 Browser Smoke 的 CSS selector 引号。

修正只移除多余 escape，不改变断言或 API 行为。修正后：

`pnpm lint`：**PASS / exit 0**。

修正后额外执行：

- `node --check apps/api/scripts/w366-transaction-chain-smoke.mjs`：PASS。
- `node --check apps/api/scripts/w366-access-matrix-smoke.mjs`：PASS。
- `node --check apps/api/scripts/w366-empty-db-smoke.mjs`：PASS。
- `node --check scripts/w363-contract-module-settings-browser-smoke.mjs`：PASS。
- 合同模块设置 Browser Smoke 再跑：**23/23 / exit 0**。

### 8.3 Production build

`pnpm build`：**PASS / exit 0**。

覆盖：

- shared `tsc`。
- API Prisma generate + production `tsc`。
- Web Vite 8.2.1 production build，4141 modules transformed。

## 9. 最终 runtime legacy/deferred sanity scan

最终扫描只检查运行时代码：`apps/api/src`、`apps/web/src`、`packages/shared/src`，排除 docs / migrations / scripts / generated / dist。

精确结果：

```text
legacy_http_router_/orders: 0
ORDER_STATUS_or_OrderStatus: 0
legacy_order_permissions: 0
legacy_transaction_models: 0
transaction_deferred_instances: 0
transaction_uppercase_markers: 0
order_customData: 0
```

说明：第一轮宽扫描曾命中 `modules/orders` / `views/orders` 源码 import 路径、表单 `placeholder=`、CSS `--el-text-color-placeholder` 和通用 `ModuleAction.deferred` 类型/渲染机制；这些均不是旧 HTTP 路由或交易链 deferred 实例。精确扫描排除上述语义误报后，七类硬检查全部为 0。

## 10. Deferred Backlog 最终状态

- DB-001 `CONTRACT_VOID`：`VERIFIED`。
- DB-002 `CONTRACT_ARCHIVED`：`VERIFIED`。
- DB-003 `INVOICE_APPROVAL`：`VERIFIED`。
- DB-004 `CREATE_USER` 收件范围：`VERIFIED`。
- DB-005 回款计划独立负责人：`VERIFIED`。
- DB-022 模块配置专属设置入口：`VERIFIED`。
- DB-021：保持 `IN_PROGRESS`；W3.6 交易链部分已全部完成，只剩图外 FollowUpPlan 独立 Field/Blob，不能为了 W3.6.6 封板提前标 VERIFIED。

DB-004/005 最终复查还补充了报价/合同/回款计划到期通知的 direct `createUserId` 传递，并确认回款计划通知继续使用独立 `plan.owner`。对应新增 Rules 用例使最终 Rules 基线从 117 增至 **118/118**。

## 11. Git 封板检查

- `git diff --check`：PASS / exit 0。
- `git diff --cached --check`：PASS / exit 0。
- staged 范围：21 个文件，2684 insertions / 40 deletions。
- 变更范围仅包含 W3.6.6 交易链最终 Smoke、合同通知/到期通知、合同阶段设置、Deferred Backlog、tasks 与验收文档。
- 不包含数据库 dump、构建产物或临时运行日志。

完成本地提交后，本阶段结束；不执行 push。
