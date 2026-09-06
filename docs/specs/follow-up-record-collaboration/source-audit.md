# FOLLOW-001 Cordys 跟进记录协同源码审计

## 1. 审计来源

本轮直接读取工作区 `CordysCRM/` 当前源码，主要证据：

- `FollowUpRecordController / Service / Domain / DTO / ExtFollowUpRecordMapper.xml`
- `FollowUpRecordCommentController / Service / BaseCommentService`
- `Comment / FollowUpRecordComment / CommentMention / ExtCommentMapper.xml`
- `FollowUpRecordUserViewController`
- `V1.9.0_2__ga_ddl.sql`
- Web `crm-follow-detail/followRecord.vue`
- Web `crm-comment/*`
- shared `models/follow.ts / method/comment.ts / api/modules/follow.ts`

## 2. 跟进记录本体

Cordys `/follow/record` 提供 ModuleForm、TAB、统一分页、详情、添加、更新、删除。FollowUpRecord 主表不是纯日志文本，系统字段包括 customer/opportunity/clue、content、followTime、followMethod、owner、contact、commentCount；其它字段通过 FollowUpRecordFieldService 写入 Field/Blob。

详情会解析 ModuleForm、动态字段 options 和 attachmentMap，因此“附件”属于动态表单字段能力，不是评论附件。

## 3. UserView / AdvancedFilter

`FollowUpRecordUserViewController` 使用 `UserViewResourceType.FOLLOW_RECORD`，完整支持 add/update/delete/detail/list/fixed/enable/editPos。统一 record page 同时接收 filters/combineSearch/viewCombineSearch/sort，并对系统字段与 follow_up_record_field(_blob) 分别编译。

因此 MicroMatrix 当前 `GET /follow-ups?targetType&targetId` + 最多 100 条的实现不足以作为最终 FollowRecord runtime。

## 4. 评论模型

Cordys 1.9.0 DDL：FollowUpRecord 增 `comment_count BIGINT NOT NULL DEFAULT 0`；新增 `follow_up_record_comment` 和 `follow_up_record_comment_mention`。

顶层评论分页；当前页 parent 的所有 children 批量装配。`commentCount` 通过 SQL 对资源全部评论 count，因此包含回复。

## 5. 评论写入边界

`CommentAddRequest`：resourceId、parentId、replyToUserId、content、mentionedUserIds；mention 最多 100。`CommentUpdateRequest` 只允许 id、content、mentionedUserIds。

BaseCommentService：add 写评论、mentions、重算 count、通知和日志；update 只允许创建人并替换 mentions；delete 只允许创建人，parent 删除时同时删除直接 children 和 mentions，并重算 commentCount。

## 6. @成员与通知

评论回传 mention user id/name/avatar/enable。Web mention 编辑器把正文中仍然存在的 `@姓名` 与选择成员做二次过滤后提交 IDs。

通知目标包括资源负责人、@成员和被回复人。Cordys 按线索/客户/商机分别使用 comment-added / comment-mentioned 事件。

MicroMatrix 应复用当前 Notifications / MessageSettings，并加强 mention user 的 tenant/active 校验，不照搬可被跨租户 ID 污染的弱边界。

## 7. Web 交互

每条 FollowRecord 卡片下挂 `CrmComment`：标题展示 commentCount；支持新增、回复、编辑、删除、@成员；无限加载顶层评论；edit/delete 由 editable 控制；真正资源权限仍由后端控制。

## 8. 与当前 MicroMatrix 的差距

当前 `FollowUpRecord` 只有 `tenantId / targetType / targetId / type / content / nextFollowAt / ownerId / ownerName / createdAt`，没有正式 ModuleForm、Field/Blob、update/delete/detail/page、UserView、commentCount、comments/mentions，也没有动态 attachment 字段生命周期。

当前 `FollowUpDrawer.vue` 把跟进记录当成简单时间线，并用 `attachmentApi.upload(..., 'follow-up', recordId)` 绑定通用附件。这可作为历史 UI 基线，但不能继续作为 FOLLOW-001 的领域模型。

