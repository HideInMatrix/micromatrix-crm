# CACHE-002 租户读模型与首页统计缓存技术设计

## 1. 总体策略

延续 `CACHE-001` 的 **cache-aside + fail-open** 原则，同时把 CACHE-002 分成两种失效模型：

```text
低频配置 / 目录读模型
  DB commit -> INCR namespace version -> 新请求使用新版本 key

首页聚合统计
  cache miss -> PostgreSQL aggregation -> SET EX 30s
  业务写入不逐项失效 -> 短 TTL 自然收敛
```

Redis 永远不是这些数据的业务事实来源。

## 2. TenantDerivedCacheService

公共层新增 `TenantDerivedCacheService`，统一封装：

- `remember({ tenantId, namespace, key, ttlSeconds, loader })`
- `invalidate(tenantId, namespace)`
- `fingerprint(value)`
- `snapshot()`

示意 key：

```text
derived:module-config:<tenantId>:v3:list
derived:metadata:customer:<tenantId>:v8:config
derived:directory:<tenantId>:v12:members-options
derived:home-statistic:<tenantId>:v0:<sha256>
```

版本 key：

```text
derived-version:<namespace>:<tenantId>
```

版本 key TTL 明显长于业务缓存 TTL，避免版本回到 `0` 时与仍存活的旧 `v0` key 冲突。配置类统一使用版本失效，不做 Redis 全库扫描。

## 3. 可用性与观测

`RedisService` 增加只读 `ready` 状态，不改变现有连接重试/fail-open 语义。

`TenantDerivedCacheService` 维护进程内累计计数：

```text
hit      Redis 命中
miss     Redis ready，但 key 不存在/不可解析，执行 DB loader
bypass   Redis 未配置或未 ready，直接执行 DB loader
write    loader 完成后成功写入缓存
```

`/health` 只暴露：

```json
{
  "redis": { "enabled": true, "ready": true },
  "cache": { "module-config": { "hit": 10, "miss": 2, "bypass": 0, "write": 2 } }
}
```

不返回 host、password、URL、key 内容或业务缓存值。

## 4. Namespace 与 TTL

| namespace | 内容 | TTL | 失效 |
| --- | --- | ---: | --- |
| `module-config` | 模块列表/顶部导航 | 600s | 配置写后版本 +1 |
| `message-settings` | 消息列表/事件配置 | 300s | 设置写后版本 +1 |
| `enterprise-ui` | UI Setting/Branding | 300s | UI/资源写后版本 +1 |
| `metadata:<formKey>` | 表单属性/字段定义 | 600s | 表单/字段写后版本 +1 |
| `directory` | 部门树/成员 options | 180s | 组织成员变更后版本 +1 |
| `home-statistic` | 首页统计接口 | 30s | 自然过期 |
| `home-overview` | 首页 overview | 30s | 自然过期 |

## 5. 首页 key 的权限边界

首页结果不仅取决于请求 DTO，还取决于当前用户身份和数据范围。因此 key 摘要输入包含：

```text
user.id
user.deptId
roles: id + dataScope + scopeDeptIds + permissions
request/scenario/method
```

角色数组、权限数组和部门数组先排序后摘要，避免顺序变化制造无意义 cache miss。

不把 `AuthUser` 原始 JSON 直接放入 Redis key。

## 6. Metadata 事务边界

`ModuleFormsService.getConfig()` 可以缓存；`listFieldsInTransaction(tx, ...)` 必须继续直接使用当前事务 client。

写操作在事务成功提交后才调用 `invalidate()`。如果 Redis 失效失败，数据库提交仍然有效；旧 key 由 TTL 兜底。

## 7. Directory 失效边界

`directory` 是展示/选择器读模型，不作为权限来源。以下操作成功后 bump version：

- Departments create/update/remove
- Members create/update/toggleStatus/remove
- OrganizationSync apply 成功

角色本身改变不会影响 `members/options` 和基础部门树数据；HomeDepartmentScope 的最终权限过滤仍依赖当前 `AuthUser`/DataScope，不把 directory 当授权缓存。

## 8. 验收

1. TenantDerivedCacheService 单元测试：hit/miss/bypass/version/fingerprint/metrics。
2. ModuleConfig、MessageSettings、Metadata、Directory 至少验证一次 cache hit 与写后失效。
3. Home statistic/overview 验证相同 user + request 的第二次读取不再调用聚合 loader，不同请求摘要隔离。
4. Redis 不可用时相关 API 继续从 PostgreSQL 返回。
5. API typecheck、相关 test、Rules、diff-check 全绿。
