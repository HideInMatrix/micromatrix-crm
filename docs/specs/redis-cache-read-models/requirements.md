# CACHE-002 租户读模型与首页统计缓存需求

## 1. 目标

在 `CACHE-001` 已建立 Redis fail-open 公共基座的前提下，继续削减高频、低变更读模型对 PostgreSQL 的重复访问。PostgreSQL 仍是唯一业务真相源，Redis 只保存可丢弃派生结果；本批不引入队列、分布式锁、Pub/Sub、Session 或业务编号状态。

本执行单元固定编号为 `CACHE-002`，覆盖两类读取：

1. 租户静态/低频配置：模块配置、顶部导航、消息设置、企业 UI 品牌配置、表单/字段定义、部门树、成员 options。
2. 首页聚合统计：首页 statistic 与 overview 聚合结果采用短 TTL 缓存，避免 COUNT/SUM/GROUP BY 在短时间内重复执行。

## 2. 功能需求

### R1 统一租户派生缓存能力

- 业务 Service 不重复拼接版本号、TTL、hash 和 hit/miss 统计；在公共层提供统一租户派生缓存服务。
- key 必须至少包含 namespace、tenantId、版本号和参数片段；参数复杂时使用稳定摘要，禁止直接把完整请求 JSON 塞入 key。
- 配置类缓存通过版本号主动失效，禁止 `KEYS/SCAN`。
- Redis 未配置、未 ready、命令失败、缓存损坏时必须直接执行 loader 查询 PostgreSQL，不能阻断业务请求。
- 缓存写失败不得改变数据库写入结果或 API 返回。

### R2 ModuleConfig / TopNavigation

- `list` 与 `listTopNavigation` 缓存租户读结果，TTL 5～10 分钟。
- `update/reorder/reorderTopNavigation` 数据库成功后主动提升对应租户缓存版本。
- 默认配置补种只允许发生在 cache miss loader 路径，cache hit 不再执行 `createMany(skipDuplicates)`。

### R3 MessageSettings

- 消息配置列表与单事件有效配置进入租户配置缓存。
- `isSystemEnabled/isWeComEnabled` 复用同一事件有效配置缓存，避免通知发送路径重复读取设置表。
- 单项更新和批量更新成功后主动失效消息设置 namespace。
- 企业微信渠道可用性仍以 Integration 实时状态为准，本批不缓存 Secret、连接测试状态或凭证材料。

### R4 Enterprise UI / Branding

- 已登录企业 UI 设置与按 tenantSlug 的公开品牌配置可缓存。
- 更新主题、标题、Slogan、帮助地址以及替换/清理品牌资源后主动失效对应租户缓存。
- 登录页按邮箱解析租户关系本批保持数据库实时查询，不缓存邮箱到租户映射。
- Redis 中不得存附件文件内容，只缓存公开/展示型 VO。

### R5 Module Form / Metadata

- `getConfig/listFields` 对同一 organizationId + formKey 使用 5～10 分钟缓存。
- `saveFormProp/createField/updateField/deleteField/reorder` 成功后主动失效对应表单版本。
- 事务内 `listFieldsInTransaction` 不使用 Redis，保证事务内读取与当前事务状态一致。
- 系统字段懒补种只发生在 cache miss loader；缓存命中不能触发数据库写入。

### R6 Directory Read Model

- 部门树和 ACTIVE 成员 options 使用租户目录缓存，TTL 1～3 分钟。
- 部门增删改、成员创建/编辑/启停/删除、组织同步应用成功后主动失效目录 namespace。
- 角色权限和数据范围仍由现有 Auth/DataScope 机制判定，不从目录缓存推导授权事实。

### R7 Home / Dashboard 短 TTL 缓存

- `home/statistic` 的 lead、opportunity、underway、success 聚合结果缓存 30 秒左右。
- `home/overview` 的 summary、funnel、ranking、trend、conversion 聚合结果缓存 30 秒左右。
- key 必须包含 tenant、user 与会影响 DataScope/统计口径的用户上下文摘要及请求参数摘要。
- 首页缓存采用短 TTL 自然过期，不要求客户、线索、商机、合同等所有业务写路径逐一主动失效。
- 权限变化后现有 AuthContext 主动失效保持不变；首页最多承受短 TTL 的派生结果陈旧窗口。

### R8 基础观测

- 提供进程内 hit、miss、bypass/fallback、write 计数，至少按 namespace 聚合。
- `/health` 可观察 Redis 是否启用/ready 以及 CACHE-002 累计计数；不得暴露 Redis 密码、URL 或缓存业务内容。
- 观测能力不引入 Prometheus/外部 APM 依赖，本批只建立后续可接指标系统的基础数据面。

## 3. 非功能要求

- TypeScript typecheck、现有 Rules、相关单元测试必须通过。
- 新增缓存专项测试至少覆盖：cache hit 不重复 loader、版本失效、Redis bypass、复杂参数摘要稳定性。
- 关键业务测试需覆盖写后失效，不以“等 TTL 自然过期”替代配置类主动失效。
- `git diff --check` 必须通过。

## 4. 明确不在本批范围

- Redis Pub/Sub + SSE 多实例广播。
- BullMQ 导入导出/异步任务中心。
- 组织同步 Redis Lock、Cron leader/lock。
- Redis `INCR` 业务流水号与恢复算法。
- 邮箱/短信验证码、登录限流。
- Redis Cluster/Sentinel、云厂商专属拓扑。
