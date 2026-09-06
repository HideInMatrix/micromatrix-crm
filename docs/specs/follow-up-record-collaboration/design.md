# FOLLOW-001 跟进记录协同闭环设计

## 1. 设计原则

- 先把 FollowUpRecord 升级为正式资源，再在其上增加评论；不把评论挂在早期简化模型上。
- 复用现有 `ModuleForm / ResourceFieldValueService / UserView / Notifications / OperationLog / Attachment` 基座，不创建平行框架。
- 项目尚未正式发布，Schema 变更继续合并进单一 pre-release baseline；不做旧开发数据兼容双写、不保留旧模型 facade、不建立新旧数据互转层。
- 发现旧模型与 Cordys 最终语义冲突时，直接修改 Schema、DTO、Service、调用方和 Seed 到最终模型；允许重置开发库，不为了保留旧开发数据给后续留下双模型分叉。

## 2. 数据模型

FollowUpRecord 主表继续承担业务系统字段，增加正式资源需要的审计/协同字段；动态字段进入：

```text
follow_up_record_field
follow_up_record_field_blob
```

两张表使用 `resourceId + fieldId` 唯一键，并 FK cascade 到 FollowUpRecord。

评论使用两张资源表：

```text
follow_up_record_comment
follow_up_record_comment_mention
```

Comment 主字段：`resourceId / parentId / replyToUserId / content / tenantId / createdById / updatedById / createdAt / updatedAt`。Mention 只保存 `commentId + userId`，并对组合做唯一约束，防止重复 @。

## 3. FollowRecord ModuleForm

新增 `followRecord` formKey。系统字段至少覆盖：

- targetType / targetId
- ownerId
- contactId
- followedAt
- content
- method

`commentCount` 属于只读协同统计，不作为设计器可写字段。

ResourceFieldValueService 新增 `followRecord` resource type，所有 normal/blob validate/save/load/filter/delete 走同一公共路径。

## 4. 资源访问

- 指定 target 的记录查询先通过目标对象读取权限，再限定 `tenantId + targetType + targetId`。
- 全局 FollowRecord 页面按线索/客户/商机权限分别生成可见范围，不允许因为拥有任一模块 READ 就看到全部记录。
- 评论 page/add 先复用 FollowUpRecord 的 read gate；评论 update/delete 再叠加“评论创建人”限制。
- mention 服务端只接受当前租户有效成员，避免跨租户 userId 进入通知或回显。

## 5. 评论查询模型

顶层评论使用分页，取到当前页 parent IDs 后一次查询全部直接子评论，再一次批量查询 mention users，避免逐评论 N+1。

返回 `{ items, total, commentCount, page, pageSize }`，其中 total 是顶层评论数量，commentCount 是一级 + 二级总数。

删除顶层评论在事务中删除 parent + direct replies，mention 由 FK cascade 或显式 deleteMany 清理，然后重算 `commentCount`。

### 5.1 Lead -> Customer 转换边界

Cordys `ClueService.batchCopyCluePlanAndRecord` 在复制线索跟进记录时只复制 FollowUpRecord + Field/Blob，并为新记录生成新 ID；同时显式 `commentCount = 0`，没有复制 `follow_up_record_comment` 或 mention 表。

MicroMatrix 按这一最终资源语义实施：

- 新 Customer FollowUpRecord 是新的资源实体，复制主记录业务信息和 Field/Blob。
- 评论、回复、@成员关系不跨资源复制。
- 新记录 `commentCount` 必须从 0 开始，不能复制旧 count 形成“有计数无实体”的脏状态。
- 后续 D 评论模型直接绑定最终 FollowUpRecord ID，不增加来源记录兼容映射或历史 comment alias。

### 5.2 FollowPlan -> FollowRecord 转换

Cordys 的 `PLAN_TO_RECORD` 不是“把 FollowUpPlan 全字段原样复制成 FollowUpRecord”。目标 FollowRecord 表单通过 `formProp.linkProp[sourceFormKey]` 配置显式字段映射，字段项使用 `{ current, link, enable }`：`current` 是目标字段 ID，`link` 是来源字段 ID。只有启用、两端真实存在且类型兼容的映射才会参与填充。

MicroMatrix 直接采用这一最终语义：

- `followRecord` 表单初始化 `CLUE_TO_RECORD / CUSTOMER_TO_RECORD / OPPORTUNITY_TO_RECORD / PLAN_TO_RECORD` 四个场景，默认 `linkFields=[]`；不按字段名、key 或类型自动猜测映射。
- 点击“计划转记录”必须打开正式 FollowRecord 表单，由 `PLAN_TO_RECORD` 生成预填值；用户可在最终表单中确认/修改后提交。
- 不保留旧的 `/follow-up-plans/:id/convert` 一键转换 API，也不提供兼容 facade。
- 保存 FollowRecord 时如果携带 `sourcePlanId`，创建 Record、写 Field/Blob、占用 `converted=false -> true`、写 `convertedRecordId`、更新目标最近跟进信息必须在同一数据库事务中完成。
- 计划转换后的 FollowRecord 是新的资源实体；计划自身动态字段只通过显式 formLink 映射进入目标记录，不能全量复制 Field/Blob。
- `FollowUpRecord` 不再包含旧简化模型的 `nextFollowAt`；“下次跟进”属于 FollowUpPlan 的 `estimatedAt`。FollowRecord 只保留实际 `followedAt`。
- FollowRecord 正式 targetType 只允许 `lead / customer / opportunity`，不保留旧 `contract` 枚举。

