# PLAN-COMMENT-001 Cordys 源码审计

状态：`VERIFIED`

## 1. 后端模型

审计文件：

- `backend/crm/.../migration/1.9.0/ddl/V1.9.0_2__ga_ddl.sql`
- `follow/domain/FollowUpPlanComment.java`
- `follow/domain/FollowUpPlanCommentMention.java`
- `follow/service/BaseCommentService.java`
- `follow/service/FollowUpPlanCommentService.java`
- `follow/controller/FollowUpPlanCommentController.java`
- `follow/mapper/ExtCommentMapper.xml`
- `follow/mapper/ExtFollowUpPlanMapper.xml`

事实：

- FollowPlan/FollowRecord 同时增加 `comment_count`，含回复。
- 两套 Comment/Mention 是独立物理表、同构结构；业务逻辑共用 `BaseCommentService`。
- `BaseCommentService.page()` 只分页 `parentId=null`，再批量取 children，最后单独 count 全部评论。
- add/update/delete 都会维护 Mention 和 commentCount；顶层删除同时删除直接 children。
- update/delete 只允许 comment creator。
- Plan adapter 仅切换 targetType=PLAN、表、通知事件、commentCount mapper 和资源 owner/name。

## 2. 权限

`FollowUpPlanCommentController.page/add` 在进入评论 service 前调用 `FollowUpPlanService.checkPlanPermission(..., read=true)`；因此评论不是“只要知道 planId 就可访问”的旁路接口。

MicroMatrix 应暴露 `assertPlanAccess()` 复用现有 FollowPlan target access，不重新写一套简化权限。

## 3. 通知

Cordys `FollowUpPlanCommentService` 明确区分：

- `CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED / MENTIONED`
- `CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED / MENTIONED`
- `OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED / MENTIONED`

普通评论先通知资源 owner；Mention/replyToUser 合并为 mentioned 集合；owner 若已在 mentioned 中不再走普通 added 通知。

## 4. PC/Mobile

审计：

- Web `crm-comment/useCommentResource.ts`
- Web `crm-follow-drawer/components/detailDrawer.vue`
- Web `crm-follow-detail/*`
- Mobile `crm-comment/useCommentResource.ts`

事实：两端 Comment UI 都按资源类型选择 API，FollowPlan 与 FollowRecord 共用组件，不存在第二套 Plan 专属评论交互。详情打开时用资源 VO 的 `commentCount` 初始化计数，展开后以 page 返回值刷新。

## 5. 与 MicroMatrix 当前差异

- FOLLOW-001 已有 Record Comment/Mention、两层回复、通知、commentCount 和 PC 评论组件。
- FollowUpPlan 当前没有 `commentCount` 和 Plan Comment/Mention 表/API。
- Web `FollowCommentPanel/useFollowComments` 仍硬编码 Record API，尚未资源化。
- PC/Mobile FollowPlan 都没有评论入口。
- shared MessageTaskEvent 仅有 Record 评论六事件，Plan 评论六事件尚未登记。

## 6. 结论

PLAN-COMMENT-001 的正确实现不是复制 Record Comment service，而是先抽共享评论内核，再增加 Plan adapter 和 PC/Mobile 资源接入。三套 FollowPlan FormDesign 上下文布局不属于评论模型，继续作为后续独立差异保留。

## 7. MicroMatrix 最终落地事实

- FollowUpPlan 已具备 `commentCount`、独立 Comment/Mention 表和数据库级级联关系，并进入唯一 pre-release baseline。
- FollowRecord / FollowPlan 评论已共用 `FollowCommentServiceBase`，两类资源只保留访问校验、Prisma delegate、事件和计数目标差异。
- Plan Comment API、OperationLog、负责人通知、Mention/reply 通知和 MessageSettings Seed 已完成；真实 Service Smoke 20/20 PASS。
- PC FollowPlan 卡片与 Mobile FollowPlan action sheet 均消费共享评论契约；专项 PC/Mobile Browser Smoke 50/50 PASS。
- FollowRecord 46/46、Customer 23/23、Lead 20/20、Opportunity 18/18、FollowPlan 25/25 相邻 Browser 回归均通过。
- 最终 baseline reset + seed、Prisma validate/diff、6 条 partial unique index 与 5 条 Plan Comment index 实查通过；API Rules 222/222、root typecheck/build、lint、Prettier 与 `git diff --check` 全绿。
