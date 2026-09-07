# DB-007 公告能力对齐设计

状态：`VERIFIED`

## 1. Cordys 源码结论

本轮已读取 `AnnouncementController / AnnouncementService / Announcement / AnnouncementRequest / ExtAnnouncementMapper`，以及 PC `views/system/message/index.vue`、`announcementList.vue`、`addNotifyModal.vue`、shared API/type。

关键语义：

1. 公告保存 `subject/content/startTime/endTime/url/renameUrl`。
2. 接收范围只有部门和成员。部门会递归展开子部门成员，最终用户集合在保存时冻结。
3. 公告若当前生效，立即转换为 Notification；未来公告由 `NotifyOnJob` 周期扫描转换。
4. Notification 通过 `resourceId/resourceType=ANNOUNCEMENT_NOTICE` 关联公告；编辑、删除会删除旧通知。
5. 公告已读状态来自 Notification，不存在独立公告读取表。
6. Cordys 当前公告表单没有附件组件，正式 DB-007 不实现附件。

## 2. MicroMatrix 数据模型

新增 `Announcement`：

- `tenantId`
- `subject / content`
- `startAt / endAt`
- `url / linkName`
- `departmentIds`：原始选中部门 ID JSON 数组
- `userIds`：原始选中成员 ID JSON 数组
- `receiverUserIds`：保存时解析后的最终成员快照 JSON 数组
- `notice`：是否已转换 Notification
- `createUserId / updateUserId / createdAt / updatedAt`

扩展 `Notification`：

- `sourceType`
- `sourceId`

并增加 `(tenantId, sourceType, sourceId)` 查询索引。公告通知写入 `sourceType=announcement`，从而支持精确重建/删除。

## 3. Service 边界

`AnnouncementsService` 负责：

- 租户隔离 CRUD；
- 部门树递归展开与成员快照；
- 返回接收范围名称；
- 当前有效公告立即发布；
- 未来有效公告扫描；
- 编辑/删除时调用 Notification source 清理接口。

`NotificationsService` 新增 source-aware 能力：

- 从指定 source 向多用户派发；
- 删除指定 source 的全部通知；
- 删除后逐用户 bump cache version，并通过现有 Redis Pub/Sub/SSE 发布 `STATE_CHANGED`。

该设计不建立第二条通知链路。

## 4. 定时发布与并发

公告扫描使用 `@Cron('0 */5 * * * *')`，与 Cordys 5 分钟周期一致。

多实例下通过 `DistributedCoordinatorService.runScheduledOnce('announcement-publish', 'MINUTE', ...)` 去重。单公告转换同时使用数据库 `notice=false` 状态作为幂等边界；失败时恢复 `notice=false` 以便后续重试，Notification source 清理保证重试前不会保留半成品。

## 5. API

- `GET /announcements?page&pageSize&keyword`
- `GET /announcements/:id`
- `POST /announcements`
- `PATCH /announcements/:id`
- `DELETE /announcements/:id`

读权限：`system:message`；写权限：`system:message:update`。

## 6. PC UI

`/system/messages` 保持一个路由，在页面头部使用按钮式 top menu 在“消息通知 / 公告”间切换，避免重新引入页面级 Tabs。

公告管理使用 Element Plus：

- 列表：标题、正文、生效时间、接收范围、创建/更新审计、操作。
- Drawer：标题、可选 URL/链接名、正文、datetime range、部门多选、成员多选、内容预览。
- 部门数据复用 `/departments/tree`，成员复用 `/members/options`。

## 7. 数据库策略

项目尚未正式发布，继续按 pre-release 规则直接重写 `20260905084900_baseline/migration.sql`，同时更新 Prisma schema；不产生第二 migration。
