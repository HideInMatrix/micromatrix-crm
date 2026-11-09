# Messaging 与公告设计

## 1. 业务通知流程

```text
Business event
  -> MessageTaskEvent
  -> MessageTemplateService.render(event, context, language)
  -> recipients
     ├── Notification (PostgreSQL)
     └── enabled external MessageDelivery
  -> cache invalidation
  -> Redis Pub/Sub
  -> SSE clients refresh
```

站内 Notification 是用户消息事实；外部 channel 是独立 delivery。外部事件通知必须在业务事务提交后触发；更新类通知先比较字段的规范化存储值，未发生实际变化不通知。外部事件 Inbox 的幂等重放不重新触发通知。

## 2. Event registry

`MESSAGE_TASK_DEFINITIONS` 同时给 API/Web 提供 module、event、显示名称和默认 channel 行为。事件集合只包含当前 Customer/Clue 业务；新增或删除业务模块时应同步维护事件注册表、模板和触发点。

MessageSettings 以 event 为稳定键存 channel 开关；共享类型保证前后端不各自维护事件字符串。外部事件新建线索复用 `CLUE_ADD`；外部事件更新线索和客户分别使用 `EXTERNAL_EVENT_LEAD_UPDATED` / `EXTERNAL_EVENT_CUSTOMER_UPDATED`，两者默认关闭。

## 3. Template renderer

`MessageTemplateService` 保存 zh-CN/en-US 类型化资源：

- `normalizeLanguage()` 统一 locale。
- `render()` 返回 title/content。
- `renderText()` 处理显式模板分支。
- User/Time 变量在服务端规范化。

模板是代码资源，不是数据库业务数据；修改模板需要经过代码 review 和测试。

## 4. Notifications

Notification 查询使用 tenant/user 边界。缓存采用 per-user version：任何 create/markRead/source delete 都 bump version，使不同分页和 unread cache 同时失效。

Realtime 只发送轻量 `STATE_CHANGED` 类信号，客户端收到后重新读取 API。

## 5. Announcement

Announcement 保存：subject/content/startAt/endAt/url/linkName、departmentIds、userIds、receiverUserIds、notice 状态和审计字段。

发布流程：

1. 保存时展开部门树并冻结 receiverUserIds。
2. 当前有效则创建 sourceType=announcement/sourceId=<id> 的 Notification。
3. 未来公告由 `announcement-publish` Cron 扫描。
4. 多实例由 DistributedCoordinator 的 MINUTE slot 去重，单公告仍使用 `notice=false` 状态做数据库幂等。
5. 编辑/删除通过 sourceId 精确删除旧 Notification，再按新状态决定重建。

## 6. External channels

Messaging 只产生统一 delivery input；WeCom/DingTalk/Lark 的凭据、身份映射、发送 API、retry 分类和 provider message id 由 Enterprise Platform 的 MessageDelivery adapter 处理。

系统消息与任一外部 channel 相互隔离。外部失败保留审计，不撤销主业务事务。

## 7. User language

`User.language` 是当前通知语言偏好，并通过 CurrentUser/Personal Center 暴露。业务通知按 operator language 一次渲染；Cron/系统动作使用 zh-CN。

## 8. UI

`/system/messages` 聚合消息设置和公告管理。公告列表提供搜索、时间、接收范围、编辑/删除；编辑使用部门/成员选择并遵守当前 Element Plus 页面设计。

通知中心的交互以当前 PC/Mobile 实际实现为准。

## 9. 维护规则

- 新业务事件必须先进入 shared event registry，再接模板和触发点。
- 不新增平行 Notification 表或公告已读表。
- 不把 Provider Secret、access token 或完整第三方响应放入消息正文、缓存或日志。
- 删除业务模块时同步删除其 MessageTaskEvent、模板和 trigger。
