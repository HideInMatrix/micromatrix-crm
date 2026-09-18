# PRISMA8-002 Timestamp 语义盘点

状态：`P2.1 COMPLETE`

## 1. 结论

canonical contract `apps/api/prisma/contract.prisma` 当前共有 **126** 个 `Timestamp(3)` 字段。

按业务语义细分：

- **AUDIT：89** —— 创建、更新等审计时间；
- **EVENT_INSTANT：27** —— 已发生业务事件时间，如完成、处理、登录、读取、同步；
- **SCHEDULED_INSTANT：10** —— 已确定的未来绝对时刻，如公告生效/结束、到期、重试、计划提醒。

三类在数据库语义上都属于 **absolute instant**。当前 contract 中未发现真正需要 `timestamp without time zone` 语义的：

- local/wall-clock datetime：**0**；
- recurring time-of-day：**0**。

因此 P2 后续不按字段名机械区分 `timestamp` / `timestamptz`，而是统一验证历史值是否按 UTC 写入；验证成立后，126 个字段均进入 `timestamptz(3)` forward migration 候选集。

## 2. 语义规则

### AUDIT

`createdAt / updatedAt / createTime / updateTime` 等字段描述“事件在真实时间轴上的发生时刻”，必须可跨时区无歧义比较。

### EVENT_INSTANT

`finishedAt / handledAt / sentAt / readAt / lastLoginAt / lastSyncedAt` 等字段描述已经发生的真实事件，也必须是绝对时刻。

### SCHEDULED_INSTANT

`startAt / endAt / estimatedAt / expiresAt / nextAttemptAt / deadline / currentPeriodStart / currentPeriodEnd / expireTime` 描述一个确定的未来时间点，而不是“每天 09:00”之类的本地时钟规则。

前端可以把这些 instant 渲染为日期、当地时间或相对时间，但展示方式不改变数据库语义。

`BiddingInfos.deadline` 当前 API 会投影为 date-only 文本，但写入路径仍先解析为 `Date` 并以 Temporal timestamp 保存。因此它继续归类为 SCHEDULED_INSTANT；P2.2 只治理 API 表达，不把它误改成 wall-clock timestamp。

## 3. 逐模型 inventory

| Model | 数量 | Timestamp 字段 | 分类 |
| --- | ---: | --- | --- |
| Announcements | 4 | startAt, endAt, createdAt, updatedAt | SCHEDULED_INSTANT / AUDIT |
| ApprovalFlows | 3 | deletedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| ApprovalFlowVersions | 1 | createdAt | AUDIT |
| ApprovalInstances | 3 | finishedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| ApprovalTasks | 3 | handledAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| ApprovalAddSignTasks | 2 | createdAt, updatedAt | AUDIT |
| ApprovalFlowNumberCounters | 1 | updatedAt | AUDIT |
| Attachments | 1 | createdAt | AUDIT |
| ApprovalInstanceAttachments | 1 | createdAt | AUDIT |
| ApprovalRecords | 2 | createdAt, updatedAt | AUDIT |
| ApprovalResourceSnapshots | 2 | createdAt, updatedAt | AUDIT |
| ApprovalReturnBackRecords | 2 | createdAt, updatedAt | AUDIT |
| ApprovalWebhookDeliveries | 4 | startedAt, finishedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| BiddingInfos | 3 | publishedAt, deadline, createdAt | EVENT_INSTANT / SCHEDULED_INSTANT / AUDIT |
| BiddingKeywordSubs | 1 | createdAt | AUDIT |
| BiddingSources | 3 | lastFetchAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| Tenants | 2 | createdAt, updatedAt | AUDIT |
| Departments | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseAiModelRoutes | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseAiModels | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseGlobalTasks | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseGlobalTaskExecutions | 4 | startedAt, finishedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| Roles | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseIntegrations | 4 | lastTestedAt, lastSyncedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| EnterpriseMailSettings | 3 | lastTestedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| EnterpriseTermCategories | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseTermDiscoveries | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseTerms | 2 | createdAt, updatedAt | AUDIT |
| EnterpriseUiSettings | 2 | createdAt, updatedAt | AUDIT |
| ExportTasks | 4 | startedAt, completedAt, expiresAt, createdAt | EVENT_INSTANT / SCHEDULED_INSTANT / AUDIT |
| OrganizationSyncBatches | 6 | fetchStartedAt, previewedAt, applyStartedAt, finishedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| ExternalDepartmentMappings | 2 | createdAt, updatedAt | AUDIT |
| Users | 2 | createdAt, updatedAt | AUDIT |
| ExternalUserMappings | 2 | createdAt, updatedAt | AUDIT |
| ExternalIdentities | 5 | boundAt, revokedAt, lastLoginAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| ExternalOauthStates | 3 | expiresAt, consumedAt, createdAt | SCHEDULED_INSTANT / EVENT_INSTANT / AUDIT |
| FollowUpPlans | 4 | estimatedAt, dueNotifiedAt, createdAt, updatedAt | SCHEDULED_INSTANT / EVENT_INSTANT / AUDIT |
| FollowUpPlanComment | 2 | createTime, updateTime | AUDIT |
| FollowUpRecords | 3 | followedAt, createdAt, updatedAt | EVENT_INSTANT / AUDIT |
| FollowUpRecordComment | 2 | createTime, updateTime | AUDIT |
| LoginLogs | 1 | createdAt | AUDIT |
| MessageDeliveries | 4 | nextAttemptAt, sentAt, createdAt, updatedAt | SCHEDULED_INSTANT / EVENT_INSTANT / AUDIT |
| MessageTaskSettings | 2 | createdAt, updatedAt | AUDIT |
| Notifications | 2 | readAt, createdAt | EVENT_INSTANT / AUDIT |
| OperationLogs | 1 | createdAt | AUDIT |
| OperationLogSettings | 2 | lastCleanupAt, updatedAt | EVENT_INSTANT / AUDIT |
| OrganizationSyncItems | 2 | createdAt, updatedAt | AUDIT |
| Plans | 2 | createdAt, updatedAt | AUDIT |
| Subscriptions | 4 | currentPeriodStart, currentPeriodEnd, createdAt, updatedAt | SCHEDULED_INSTANT / AUDIT |
| UserKey | 2 | createTime, expireTime | AUDIT / SCHEDULED_INSTANT |
| UserRoles | 2 | createdAt, updatedAt | AUDIT |

## 4. P2.2/P2.4 前置约束

在生成任何 forward migration 之前必须完成 existing DB precheck：

1. PostgreSQL session/database timezone；
2. 126 个目标列当前物理类型；
3. 历史默认值是否使用 `now()/CURRENT_TIMESTAMP`；
4. 应用写入是否统一来自 `Date/ISO/Temporal` 的绝对时间；
5. 抽样检查时间值与同一事件的日志/业务时间是否一致；
6. 若确认旧 `timestamp without time zone` 值历史上按 UTC 保存，则迁移必须显式：

```sql
ALTER TABLE ...
ALTER COLUMN ...
TYPE timestamptz(3)
USING ... AT TIME ZONE 'UTC';
```

禁止依赖 migration session timezone 隐式解释历史值。

