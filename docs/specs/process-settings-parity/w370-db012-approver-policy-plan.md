# W3.7-9.4B DB-012 审批人异常策略实施计划

计划封板日期：2026-09-02

源码结论见：[W3.7-9.4B 审批人异常策略源码审计](./w370-db012-approver-policy-audit.md)。

## 1. 目标

在不进入 9.4C～9.4F UI/字段权限/Webhook 范围的前提下，使 FlowVersion 中的审批人异常配置成为真实运行时能力，并保持 9.4A 条件图与 DB-011 task/record/round 主链不回归。

## 2. 数据模型

Migration 65：

- `ApproverType` 增加 `MULTIPLE_DEPT_LEADER / MULTIPLE_DIRECT_LEADER`；
- 新增 `EmptyApproverAction / SameSubmitterAction / ApproverDirection`；
- `ApprovalNodeApprover` 增加 `emptyApproverAction / fallbackApprover / sameSubmitterAction / approverDirection`；
- `ApprovalRecord.taskId` 改为 nullable，使没有人工 task 的节点自动通过也能留下独立记录。

项目未发布，本计划不增加历史 backfill 或旧实例兼容分支。

## 3. 配置契约

- Shared、DTO、Flow detail/write contract 同步扩展策略字段。
- 层级审批类型使用 `approverIds[0]` 保存 1～10 的层级值，避免额外引入与 Cordys 无对应关系的第二个层级字段。
- 非 `AUTO_PASS` empty action 必须提供有效 fallback 用户。
- USER/ROLE/fallback 引用均做 tenant/ACTIVE 校验。
- 解除 `SEQUENTIAL_ALL / EACH` 的运行时占位门禁；`allowBatchProcess` 仍保持 fail-closed，留待后续真实实现。

## 4. Runtime 顺序

严格按 Cordys 顺序：

1. 解析静态/角色/直属上级/部门负责人及方向；
2. empty approver；
3. sameSubmitter；
4. duplicate rule；
5. 创建当前 nodeRound 的 APPROVAL/CC/SKIPPED task 或 automatic ApprovalRecord；
6. 继续现有 `advance()` / DB-011 round 主链。

自动通过节点必须写 ApprovalRecord；有明确被跳过审批人时同时保留 SKIPPED task，以便详情和历史判断有真实依据。

## 5. 回归边界

- 9.4A 的 CONDITION/DEFAULT path 解析和冻结不得改变；
- DB-011 的 add-sign、BACK、approver revoke、requireComment、attachments 不得改变；
- 旧 Smoke 若业务意图是“提交人必须手工审批自己”，测试夹具应显式使用 `sameSubmitterAction=ALLOW`，不得为测试回退生产默认 `SKIP`；
- Flow detail → update 的测试 helper 必须 round-trip 9.4B 策略字段，避免测试保存动作意外重置配置。

## 6. 验收门槛

- 9.4B isolated HTTP：empty auto pass/record、fallback、sameSubmitter、direction、三种 duplicate rule；
- 9.4A isolated HTTP regression；
- DB-010 regression；
- DB-011 9.3A～E regression；
- Rules；
- Root Smoke；
- 空库全 migrations + 双 Seed 幂等；
- workspace typecheck/lint/build；
- Prisma validate；
- `git diff --check`。

9.4B 不开放新的流程设计 UI，因此不新增 Browser Smoke；9.4A 已有高级图只读 Browser 继续作为当前 UI 防覆盖基线，完整高级设置 UI 仍由 9.4F 统一开放。