## 9. 实施结论

FOLLOW-001 的正确顺序是：先 FollowUpRecord resource foundation，再 UserView/filter，再 comments/mentions，最后 PC runtime；不能先加一个孤立评论表后再二次迁移资源模型。

## 10. 线索转客户的评论边界

Cordys `ClueService.batchCopyCluePlanAndRecord` 对线索 FollowUpRecord 的转换实现有明确语义：

- 查询并复制 FollowUpRecord 主记录；
- 同步复制 `FollowUpRecordField / FollowUpRecordFieldBlob`，为新记录重新生成 resourceId；
- 转为 CUSTOMER 记录并替换 customer/opportunity/contact 上下文；
- 显式执行 `record.setCommentCount(0L)`；
- 该复制函数没有读取或复制 `follow_up_record_comment` / `follow_up_record_comment_mention`。

因此评论属于具体记录实体，不属于可随业务转换继承的“跟进内容附件”。MicroMatrix 不做评论兼容迁移层；Lead -> Customer 新记录评论从零开始。

## 11. PC 全局 FollowRecord 入口审计

最终复查 Cordys Web 后，没有发现一个可作为“独立全局跟进记录页面”迁移基线的真实路由/View：

- Cordys shared 确实存在 `/follow/record/page`、`/follow/record/get`、`/follow/record/add|update|delete` 等统一资源 API，也存在 `FOLLOW_RECORD` UserView；这证明 FollowRecord 是正式资源，并不等于 PC 已有独立全局页面。
- `frontend/packages/web/src/config/pathMap.ts` 的 `FOLLOW_UP_RECORD` 当前仍映射到 `AppRouteEnum.OPPORTUNITY_OPT`，源码旁明确保留 `TODO ... 跟进记录`，不能把这个占位映射解释成已经存在的 FollowRecord 全局路由。
- Cordys 已确认的真实 PC 消费入口主要是 `crm-follow-detail` / overview drawer、客户/线索/商机对象内跟进区域，以及消息跳转/创建表单；未检出独立 FollowRecord list View。

MicroMatrix 当前情况与这一事实边界一致：`apps/web/src/router/index.ts` 有独立 `/follow-plans`，但没有虚构 `/follow-records`；FollowRecord runtime 被客户 360、线索 Overview、商机详情、`FollowUpDrawer` 和首页快捷创建复用。FOLLOW-001 的 R2 要求的是统一 page API / DataScope / UserView 能力，R5 要求对象内共享 runtime，规格本身没有要求新增一个 Cordys 不存在的独立全局 PC 页面。因此本单元不凭空创建全局 FollowRecord View；后续只有在产品规格明确新增该入口时，才基于现有 `/follow-ups/page` 构建正式页面。

## 12. E 阶段公共附件最终模型审计

E 阶段最终 runtime 不再使用旧 `targetType=follow-up` 通用附件模型：

- `followRecord` 的 `ATTACHMENT / PICTURE` 都是 ModuleForm 动态字段，字段值保存附件 ID 数组并进入 FollowUpRecord Field/Blob 真相源。
- 临时上传成功后，保存 FollowRecord 时由 `ResourceFieldValueService` 在同一事务内 claim 到 `resourceField:followRecord + recordId`；详情 `attachmentMap` 按字段 key 返回真实附件元数据。
- 已 claim 文件禁止通过通用 `/attachments/:id/download|delete` 绕过业务权限；FollowRecord 读取通过 `/follow-ups/:id/attachments/:attachmentId/download` 先执行记录访问权限和字段引用校验。
- `ResourceFieldAttachmentCleanupService` 只清理超过临时 TTL 的未绑定文件和失去 Field/Blob 引用的孤儿文件；有效引用保留。Cron wrapper 通过 `DistributedCoordinator.runScheduledOnce('resource-field-attachment-cleanup', 'MINUTE', ...)` 做跨实例协调，清理核心不复制进 wrapper。

这套模型直接作为未发布项目的最终语义，不保留旧 follow-up 附件兼容读取/双写层。
