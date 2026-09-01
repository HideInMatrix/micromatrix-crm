# W3.7-9.3C DB-011 节点退回专项验收

验收日期：2026-09-01

## 1. 关闭范围

本轮关闭：

- `ApprovalReturnBackRecord` direct model；
- `POST /approvals/tasks/:id/back`；
- BACK 动作审计；
- 历史节点合法目标解析；
- `nodeRound` 退回及再次前进重建；
- PC / Mobile 退回入口；
- Rules / HTTP / Browser / Root / Empty DB / workspace 全量回归。

不关闭：

- 9.3D 审批人任务撤回；
- 9.3E `requireComment`、审批附件；
- DB-012 条件节点、动态审批人、字段权限、Webhook。

## 2. 数据库

Migration 62：`20260901094500_w370_approval_return_back`

新增 `approval_return_back_records`：

- tenant / instance / task / return target / reason / user；
- `instance_id + return_to_node_id` 唯一；重复退回同一目标时在事务内先删除旧记录再插入新记录，严格保持 Cordys “同目标仅保留最新退回记录”语义；
- instance/task 外键级联清理；
- task / record 历史轮次不被覆盖。

当前 `default` 已实际 deploy 到 **62 migrations**。由于该 checkout 的本地开发库在恢复代码后仍停留旧 migration/Seed 基线，本轮同步执行新版 Seed 后 Root Smoke 恢复到完整基线；这属于开发环境升级，不是业务代码兼容绕行。

## 3. Runtime

`ApprovalsService.returnBackTask()` 已验证：

- owner / tenant / PENDING instance fail-closed；
- SIGN 不能直接 back；
- 只接受冻结版本中的已执行历史节点；
- 当前/未来/伪造 nodeId 均拒绝；
- 源任务写 `action=BACK`，不生成 ApprovalRecord；
- 区间旧活动任务退出待办；
- 目标节点审批人和 CC 重新建立新 round；
- 同一目标重复退回时删除旧 ReturnBackRecord 并创建新记录，record id / createdAt 均代表最新一次 BACK；
- `currentNodeIndex` 回到目标节点。

同时修复普通 `advance()`：节点再次进入时统一使用 `max(task round, record round) + 1`。ALL/ANY sibling 判断限定当前 round，旧轮次不会阻塞新轮次。

## 4. 专项 HTTP Smoke

命令：

```text
pnpm smoke:w370-db011-return-back
```

结果：PASS / exit 0。

隔离库从零 **62/62 migrations + Seed + API build/start**，覆盖：

- valid BACK；
- fake target gate；
- current node gate；
- non-owner gate；
- repeated BACK gate；
- `ApprovalReturnBackRecord` latest-only；
- BACK 不生成 ApprovalRecord；
- round 1 -> 2 -> 3 连续重建；
- 历史 ApprovalRecord 不可变；
- 两次退回后最终仍可正常 APPROVED。

## 5. Browser Smoke

命令：

```text
pnpm smoke:w370-db011-return-back-browser
```

结果：**17/17**。

真实 PC 页面验证：

- 首节点无退回入口；
- 二级审批获得合法历史目标；
- 审批详情显示“退回节点”；
- 弹窗显示“一级审批 / 重新进入第 2 轮”；
- 可填写退回原因；
- UI 真实调用 `/api/approvals/tasks/:id/back`；
- ReturnBackRecord 写入成功；
- 一级审批 round 2 真实生成；
- API 5xx=0；
- Runtime exception=0。

9.3B 加签 Browser 随后复跑继续 **17/17**。

## 6. Rules 与高级审批回归

API Rules：**123/123**。

新增锁定：

- 节点再次进入时 round 取 task/record 最大值 + 1；
- pending task 强制 tenant/owner/status/instance gate，并拒绝已执行 BACK 的旧任务。

9.3B add-sign HTTP 在 62 migrations 环境继续 PASS，BEFORE / AFTER / nested / owner / tenant / ALL sibling 均未回归。

DB-010 regression 在 **62 migrations** 隔离库继续 PASS：generic snapshot lifecycle、跨租户 restore fail-closed、Quotation / Invoice / Order approval 全绿。

## 7. 全局验收

- Root Smoke：**227/227**。
- Empty DB：**62/62 migrations + Seed #1 + Seed #2**，`seedCountsStable=true`。
- Empty DB runtime：三演示角色、七 module form、三 stage config、七 direct resource 全绿。
- `pnpm typecheck`：PASS。
- `pnpm lint`：PASS。
- `pnpm build`：PASS。
- Prisma validate：PASS。

Root Smoke 首次业务复跑曾出现 5 个 Payment/Invoice/Customer360 失败；核对后确认当前 checkout 的 `default` 在一次性升级后尚未执行新版 Seed。补执行当前 Seed 后相同 Root Smoke **227/227**。未修改回款/发票业务代码，也未放宽任何断言。

## 8. 结论

**W3.7-9.3C 已满足关闭条件。**

DB-011 总任务仍保持 `IN_PROGRESS`：

- 9.3A ✅ Task / ApprovalRecord
- 9.3B ✅ BEFORE / AFTER 加签
- 9.3C ✅ 节点退回 / ReturnBackRecord / round rebuild
- 9.3D ⬜ 审批人任务撤回
- 9.3E ⬜ requireComment / Attachment

下一执行单元：**W3.7-9.3D 审批人任务撤回**。
