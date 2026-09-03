# CACHE-002 租户读模型与首页统计缓存任务

- [x] C1 现场审计与规格冻结
  - 对照 CACHE-001 公共基座、Cordys Redis 使用面和当前热点 Service。
  - 冻结本批仅做派生缓存，不纳入 Pub/Sub、BullMQ、分布式锁、流水号、验证码。

- [x] C2 建立 TenantDerivedCacheService 与基础观测
  - 统一 remember / version invalidation / fingerprint / namespace metrics。
  - Redis 未配置/未 ready 时直接 bypass 到 loader。
  - `/health` 暴露 Redis enabled/ready 与缓存计数，不暴露连接秘密。

- [x] C3 租户静态配置缓存
  - ModuleConfig / TopNavigation。
  - MessageSettings。
  - Enterprise UI / Branding。
  - ModuleForm / Metadata。

- [x] C4 Directory 读模型缓存
  - Department tree。
  - ACTIVE member options。
  - Departments / Members / OrganizationSync 成功写路径主动失效。

- [x] C5 Home / Dashboard 短 TTL 缓存
  - statistic lead/opportunity/underway/success。
  - overview summary/funnel/ranking/trend/conversion。
  - user DataScope 上下文 + 请求参数稳定摘要隔离。

- [x] C6 专项测试与回归
  - CACHE-002 公共缓存专项测试。
  - 相关 ModuleConfig/MessageSettings/Enterprise/Metadata/Home/Directory 测试。
  - API typecheck、Rules、`git diff --check`。

- [x] C7 文档封板
  - 更新 specs 索引、architecture、project-progress、alignment-log。
  - 记录实际缓存覆盖、失效边界与未纳入能力。
  - C2～C6 全绿后将 `CACHE-002` 标记为 `VERIFIED`。

## 最终验收

- `TenantDerivedCacheService` 已完成版本化 cache-aside、稳定 fingerprint、fail-open bypass 与 namespace 级 hit/miss/bypass/write 计数；`/health` 只暴露 Redis enabled/ready 和缓存指标，不暴露连接秘密或业务值。
- ModuleConfig / TopNavigation、MessageSettings、Enterprise UI / Branding、ModuleForm / Metadata 均接入版本化缓存；写操作只在数据库成功后 bump version，缓存命中不会重复执行默认补种/懒初始化。
- Department tree、ACTIVE member options 与首页权限部门树接入 `directory` 读模型；Departments、Members、OrganizationSync 的真实组织/成员写入口成功后主动失效。
- Home statistic 与 overview 使用 30 秒短 TTL；key 摘要包含当前用户 DataScope 上下文与筛选参数，部门筛选顺序归一化，业务写路径不维护大规模统计缓存失效矩阵。
- 数据源写入口审计未发现本批缓存覆盖范围内的遗漏：注册创建的是全新租户；个人中心当前只修改手机号/邮箱，企微工作台资料回写只补手机号/邮箱/性别，均不会改变本批 directory 的 id/name/deptId 或部门结构读模型。
- API typecheck PASS；CACHE-002 + 相邻模块专项 **37/37 PASS**；完整 `test:rules` **150/150 PASS**；最终 `git diff --check` PASS。
- 本批没有引入 Pub/Sub、BullMQ、Redis Lock、业务流水号、验证码或 Session 状态。

当前状态：**VERIFIED**。
