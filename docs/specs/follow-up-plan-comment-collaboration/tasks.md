# PLAN-COMMENT-001 跟进计划评论协同任务

状态：`VERIFIED`

- [x] A. Cordys 源码与当前实现审计。
  - [x] A1 Comment/Mention DDL 与 `commentCount`。
  - [x] A2 `BaseCommentService` + Plan adapter + Controller。
  - [x] A3 6 个 FollowPlan 评论通知事件。
  - [x] A4 PC/Mobile `CrmComment` 资源复用。
  - [x] A5 冻结 requirements/design/source-audit/tasks。

- [x] B. 数据模型与 shared 契约。
  - [x] B1 FollowUpPlan `commentCount` + Comment/Mention Prisma 模型，并重建 pre-release baseline。
  - [x] B2 FollowUpPlan VO 暴露 `commentCount`。
  - [x] B3 新增 6 个 FollowPlan 评论 MessageTaskEvent 并 Seed MessageSettings。

- [x] C. 后端评论共享内核与 Plan adapter。
  - [x] C1 从 Record Comment 提取资源无关公共规则，禁止复制整套逻辑。
  - [x] C2 FollowUpPlansService 暴露 `assertPlanAccess()`，保持 collaborator/DataScope 真实边界。
  - [x] C3 Plan Comment page/add/update/delete + OperationLog。
  - [x] C4 负责人、@成员、回复通知与 commentCount 事务真相源。
  - [x] C5 Rules + Service Smoke。

- [x] D. PC runtime。
  - [x] D1 `FollowCommentPanel/useFollowComments` 资源化为 Record/Plan 共用。
  - [x] D2 FollowUpPlan 卡片展示 commentCount 和折叠评论面板。
  - [x] D3 Customer/Lead/Opportunity/全局 FollowPlan 入口回归。

- [x] E. Mobile runtime。
  - [x] E1 Mobile FollowPlan 评论查看/新增/回复/@成员/编辑/删除。
  - [x] E2 Mobile commentCount 实时刷新。

- [x] F. 最终验收与封板。
  - [x] F1 PC/Mobile Browser Smoke + FollowRecord Comment 回归。
    - PLAN-COMMENT-001 专项 Browser 50/50 PASS；FollowRecord 46/46、Customer 23/23、Lead 20/20、Opportunity 18/18、FollowPlan PC/Mobile 25/25 PASS。
  - [x] F2 baseline reset + seed + validate/diff + 原生结构检查。
    - 唯一 `20260905084900_baseline` reset + seed PASS；Prisma validate PASS；DB→Schema `No difference detected.`；6 条 partial unique index 与 5 条 Plan Comment index 全部存在；fresh DB Service Smoke 20/20 PASS。
  - [x] F3 API Rules + root typecheck/build/lint + Prettier + `git diff --check`。
    - API Rules 222/222 PASS；root typecheck/build PASS；lint 0 error / 8 个既有 warning；当前 tracked + untracked 变更集 Prettier check PASS；`git diff --check` PASS。
  - [x] F4 parity/project-progress/alignment-log/spec index 文档封板。
