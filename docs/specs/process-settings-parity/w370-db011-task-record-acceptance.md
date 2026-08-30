# W3.7-9.3A DB-011 Task / ApprovalRecord 基座专项验收

验收日期：2026-08-30

## 1. 关闭范围

本轮只关闭 **9.3A Task / ApprovalRecord 基座**，不提前实现或开放 9.3B~9.3E。

关闭目标：

- ApprovalTask 建立稳定 `nodeId`、`nodeRound`、`taskType`、`action` 语义；
- 新实例冻结真实流程节点 ID，历史实例没有稳定 nodeId 时保持 `null`，不使用 `nodeIndex` 伪造 ID；
- 新增独立 `ApprovalRecord` 作为审批动作事实；
- approve / reject 不再把审批意见写回 task；
- 历史 APPROVED / REJECTED task 的旧 comment 自动迁移为 ApprovalRecord；
- 历史迁移完成后删除 `approval_tasks.comment`，避免 task / record 长期双真相源；
- API VO 保持当前前端兼容：`task.comment` 由对应 record 派生，同时返回 records/action/nodeRound/nodeId；
- `SIGN / BACK` 只建立 task/action enum 基座，本轮不开放加签、退回按钮或 runtime。

## 2. 数据模型与 Migration 60

Migration：`20260830210000_w370_approval_task_records`

### 2.1 ApprovalTask

- `node_id`：nullable，历史任务无真实节点 ID 时保持空；
- `node_round`：默认 1；
- `task_type`：增加 `SIGN / BACK`；
- `action`：`APPROVE / REJECT / SIGN / BACK`；
- 删除旧 `comment`；
- 增加 `updated_at` 与 `(instance_id, node_index, node_round)` 索引。

### 2.2 ApprovalRecord

独立表 `approval_records` 保存不可变动作事实：

- tenant / instance / task；
- `nodeId`；
- `nodeRound`；
- `result`；
- `comment`；
- `createdById`；
- created / updated timestamp。

### 2.3 历史升级

Migration 60 在删除旧 task comment 前完成历史回填：

- APPROVED task -> `action=APPROVE` + ApprovalRecord；
- REJECTED task -> `action=REJECT` + ApprovalRecord；
- 旧 comment 搬入 record.comment；
- 历史 `nodeId` 不从 `nodeIndex` 伪造，保持 nullable；
- 回填完成后物理删除 `approval_tasks.comment`。

`default` 数据库已实际执行 migration 60，当前 **60/60 migrations successfully applied**。

## 3. Runtime

### 3.1 新实例节点身份

审批实例冻结节点快照时写入真实流程节点 `nodeId`。创建 APPROVAL / CC task 时从冻结快照写入 `nodeId`，并显式写 `nodeRound=1`。

历史 `nodesSnapshot` 没有 `nodeId` 的实例继续兼容 `null`，不会把数组下标或 `nodeIndex` 当作稳定 ID。

### 3.2 approve / reject

approve：

- task -> `status=APPROVED`；
- task -> `action=APPROVE`；
- 同事务创建 `ApprovalRecord(result=APPROVE)`；
- comment trim 后只写 record，不再写 task。

reject：

- 继续要求非空审批意见；
- task -> `status=REJECTED`；
- task -> `action=REJECT`；
- 同事务创建 `ApprovalRecord(result=REJECT)`；
- 保留原有其它待办 skip、实例 REJECTED、资源状态恢复和 UPDATE snapshot rollback 行为。

### 3.3 API 兼容

instance detail：

- task 返回 `nodeId / nodeRound / taskType / action`；
- 返回独立 `records[]`；
- 为兼容现有前端时间线，`task.comment` 从该 task 对应的最新 ApprovalRecord 派生；
- production schema / runtime 不再把 ApprovalTask.comment 作为持久化真相源。

## 4. 专项验收

### 4.1 Migration 60 历史升级 Smoke

命令：

`pnpm --filter @micromatrix/api smoke:w370-db011-task-record-migration`

结果：PASS。

断言：

- `legacyTaskCommentRemoved=true`；
- 历史意见迁移 **2/2**；
- APPROVED / REJECTED action 正确回填；
- 历史 `nodeId` 保持 nullable；
- task type enum 包含 `APPROVAL / CC / SIGN / BACK`；
- 新 Prisma Client 可真实创建 ApprovalRecord。

### 4.2 Rules

9.3A 新增核心规则：

- approve 写 `task.action + ApprovalRecord`，意见不再回写 task；
- reject 与 ApprovalRecord 在同一事务写入，并保留 node / round。

完整 API Rules：**121/121 PASS，0 fail**。

## 5. 四业务隔离回归

所有隔离库均从零应用 **60 migrations + Seed**。

### 5.1 DB-010 通用审批回归

`pnpm smoke:w370-db010-regression`

- generic UPDATE snapshot lifecycle：PASS；
- tenant restore fail-closed：PASS；
- Quotation CREATE / UPDATE reject / revoke / DELETE：PASS；
- Invoice approval regression：PASS；
- Order approval regression：PASS。

### 5.2 Contract 现行 direct API 回归

`node apps/api/scripts/w363-contract-http-smoke.mjs`

- 60 migrations + Seed：PASS；
- `/contract/*` direct CRUD / DataScope / stage：PASS；
- CREATE / UPDATE / DELETE approval：PASS；
- UPDATE reject / revoke rollback：PASS；
- batch approval：PASS；
- 旧 `/contracts` 主 REST 预期保持 404：PASS。

旧 `w363-contract-approval-http-smoke.mjs` 仍调用已退出的 `/contracts` 主 REST，且没有任何脚本引用；本轮已删除，统一由现行 direct smoke 覆盖，避免保留失效验收代码。

## 6. 空库与工程质量

`node apps/api/scripts/w366-empty-db-smoke.mjs`：

- **60/60 migrations**：PASS；
- Seed #1：PASS；
- Seed #2：PASS；
- 第二次 Seed 后关键计数稳定：PASS；
- Shared / API / Web runtime 基础资源：PASS；
- 脚本内 API production build：PASS。

全局门禁：

- Root Smoke：**227/227 PASS**；
- workspace typecheck：PASS；
- workspace ESLint：PASS；
- Shared / API / Web production build：PASS；
- Prisma validate：PASS；
- `git diff --check`：PASS。

## 7. 能力门禁

9.3A 只建立高级动作的数据基座：

- `SIGN` enum 存在不代表加签已实现；
- `BACK` enum 存在不代表退回已实现；
- `allowAddSign / allowWithdraw / requireComment / allowBatchProcess` 不因本轮完成而提前开放；
- BEFORE / AFTER 加签、嵌套加签链、节点退回、审批人任务撤回、附件继续分别由 9.3B~9.3E 实现和验收。

## 8. 结论

**W3.7-9.3A 已满足关闭条件，可标记完成。**

下一执行单元：**9.3B BEFORE / AFTER 加签与嵌套加签链**。开始 9.3B 前继续遵循“先 Cordys 源码证据，再实施计划，再 runtime / Rules / Smoke”的顺序。
