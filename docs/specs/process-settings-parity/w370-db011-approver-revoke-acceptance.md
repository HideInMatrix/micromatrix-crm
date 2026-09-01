# W3.7-9.3D DB-011 审批人任务撤回专项验收

验收日期：2026-09-01

## 1. 关闭范围

本轮只关闭 **9.3D 审批人任务撤回**，不提前关闭 DB-011；9.3E `requireComment` 与 `ApprovalInstanceAttachment` 仍保持未完成。

源码审计见：[w370-db011-approver-revoke-audit.md](./w370-db011-approver-revoke-audit.md)。

## 2. Runtime 结论

- 新增独立 `POST /approvals/tasks/:id/revoke`，与 submitter cancel 分离。
- 仅本人已通过的普通审批 task 可进入撤回判定：tenant/owner、`taskType=APPROVAL`、`status=APPROVED`、`action=APPROVE`、实例仍 `PENDING`、flow `allowWithdraw=true`、冻结 nodeId 和后续节点状态均由服务端硬校验。
- Cordys `REVOKE` 只用于日志/通知，撤回后的 task `action=null`；因此本轮没有新增 `ApprovalTaskAction.REVOKE`，也没有数据库 migration。
- 合法撤回复用原 task/node/round：恢复 `PENDING + action=null + handledAt=null`，下游仍活动的待办变为 `SKIPPED`，实例 currentNodeIndex 回到原节点；再次推进时下游使用新的 nodeRound。
- `ALL` 仅允许同节点该轮仍有活动待办时撤回；`ANY`/单人路径只允许后继当前审批节点尚未产生已完成动作时撤回。已经跨过完成的中间审批节点、已结束实例、旧历史 task 均 fail-closed。

## 3. ApprovalRecord 语义

撤回本身不制造 REVOKE ApprovalRecord，也不删除原 APPROVE record。

为闭环 Cordys 的“同一 task/node/round 可重新执行”语义，本轮同时收口 `saveApprovalRecord()`：

- 撤回后再次 APPROVE 且没有新意见：保留既有 record，不重复插入；
- 有新意见再次 APPROVE：删除同 task/node/round 旧 record 后创建新 record；
- 撤回后改为 REJECT：同样先删除旧 record 再创建新的 REJECT record。

因此同一个执行槽位不会因为撤回重审出现重复 ApprovalRecord。

## 4. API / PC / Mobile

- ApprovalInstanceVO 新增 `canWithdraw`、`myWithdrawTaskId`。
- 流程配置 `allowWithdraw` 已解除 422 未实现门禁；其它未完成高级配置继续 fail-closed。
- PC 审批中心在“我已处理”详情显示“撤回审批”。
- Mobile 审批中心补齐“我已审批”数据源，并在详情展示“撤回审批”。
- UI capability 只控制展示，API 仍完整重新校验 tenant/owner/runtime 状态。

## 5. 专项验收

### 5.1 Isolated HTTP Smoke

`pnpm smoke:w370-db011-approver-revoke`：PASS。

真实隔离数据库从零执行 **62/62 migrations + Seed + API build**，覆盖：

- `allowWithdraw` 配置可保存；
- 非 owner 撤回 404；
- flow 实时关闭 `allowWithdraw` 后服务端 400；
- 原 task 同 ID / 同 round 回开；
- 下游旧 PENDING task 变 `SKIPPED`；
- REVOKE 本身保留原 ApprovalRecord；
- 有新意见重审时 ApprovalRecord delete+create 且不重复；
- 无新意见再次同意时保留旧 ApprovalRecord；
- 下游节点以 round 2 重建；
- 跨过已完成中间节点后旧 task 不可撤回；
- 实例结束后不可撤回；
- 最终审批仍可正常完成。

### 5.2 Browser Smoke

`pnpm smoke:w370-db011-approver-revoke-browser`：**24/24 PASS**。

- PC“我已处理”真实打开详情、确认撤回并调用 revoke API；
- Mobile“我已审批”真实打开详情并调用同一 revoke API；
- 两端都验证原 task 回开与下游旧 round 失效；
- Browser Runtime exception：0；
- Browser API 5xx：0。

### 5.3 Rules / Regression / Build

- API Rules：**125/125 PASS**；
- 9.3B add-sign HTTP regression：PASS；Browser regression：**17/17 PASS**；
- 9.3C return-back HTTP regression：PASS；Browser regression：**17/17 PASS**；
- DB-010 approval regression：PASS；
- Root Smoke：**227/227 PASS**；
- `/system/modules` Browser：**47/47 PASS**，API 5xx=0、Runtime exception=0；
- workspace typecheck：PASS；
- ESLint：PASS；
- Shared + API + Web production build：PASS；
- Prisma validate：PASS。

## 6. 关闭结论

W3.7-9.3D 已满足关闭条件，可标记完成。

DB-011 当前进度：

- 9.3A ✅ Task / ApprovalRecord
- 9.3B ✅ BEFORE / AFTER 加签
- 9.3C ✅ 节点退回 / ReturnBackRecord / round rebuild
- 9.3D ✅ 审批人任务撤回
- 9.3E ⬜ requireComment / ApprovalInstanceAttachment

下一执行单元：**W3.7-9.3E requireComment + ApprovalInstanceAttachment**。9.3E 完成并通过专项/回归验收后，DB-011 才能更新为 `VERIFIED`。
