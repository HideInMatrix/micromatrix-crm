# PLAN-COMMENT-001 跟进计划评论协同设计

状态：`VERIFIED`

## 1. 设计原则

Cordys 用 `BaseCommentService` 统一 Record/Plan 评论语义。MicroMatrix 已在 FOLLOW-001 完成一套经过 Service/Browser 验证的 Record 评论实现，因此本单元不复制整份 `FollowCommentsService`，而是把公共规则抽成资源无关的评论内核，再由 Record/Plan adapter 提供差异。

公共内核负责：正文规范化、Mention 校验、两层回复校验、顶层分页 + replies 装配、创建人编辑/删除、count 重算、用户信息装配、通知收件人合并与 OperationLog result metadata。

资源 adapter 负责：

- 评论/Mention Prisma delegate；
- `assertResourceAccess`；
- `commentCount` 更新目标；
- 资源 owner / targetType / targetId；
- Added / Mentioned 事件、通知标题与链接。

## 2. 数据模型

`FollowUpPlan` 增加：

```text
commentCount Int @default(0)
comments FollowUpPlanComment[]
```

新增 `FollowUpPlanComment` 与 `FollowUpPlanCommentMention`，字段、索引和级联关系与 `FollowUpRecordComment*` 一致，表名分别为：

```text
follow_up_plan_comment
follow_up_plan_comment_mention
```

当前项目尚未发布，因此直接重建 single baseline，不新增“升级兼容 migration”。

## 3. API

新增 Nest controller：

```text
POST   /follow/plan/comment/page
POST   /follow/plan/comment/add
POST   /follow/plan/comment/update
DELETE /follow/plan/comment/:id
```

DTO/VO 继续复用 FOLLOW-001 的 `FollowCommentPageDto / AddFollowCommentDto / UpdateFollowCommentDto` 与 `FollowCommentVO / FollowCommentPageVO`，因为 Cordys 两类资源也是同一请求/响应语义。

## 4. FollowPlan 权限 adapter

`FollowUpPlansService` 暴露正式 `assertPlanAccess(user, id, write=false)`：

1. tenant 内查询计划；
2. 复用既有 `assertTargetAccess`；
3. customer collaborator-only 场景保持当前 FollowPlan `get()` 的创建人限制，不因评论接口扩大读取面；
4. 评论本身不要求计划负责人身份，读得到资源即可评论；只有计划 CRUD 继续走 `ensureManageablePlan`。

## 5. 通知事件

新增 shared `MessageTaskEvent`：

```text
CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED
CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED
CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED
CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED
OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED
OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_MENTIONED
```

Message Settings 目录与 Seed 同步加入。通知 owner 使用 `plan.ownerId`；target name/link 由计划的 targetType/targetId 解析，分别进入客户、线索、商机真实页面。

## 6. 前端复用

现有 `FollowCommentPanel / FollowCommentEditor / FollowCommentItem` 不再绑定 `recordId`，改为：

```text
resourceType: 'record' | 'plan'
resourceId: string
members: MemberOption[]
```

`useFollowComments` 根据 resourceType 选择 `followRecordCommentApi` 或 `followPlanCommentApi`。评论编辑器/列表 item 不感知业务资源类型。

PC `FollowUpPlanPanel` 在每张计划卡片下提供和 Record 一致的折叠评论区域与 `commentCount`。Mobile FollowPlan 使用同一 API 契约，采用 Vant 展开层实现，不改变 Plan CRUD/action sheet 语义。

## 7. 验收门槛

- Rules 必须增加 Plan 评论语义与 FollowRecord 回归。
- Service Smoke 必须使用真实 Nest + PostgreSQL + Notifications。
- Browser Smoke 必须真实覆盖 PC/Mobile；只改测试脚本适配当前架构，不改业务 UI 迎合旧选择器。
- 最终重新生成 pre-release baseline，并检查 DB -> schema `No difference detected.`。
