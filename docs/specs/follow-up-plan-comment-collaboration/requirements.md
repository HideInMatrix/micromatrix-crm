# PLAN-COMMENT-001 跟进计划评论协同需求

状态：`VERIFIED`

## 1. 目标

在 DB-021 已完成 FollowUpPlan 正式 ModuleForm + Field/Blob、PC/Mobile 动态字段往返的基础上，补齐 Cordys FollowUpPlan 评论协同闭环：顶层评论、二级回复、@成员、评论总数、通知与操作日志，并让 PC/Mobile FollowPlan runtime 消费同一评论契约。

本单元不复制 FOLLOW-001 已经完成的评论语义，也不新增兼容层。评论公共规则应抽到共享内核，FollowRecord 与 FollowPlan 只保留资源访问、Prisma 表和通知事件差异。

## 2. Cordys 事实基线

- `follow_up_plan.comment_count` 为非空计数真相源，包含顶层评论与回复。
- `follow_up_plan_comment` 与 `follow_up_record_comment` 字段同构；`follow_up_plan_comment_mention` 保存 @成员关系。
- Plan/Record 评论共用 `BaseCommentService`：顶层分页、二级回复批量装配、Mention、创建人编辑/删除、父评论删除级联回复并重算 `commentCount`。
- 评论读取/新增必须先经过 FollowUpPlan 资源访问校验；编辑/删除还必须满足评论创建人边界。
- 评论新增通知资源负责人；@成员与 replyToUser 进入 mentioned 通知集合并排除操作者。
- 按目标资源分为 CUSTOMER / CLUE / OPPORTUNITY 三组 Plan Comment Added / Mentioned 事件。
- PC `CrmComment` 以 `followPlan` / `followRecord` 资源类型复用同一 UI runtime；FollowPlan 列表/详情 VO 直接携带 `commentCount`。

## 3. 功能需求

### R1. 数据模型

- FollowUpPlan 增加 `commentCount`，默认 0。
- 新增 `FollowUpPlanComment` 与 `FollowUpPlanCommentMention`，与 FollowRecord 评论表保持同构字段和级联关系。
- 评论删除、计划删除必须由数据库关系保证评论/Mention 清理，不保留孤儿。

### R2. 评论 API

- 提供 `/follow/plan/comment/page|add|update` 与删除接口。
- page 只分页顶层评论；回复一次批量装配；返回 `commentCount`。
- 仅允许两层结构；replyToUser 必须属于当前租户 ACTIVE 用户。
- @成员最多 100 人，只接受当前租户 ACTIVE 用户。
- 后端正文上限保持 3000；Web/Mobile 编辑器交互上限保持 300。

### R3. 权限与日志

- page/add 必须复用 FollowUpPlan 当前真实读取权限，不绕过客户协作、Pool/DataScope、线索/商机数据范围。
- update/delete 只能由评论创建人执行，并再次确认资源仍可访问。
- Add/Update/Delete 必须写 FollowPlan 模块 OperationLog，日志记录评论内容 before/after 与 commentId。

### R4. 通知

- 新增并 Seed 6 个 FollowUpPlan 评论事件：CUSTOMER / CLUE / OPPORTUNITY 各 Added + Mentioned。
- 普通评论通知计划负责人；@成员与回复对象使用 Mentioned 事件；操作者排除。
- 通知链接必须指向真实 FollowPlan 可访问入口，不新增不存在的页面。

### R5. PC/Mobile runtime

- PC FollowUpPlan 卡片/详情复用现有 Comment UI 内核，按计划资源 ID 读写 Plan 评论。
- FollowUpPlan VO 返回 `commentCount`，UI 在未展开评论前即可展示真实计数。
- Mobile FollowPlan 同样可查看/新增/回复/@成员/编辑/删除评论，不复制第二套业务语义。

### R6. 验收

- Service Smoke 覆盖评论 CRUD、回复层级、Mention、权限、通知、commentCount 与计划删除级联。
- Browser Smoke 覆盖 PC 与 Mobile 的评论展开、新增、回复、@成员、计数更新。
- 回归 FollowRecord 评论、FollowPlan PC/Mobile、Customer/Lead/Opportunity。
- pre-release baseline reset + seed + Prisma validate/diff、Rules、root typecheck/build/lint、Prettier、`git diff --check` 全绿后才可 VERIFIED。

## 4. 明确非目标

- Cordys CUSTOMER/BUSINESS/CLUE 三套 FollowPlan FormDesign 上下文布局与布局编辑器。
- 新增独立 FollowPlan 评论中心页面。
- 为错误旧数据增加兼容表、兼容 API 或双写逻辑。
