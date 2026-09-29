# Operation Log 设计

## 1. 数据模型

```text
OperationLog
  id / tenantId / userId / userName
  module / action / targetId / targetName
  ip / createdAt
  └── OperationLogBlob(detail JSON)

OperationLogSetting
  tenantId
  retentionDays
  lastCleanupAt
  lastCleanupDeleted
  lastCleanupSource
```

OperationLog 主表只保留列表字段；Blob 通过 operationLogId 一对一并 ON DELETE CASCADE。

`OperationLogSetting.retentionDays` 内部允许区分“继承默认”“永久”“显式天数”，API 对外返回清晰的 configured/permanent/effective 值。

## 2. IP 链路

```text
client
  -> controlled Nginx proxy/proxies
  -> Express trust proxy hops
  -> request.ip
  -> normalizeClientIp()
  -> LoginLog / OperationLog
```

客户端自己提交的 forwarding header 不能绕过受控 hop 数。

## 3. 写入

普通 interceptor 只 create OperationLog 摘要。字段差异使用 nested write 同时创建 Blob，确保摘要和详情原子落库。

## 4. 读取

列表使用显式 select，只取摘要字段。详情接口先以 tenant+id 查父日志，再读取 Blob。这样分页列表不会因为大量 before/after JSON 放大 I/O。

## 5. Cleanup

每日 04:15 的 scheduled wrapper 进入 DistributedCoordinator：

```text
runScheduledOnce('operation-log-cleanup','DAILY')
  -> tenants
  -> effective retention
  -> bounded id scan
  -> deleteMany(ids)
  -> update cleanup metadata
```

Redis unavailable 时使用 PostgreSQL advisory fallback。`operation_logs(createdAt)` 独立索引用于跨租户时间扫描，tenant+createdAt 索引继续服务列表。

## 6. Manual actions

`POST /logs/cleanup` 执行 retention cleanup。

`POST /logs/clear-all` 只按当前 tenantId deleteMany 全部 OperationLog；不挂 `@LogOperation`，避免清空后又生成一条新日志。

## 7. Web

`/system/logs` 保留操作日志/登录日志视图。操作日志支持详情 Drawer 和日志策略入口；策略 UI 显示保留模式、有效天数、最近清理时间/数量/来源。

清理过期与清空全部必须有视觉和文案区分，永久保留模式必须显示容量增长风险。

## 8. 容器日志

Compose 使用 logging anchor 给 PostgreSQL、Redis、API、worker、web 配置 json-file max-size/max-file。该策略只限制宿主机 Docker 日志文件，不改变应用审计数据。

## 9. 维护规则

- 不把 LoginLog 混入 OperationLog retention。
- 不做无 tenantId 的 clear-all。
- 不把详情重新塞回分页 VO。
- 如果未来接入 Loki/ELK/OTel，它们只能作为外部可观测补充，不替代 PostgreSQL 审计事实。
