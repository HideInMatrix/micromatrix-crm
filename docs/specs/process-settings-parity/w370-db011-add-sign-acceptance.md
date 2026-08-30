# W3.7-9.3B DB-011 BEFORE / AFTER 加签专项验收

验收日期：2026-08-30

## 1. 关闭范围

本轮只关闭 9.3B，不提前关闭整个 DB-011。

已关闭能力：

- `allowAddSign` 服务端与流程配置单项开放；
- `POST /approvals/tasks/:id/sign`；
- BEFORE / AFTER 加签；
- SIGN task；
- `rootTaskId + sort` 嵌套加签链；
- SIGN 待办、已办和审批详情；
- 桌面端与移动端加签入口；
- 审批详情返回 `addSignTasks` 与 `canAddSign`。

仍保持关闭：

- 9.3C 节点退回；
- 9.3D 审批人任务撤回；
- 9.3E `requireComment` / 动作附件；
- DB-012 的 SEQUENTIAL、条件节点、动态审批人、字段权限、后置动作与 Webhook。

`ApprovalFlowConfigService` 仍对 `allowBatchProcess / allowWithdraw / duplicateApproverRule != FIRST_ONLY / requireComment` fail-closed，仅从高级设置保护中移除 `allowAddSign`。

## 2. Cordys 源码事实

第一事实来源见 [9.3B BEFORE / AFTER 加签源码审计](./w370-db011-add-sign-audit.md)。

本轮严格保持以下语义：

- 只有 flow `allowAddSign=true` 才允许加签；
- BEFORE：源 task 保持 `PENDING`，`action=SIGN`，加签动作本身不追加 ApprovalRecord；
- AFTER：源 task -> `APPROVED`，`action=APPROVE`，追加 ApprovalRecord；
- SIGN task 继承源 task 的 node / nodeRound；
- 普通任务首次加签以源 task 为 root；
- 嵌套 BEFORE 插到父加签之前；嵌套 AFTER 插到父加签之后；
- 同 root 链按 `sort` 严格顺序执行，链尾完成后恢复 root 或继续原审批节点。

## 3. 数据模型与 Migration 61

Migration：`20260830221500_w370_approval_add_sign`

新增：

- `ApprovalAddSignType = BEFORE / AFTER`；
- `approval_add_sign_tasks`：
  - `task_id`：新生成 SIGN task；
  - `sign_task_id`：被加签源 task；
  - `type`；
  - `root_task_id`；
  - `sort`；
  - `comment`；
  - tenant / instance / creator / timestamps。

Migration 60 未回改；Migration 61 为纯 forward migration。

`default` 已执行 `prisma migrate deploy`，当前 **61/61 migrations successfully applied**。

## 4. Runtime 与安全边界

### 4.1 服务端 gate

加签同时校验：

- tenant；
- instance 仍为 PENDING；
- 当前用户是 task approver；
- task 仍为 PENDING；
- flow 存在且 `allowAddSign=true`；
- signApprover 是同 tenant ACTIVE 用户；
- SIGN task 必须有真实 add-sign relation；
- 同 root 链中存在更早 PENDING task 时禁止越序处理。

BEFORE 后源 task `action=SIGN`，因此其 approve/reject/sign 均被挂起 gate 阻断，直到前置链完成。

### 4.2 ANY / ALL

- ANY：当前可执行审批链完成后才清理同节点剩余待办并推进；
- ALL：一个审批人的 AFTER 加签链完成后，如果 sibling approver 仍 PENDING，实例不会提前 advance；
- SIGN 链完成后复用统一节点完成逻辑，不建立第二套审批推进真相源。

### 4.3 API / VO / UI

- 新增 `POST /approvals/tasks/:id/sign`；
- `my-pending` / `my-handled` 纳入 SIGN；
- `ApprovalInstanceVO` 新增 `addSignTasks`、`canAddSign`；
- 桌面审批详情仅在 `canAddSign=true` 时显示“加签”；
- 移动审批详情同样按 `canAddSign` 显示入口；
- 前端可选择 BEFORE / AFTER、租户成员和可选说明。

## 5. 9.3B 隔离 HTTP Smoke

命令：

`pnpm --filter @micromatrix/api smoke:w370-db011-add-sign`

脚本自动创建隔离数据库，从零执行 **61/61 migrations + Seed + API production build**，真实 HTTP 验证：

- `allowAddSign=false` 硬门禁；
- 普通 BEFORE；
- 二级嵌套 BEFORE；
- 二级嵌套 AFTER；
- 普通 AFTER；
- 非 task owner 拒绝；
- 跨 tenant signApprover 拒绝；
- BEFORE 源任务挂起期间直接 approve 拒绝；
- 已存在前置链时重复从挂起源 task 发起 sign 拒绝；
- SIGN 链按 sort 顺序执行；
- ALL 节点等待 sibling，不提前推进；
- 详情 `addSignTasks` / ApprovalRecord 语义正确。

最终摘要：

- migrations: **61**；
- allowAddSignGate: true；
- before: true；
- nestedBefore: true；
- nestedAfter: true；
- ordinaryAfter: true；
- ownerGate: true；
- repeatGate: true；
- crossTenantApproverGate: true；
- allModeWaitsForSibling: true；
- addSignChainVo: true。

## 6. Browser 验收

命令：

`pnpm smoke:w370-db011-add-sign-browser`

结果：**17 passed, 0 failed**。

覆盖：

- gate 关闭时 `canAddSign=false` 且 UI 不展示按钮；
- gate 开启时 `canAddSign=true` 且展示加签按钮；
- BEFORE / AFTER 控件可用；
- 租户成员选择可用；
- 加签说明可填写；
- UI 真实调用 sign API；
- API 返回成功；
- AFTER 写入 addSignTasks；
- 生成目标 SIGN 待办；
- Browser Runtime exception = 0。

Browser Smoke 使用现有 Order flow 时临时复用并在 finally 原样恢复，不再错误创建同 formType 第二条 flow。

## 7. 四业务与空库回归

### 7.1 DB-010 通用审批回归

`pnpm smoke:w370-db010-regression`

在 **61 migrations** 下：

- generic snapshot lifecycle：PASS；
- tenant restore fail-closed：PASS；
- Quotation approval regression：PASS；
- Invoice approval regression：PASS；
- Order approval regression：PASS。

### 7.2 Contract 独立回归

`node apps/api/scripts/w363-contract-http-smoke.mjs`

在 **61 migrations + Seed** 下：

- direct CRUD / stage / DataScope；
- CREATE / UPDATE / DELETE approval；
- reject / revoke rollback；
- batch approval；
- 旧 `/contracts` 主 REST 404；
- 全部 PASS。

### 7.3 空库

`pnpm smoke:w366-empty-db`

- **61/61 migrations**；
- Seed #1：PASS；
- Seed #2：PASS；
- seed counts stable：PASS；
- API production build：PASS；
- demo login / module forms / stage configs / runtime resources：PASS。

## 8. 全局门禁

- API Rules：**121/121**，0 fail；
- Root Smoke：**227/227**，0 fail；
- workspace typecheck：PASS；
- workspace lint：PASS；
- Shared / API / Web production build：PASS；
- Prisma validate：PASS；
- `git diff --check`：PASS；
- `/system/modules` Browser Smoke：**47/47**，5xx=0，Runtime exception=0。

## 9. 结论

W3.7-9.3B 已满足关闭条件，可标记 `VERIFIED`。

下一执行单元是 **W3.7-9.3C：节点退回 + ApprovalReturnBackRecord + nodeRound 重建**。在 9.3C / 9.3D / 9.3E 完成前，DB-011 总任务仍保持未关闭。
