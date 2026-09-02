# W3.7-9.4B DB-012 审批人异常策略专项验收

验收日期：2026-09-02

## 1. 关闭范围

本次关闭 DB-012 9.4B：

- empty approver：AUTO_PASS / ASSIGN_SPECIFIC / ASSIGN_ADMIN；
- fallback approver；
- sameSubmitter：SKIP / ALLOW / ASSIGN_SUPERIOR；
- BOTTOM_UP / TOP_DOWN 动态审批方向；
- 单级与连续多级直属上级/部门负责人；
- duplicate rule：FIRST_ONLY / SEQUENTIAL_ALL / EACH；
- 自动通过节点的 ApprovalRecord 审计事实。

9.4C 字段权限、9.4D 后置字段更新、9.4E Webhook、9.4F 完整高级流程设计器仍未关闭，因此 DB-012 保持 `IN_PROGRESS`。

## 2. Schema 与配置契约

- Migration 65 新增 empty/same/direction 三组 enum，并扩展两种连续多级 approver type。
- `ApprovalNodeApprover` 真实持久化四个 9.4B 策略字段。
- `ApprovalRecord.taskId` 允许 null，用于 Cordys 同语义的无人工 task 自动审批记录。
- Flow write/detail、Shared 与 DTO 已完整 round-trip 新字段。
- 层级值限制 1～10；fallback 必须属于当前租户且为 ACTIVE 用户。
- `duplicateApproverRule` 的 `SEQUENTIAL_ALL / EACH` 已解除占位 422 gate 并进入真实 runtime。

项目没有发布历史数据，本次 migration 不包含旧配置 backfill，也没有增加旧 `nodesSnapshot` 兼容分支。

## 3. Runtime 语义

- runtime 固定执行：动态审批人解析 → empty → sameSubmitter → duplicate。
- AUTO_PASS 会自动推进并写 ApprovalRecord。
- ASSIGN_SPECIFIC / ASSIGN_ADMIN 使用配置的 fallback 用户；runtime 不猜管理员角色。
- SKIP 对单人/ANY 自动通过，对 ALL 只过滤提交人。
- ASSIGN_SUPERIOR 用直属上级替换提交人；不存在直属上级时自动通过。
- FIRST_ONLY 查询当前实例其他历史节点 APPROVED task。
- SEQUENTIAL_ALL 只读取紧邻上一节点当前最大 round 的 APPROVED task。
- EACH 不执行重复跳过。
- dynamic direction 同时适用于直属上级链和部门负责人链。

## 4. 9.4B isolated HTTP

`pnpm --filter @micromatrix/api smoke:w370-db012-approver-policy` 从隔离 PostgreSQL 执行 **65/65 migrations + Seed + Shared/API build**，结果 PASS：

```text
emptyAutoPass               PASS
emptyAutoRecord             PASS
fallbackApprover            PASS
fallbackReferenceGate       PASS
sameSubmitterSkip           PASS
sameSubmitterAssignSuperior PASS
directLeaderDirection       PASS
departmentLeaderDirection   PASS
duplicateFirstOnly          PASS
duplicateSequentialAll      PASS
duplicateEach               PASS
```

## 5. 相邻专项回归

- 9.4A Condition / DEFAULT isolated HTTP：PASS，实际 deploy **65 migrations**；graph round-trip、link.sort、DEFAULT、`NOT_EQUAL_ORIGINAL`、实例 path 冻结均保持。
- DB-010 regression：PASS，实际 deploy **65 migrations**；quotation/invoice/order CREATE/UPDATE/DELETE approval 回归全绿。
- DB-011 9.3A migration smoke：PASS。
- DB-011 9.3B add-sign、9.3C return-back、9.3D approver revoke、9.3E attachment/comment HTTP：PASS，当前隔离库均可在 **65 migrations** 下运行。
- 旧回归夹具中需要“提交人手工审批自己”的节点已显式声明 `sameSubmitterAction=ALLOW`；这只是测试业务意图收敛，没有改变生产默认 `SKIP`。
- DB-011 的 flowWrite 测试 helper 已补 9.4B 字段 round-trip，避免 detail→PUT 意外恢复默认值。

## 6. 全局封板证据

- Rules：**133/133 PASS**。
- Root Smoke：**227/227 PASS**。
- 默认开发库确认只缺 Migration 65；执行正常 `prisma migrate deploy` 后 Root 全绿，没有执行历史 backfill。
- 空库：**65/65 migrations + Seed 2/2**，计数幂等，7 类 runtime 资源验证 PASS。
- workspace typecheck：PASS。
- ESLint：PASS。
- Shared/API/Web production build：PASS；Web **4144 modules transformed**。
- Prisma validate：PASS。
- `git diff --check`：PASS。
- `/system/modules` Browser 继续沿用 9.4A 最近基线 **47/47**；9.4B 没有新增 UI 面，因此本单元不重复制造无关 Browser 测试。

## 7. 结论

W3.7-9.4B 已满足 schema、配置契约、runtime、审计、专项 API、相邻审批回归、Root、Rules、空库与静态构建封板要求，可以标记完成。

DB-012 继续 `IN_PROGRESS`。

下一执行单元：**W3.7-9.4C 节点字段权限和审批详情真实约束**。