## 5.3 C 阶段：FollowRecord Filter / UserView / DataScope

FollowRecord 进入正式资源后，列表只保留一套统一分页协议，不继续维护旧的 target list facade：

```text
POST /follow-ups/page
```

请求同时支持全局列表和对象内时间线，字段包括 `page / pageSize / keyword / targetType / targetId / mine / viewId / filters / filterMode`。对象内查询要求 `targetType + targetId` 成对出现；全局查询先生成真实可见目标集合，再叠加筛选条件。

### 5.3.1 DataScope

- 线索：正常线索 DataScope + 当前用户可访问的线索池。
- 客户：正常客户 DataScope + 当前用户协作客户 + 当前用户可访问的客户公海。
- 商机：商机 DataScope。
- 用户没有对应模块读取权限时，该模块不会进入全局 FollowRecord 可见集合；管理员 `*` 继续按现有权限基座处理。
- target-specific page 与 detail 共用 `assertTargetAccess`，不能出现全局 page 可见、详情反而不可读的双重语义。

### 5.3.2 AdvancedFilter

- 系统字段按 FollowRecord ModuleForm 元数据解析：`targetType / targetId / ownerId / contactId / followedAt / content / type`。
- 动态字段统一调用 `ResourceFieldValueService`，不直接在 FollowUpsService 重写 Field/Blob SQL。
- 每个条件先独立解析为资源 ID 集；`AND` 做交集，`OR` 做并集，避免沿用旧 FollowPlan `filterIds` 实际只支持 AND 的缺陷。
- SavedView 的 `searchMode` 与临时 `filterMode` 分别求值，随后作为两个约束取交集；视图只能缩小结果，不能扩大临时筛选或 DataScope。
- keyword 可匹配跟进内容与线索/客户/商机名称，但最终仍必须落在 DataScope 可见记录集合中。

### 5.3.3 UserView

- 新增独立 `FOLLOW_RECORD` resourceType，与 Cordys `UserViewResourceType.FOLLOW_RECORD` 对齐。
- 路由使用 `/follow/record/view/*`，完整复用现有 UserViewsService 的 add/update/delete/detail/list/fixed/enable/editPos。
- 不建立 FollowRecord 专用 SavedView 表或兼容映射。

## 6. 通知

评论通知复用 NotificationsService：普通评论通知负责人；mentioned 通知 mentionedUserIds；reply 通知 replyToUserId；收件人合并去重并排除 operator。

事件按 targetType 映射 clue/customer/opportunity，不新增“万能 FOLLOW_COMMENT”事件去丢失业务通知配置粒度。

### 6.1 D 阶段：评论 / 回复 / @成员

FollowRecord 评论只保留 Cordys 的两层结构，不实现无限级树：

- `parentId = null` 为顶层评论。
- 回复必须引用同一 FollowUpRecord 下的顶层评论；如果 `parentId` 本身已经是回复则拒绝，避免形成第三级。
- `replyToUserId` 仅表达“回复谁”，不参与层级定位；服务端要求它是当前租户 `ACTIVE` 用户。
- 评论内容最终限制为 3000 字，采用 Cordys `CommentAddRequest / CommentUpdateRequest` 的最终 DTO 约束，不沿用 1.9.0 初始 DDL 中过时的 512 长度。
- `mentionedUserIds` 最多 100 个；服务端去重后逐个确认属于当前租户且状态为 `ACTIVE`，不允许跨租户/停用成员进入 mention 或通知。

Prisma 直接建立最终关系：

```text
FollowUpRecord
  └─ FollowUpRecordComment
       ├─ replies (self relation, parent 删除级联)
       └─ FollowUpRecordCommentMention (comment 删除级联)
```

Comment 与 Mention 不建立任何旧数据 alias、来源记录映射或兼容表；项目未上线，baseline 直接升级为最终模型。

### 6.2 评论查询与写入事务

- `POST /follow/record/comment/page`：先执行 `FollowUpsService.assertRecordAccess(..., false)`；只分页顶层评论，当前页 parent 的直接 replies 一次批量查询，mentions/users 再批量装配。
- `POST /follow/record/comment/add`：资源可读后创建评论、写 mentions、重算 `FollowUpRecord.commentCount`；`commentCount` 统计顶层 + 回复全部实体。
- `POST /follow/record/comment/update`：先确认评论存在于当前租户并属于调用人，再确认对应 FollowRecord 仍可读；更新正文并整体替换 mentions。
- `DELETE /follow/record/comment/:id`：只允许评论创建人；删除顶层时由 self FK cascade 删除 replies，由 mention FK cascade 删除关系，再重算资源总评论数。
- 评论实体、mention 关系、commentCount 必须在同一数据库事务内提交；通知在事务成功后发送，通知失败不得回滚已经成功的评论写入。

### 6.3 评论通知事件

按 Cordys 1.9.0 的真实事件名纳入 `MESSAGE_TASK_DEFINITIONS`：

- `CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED`
- `CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED`
- `CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED`
- `CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED`
- `OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_ADDED`
- `OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_MENTIONED`

普通评论事件只发资源负责人；mention/reply 合并为 mentioned 收件人并走 `*_COMMENT_MENTIONED`。两组都去重、排除操作者，并继续由 MessageSettings 控制 system/email/wecom 渠道。不会新增万能评论事件，也不会绕开消息设置直接写 Notification。

### 6.4 操作日志

评论 add/update/delete 都记到 FollowUpRecord 资源的 update 类操作日志。日志至少保留资源 ID、评论 ID 和正文变更摘要；不把 mention 用户的敏感账户信息复制进日志 detail。Controller 继续使用现有 `@LogOperation` 基座，不建立评论专用日志表。

## 7. PC 结构

不继续膨胀 `FollowUpDrawer.vue`。目标结构：

```text
components/follow-records/
  FollowRecordPanel.vue
  FollowRecordFormDrawer.vue
  FollowRecordTimeline.vue
  FollowCommentPanel.vue
  FollowCommentItem.vue
  FollowCommentEditor.vue
  useFollowRecords.ts
  useFollowComments.ts
```

路由/客户 360/商机详情只编排目标上下文，实际资源与评论逻辑复用上述领域组件。

### 7.1 E 阶段最终 runtime

E 阶段实现以共享领域 runtime 收口，不继续扩张旧 `FollowUpDrawer.vue`：

- `FollowRecordPanel` 负责目标上下文、记录列表、表单 Drawer 与卡片内折叠评论面板编排。
- `FollowRecordFormDrawer` 统一承担创建/编辑/计划转记录，动态字段全部走 `DynamicForm`；可空系统字段在 update 时用显式 `null` 表达清空，避免把 `undefined` 误解释为“不更新”。
- `FollowRecordTimeline` 只渲染记录卡和业务动作；评论直接挂在对应卡片下，不再使用独立评论 Dialog。
- `FollowCommentPanel / FollowCommentItem / FollowCommentEditor / useFollowComments` 负责两层评论、分页、回复、编辑、删除和 @成员；Web 编辑器限制 300 字，后端仍保持 3000 字资源边界。
- 客户 360、`CustomerDetailDrawer`、线索 `LeadOverviewDrawer`、商机 `OpportunityDetailDrawer` 和 `FollowUpDrawer` 复用同一 `FollowRecordPanel`，不复制资源/评论实现。

### 7.2 ATTACHMENT / PICTURE 最终生命周期

FollowRecord 文件字段只存在一套资源字段生命周期：

1. 浏览器先通过公共附件上传获得临时 attachment ID。
2. DynamicForm 把 ID 数组作为 `ATTACHMENT / PICTURE` 字段值进入 `moduleFields`。
3. FollowRecord create/update 与 Field/Blob 保存处于同一数据库事务，`ResourceFieldValueService` 同时校验字段值并 claim 文件到 `resourceField:followRecord + recordId`。
4. `attachmentMap` 按动态字段 key 回显元数据；已绑定 ATTACHMENT 下载、PICTURE object URL 都经 FollowRecord 受保护下载接口，不允许通用 Attachment API 绕过目标对象权限。
5. 删除/改绑后的孤儿和过期临时文件由公共 cleanup 清理；Cron wrapper 必须经 `DistributedCoordinator` 执行，避免多实例重复扫描。

不保留旧 `targetType=follow-up` 双写、兼容 facade 或“先存通用附件再猜归属”的旁路模型。

### 7.3 全局页面边界

统一 `POST /follow-ups/page` 是正式资源的全局分页能力，但 FOLLOW-001 不据此虚构一个独立 PC 全局页面。最终 Cordys Web 审计没有找到可迁移的独立 FollowRecord list View：其 `FOLLOW_UP_RECORD` pathMap 仍指向商机路由并带 TODO。当前规格要求的是统一 API/DataScope/UserView 和对象内共享 runtime，因此 MicroMatrix 保持真实入口——客户/线索/商机详情、FollowUpDrawer、首页快捷创建；独立全局页面只有在后续产品规格明确要求时再实现。

## 8. 执行顺序

1. A：源码审计 + 文档冻结。
2. B：FollowUpRecord ModuleForm + Field/Blob + CRUD foundation。
3. C：AdvancedFilter / UserView / 跨模块复制与删除链收口。
4. D：评论 / 回复 / @成员 + commentCount + 通知/日志。
5. E：PC 组件化 runtime。
6. F：专项 Smoke + 相邻回归 + baseline/root gates + 文档封板。
