# Wave 0 + Wave 1 源码迁移基线

> 建立日期：2026-08-17。本文档记录第一轮直接阅读项目内 `CordysCRM/` 源码后确认的事实，以及 MicroMatrix CRM 当前已落地的迁移底座。后续实现以源码事实为准，不再以页面探测结果推断业务规则。

## 1. 本轮分析范围

CordysCRM：

- `cn/cordys/crm/clue/**`
- `cn/cordys/crm/customer/**`
- `cn/cordys/common/permission/**`
- `cn/cordys/common/service/DataScopeService`
- 线索/客户对应 Mapper XML

MicroMatrix CRM：

- `apps/api/src/modules/leads/**`
- `apps/api/src/customers/**`
- `apps/api/src/modules/pool-rules/**`
- `apps/api/src/common/services/**`
- `apps/api/prisma/schema.prisma`

## 2. 架构结论

Cordys 为线索与客户分别维护 Pool/Capacity/OwnerHistory 结构，但两套业务语义高度一致。MicroMatrix 不复制两套 Java 结构，统一抽象为：

```text
ResourcePool
├── ResourcePoolPickRule
├── ResourcePoolRecycleRule
├── scopeIds
├── managerIds
└── hiddenFieldIds

ResourceCapacity
ResourceOwnerHistory
```

业务资源本身仍保留：

```text
Lead.inPool / Customer.inSea   # 兼容现有前端和旧数据
poolId                          # 真实多池归属
collectedAt                     # 当前负责人持有起始时间
poolEnteredAt                   # 本次进入池的时间
```

这种设计保持 Cordys 业务语义，但避免在 NestJS 中复制两套近似代码。

## 3. Cordys 线索 API 事实

### 主线索 `/lead`

已确认：

- 分页、详情、新增、更新、状态更新、删除
- 转客户
- 批量转移负责人
- 批量字段更新
- 批量删除
- 单个/批量退回线索池
- 导入预检查 + 正式导入
- 全量/勾选导出
- 图表分析
- 用户视图 Tab

### 线索池配置 `/lead-pool`

- 分页
- 新增/更新/快速更新
- 检查是否存在不可领取数据
- 删除
- 启用/禁用

### 池内线索 `/pool/lead`

- 当前用户可访问的池选项
- 按 `poolId` 查询池内数据
- 单个/批量领取
- 单个/批量分配
- 单个/批量删除
- 批量字段更新
- 导入/导出
- 图表

### 库容与历史

- `/lead-capacity`
- `/lead/owner/history`

## 4. Cordys 客户 API 事实

除与线索同构的 CRUD、多公海、库容、负责人历史之外，客户还明确包含：

- 客户协作 `account/collaboration`
- 客户关系 `account/relation`
- 客户合并
- 客户维度商机
- 合同及统计
- 回款计划及统计
- 回款记录及统计
- 发票及统计
- 订单
- 转换场景下的数据范围联合查询

因此 MicroMatrix 当前 `CustomerTeamMember` 只能视为“协作能力的早期版本”，不能直接标记为 Cordys CustomerCollaboration 已完整对齐。

## 5. Pool 业务规则

### 5.1 池访问

Cordys Pool 有两个范围：

- 成员范围：可查看和领取
- 管理员范围：可管理池，并以管理员身份领取

管理员仍受库容限制，但领取时跳过：

- 每日领取数量限制
- 新入池数据冷却
- 前负责人重新领取冷却

MicroMatrix `ResourcePool.scopeIds / managerIds` 按此语义实现。

### 5.2 每日领取限制

Cordys 统计：

```text
owner = 当前用户
AND 不在池中
AND collectionTime 在今天范围内
```

MicroMatrix 使用 `collectedAt` 实现相同语义。

### 5.3 新入池冷却

数据进入池后，需要等待配置天数才能被普通成员领取。

MicroMatrix 使用独立 `poolEnteredAt`，不复用 `updatedAt`，避免普通字段编辑意外改变释放时间。

### 5.4 前负责人冷却

读取最近一次负责人历史：

```text
最近 owner == 当前领取人
AND now < endedAt + cooldownDays
=> 禁止领取
```

MicroMatrix 使用 `ResourceOwnerHistory` 实现。

### 5.5 库容

Cordys 在以下入口都会校验库容，而不仅是池领取：

- 新建线索/客户
- 修改负责人
- 批量转移负责人
- 从池领取
- 池管理员分配
- 线索转客户时走 Customer.add，因此会校验客户库容

当前 MicroMatrix 已接入：

- 新建线索
- 新建客户
- 修改负责人
- 单个分配负责人
- 单个池领取
- 线索转客户
- Lead/Customer 普通批量负责人修改
- LeadPool/CustomerPool owner 批改（独立池权限 + Pool Scope）

客户库容的额外过滤语义也已落地：`ResourceCapacity.filters` 会参与已持有客户计数；Scope 防重会先展开为实际用户集合再判断交集。

## 6. 自动回收规则

旧 MicroMatrix 使用：

```text
PoolRule(module, recycleDays, notifyDays)
```

这套模型暂时保留用于兼容现有 cron。

本轮已经修正自动回收副作用：

- 写负责人历史
- 写 `poolId`
- 写 `poolEnteredAt`
- 清空负责人/部门/`collectedAt`
- 根据原负责人 Scope 匹配目标池
- 如果租户从未创建任何池，才自动建立兼容默认池
- 如果已经存在自定义池但原负责人没有任何匹配池，则跳过该数据，禁止创建全员默认池绕过隔离

2026-08-17 后续进展：已新增 `ResourceRecycleConditionEvaluator`，按 Cordys 源码实现 `storageTime / followUpTime + FIXED / DYNAMICS + AND / OR + Created/Picked scope`。定时任务优先执行 `enabled + autoRecycle + 有有效条件` 的新池规则；对应模块没有任何有效新规则时才回退旧 `PoolRule.recycleDays`。旧模型暂不删除，作为兼容 fallback。

## 7. Mapper XML 中确认的查询语义

### 线索

- 正常列表：`in_shared_pool=false`
- 池列表：`in_shared_pool=true AND pool_id=:poolId`
- 数据范围通过负责人所在部门关联
- 自定义字段筛选/组合筛选/保存视图筛选都有独立 SQL join
- 存在重复检测、相似线索、高级搜索、全局搜索、图表、动态排序

### 客户

除上述语义外：

- 协作客户是独立的数据可见范围
- 转换场景会联合：本人/部门数据范围 + 协作客户 + 可访问公海
- 客户库容支持过滤已持有客户数量
- 删除前有联系人/商机等资源引用判断

这些 SQL 行为不能仅靠 Java Domain 类推断，后续迁移高级搜索、保存视图、客户协作时必须继续以 Mapper XML 为事实来源。

## 8. 资源权限语义

Cordys `ResourcePermissionService` 的核心判断为：

```text
角色权限位
AND 角色数据权限
AND 审批状态权限
```

另有待办任务特例：若请求带审批任务 ID，且当前用户是该任务审批人、任务资源 ID 与当前资源一致，则按待办资源路径授权。

MicroMatrix 本轮新增：

- `ScopeResolverService`
- `ResourceAccessContext`
- `ResourceAccessService`
- `DataScopeService.matchesResource()`

当前已覆盖“权限码 + 数据范围”的公共抽象。

尚未覆盖：

- 审批状态权限配置
- `Approval-Task-Id` 待办特例
- 批量资源权限统一 Guard/Decorator

这些项目归入 Wave 4 审批引擎重构。

## 9. 本轮已经落地的代码

### Prisma

- `ResourcePool`
- `ResourcePoolPickRule`
- `ResourcePoolRecycleRule`
- `ResourceCapacity`
- `ResourceOwnerHistory`
- Lead/Customer 增加 `poolId/collectedAt/poolEnteredAt`
- migration：`20260817103000_wave1_resource_pools`

### Common

- `ScopeResolverService`
- `ResourceAccessService`
- `DataScopeService.matchesResource()`

### Pool

- Pool 配置 CRUD
- 启停
- Pool options
- Capacity CRUD
- 范围重复校验
- 每日领取限制
- 新数据冷却
- 前负责人冷却
- 库容校验
- 负责人历史查询
- 自动回收目标池匹配
- 兼容默认池全员可见，但不会把普通成员自动设为池管理员

### Lead / Customer

- 列表按 `poolId` 查询
- 兼容旧 `poolId=null` 池数据
- 退池时指定目标池
- 领取规则执行
- 分配/变更负责人写历史
- 自动/手动退池写历史
- 负责人起始时间维护
- 负责人历史 API
- 普通列表批量字段修改（字段 ID/key、自定义字段、owner 特殊路径）
- 普通列表批量删除
- Pool/Sea 独立批量修改/删除权限与成员校验
- Customer 删除 Contact/Opportunity/Quote/Contract 引用保护
- Lead/Customer Web 多选批量工具条
- Lead/Customer/Pool/Sea xlsx ADD/UPDATE 两阶段导入
- 普通与池/公海导出全部/选中 + 字段顺序选择
- ExportTask 创建者隔离、下载/清理与 24h 过期契约

## 10. Wave 1 尚未完成项

按优先级继续：

1. ~~批量领取、批量分配、批量退池、批量删除、批量字段更新。~~ R1 已全部落地并验收；联系人独立批量能力归 R3。
2. ~~客户库容 `filters` 真正参与计数。~~ 已落地，并在 W1.7 将 Scope 防重升级为“实际成员集合交集”判断。
3. ~~新 `ResourcePoolRecycleRule.conditions` 条件求值器与 cron 切换。~~ 已落地并通过 7 条规则单测 + smoke。
4. ~~Web 多池/多公海配置页面及池切换 UI。~~ 多池切换、规则设置、隐藏字段与池列表列裁剪已落地并验收。
5. ~~隐藏字段配置在池列表真正生效。~~ 已完成，名称字段同时有前后端不可隐藏约束。
6. ~~CustomerCollaboration 细粒度 READ_ONLY / COLLABORATION 权限继续补齐。~~ 客户/联系人/跟进第一阶段已落地并验收。
7. ~~CustomerRelation 前端。~~ 整组替换 API + CustomerRelationsPanel + Detail/Drawer 接入已落地并验收。
8. ~~Customer merge preview + 前端安全向导。~~ 独立权限、impact preview、冲突策略和两步向导已落地并验收。
9. ~~保存的用户视图前端与列配置。~~ SavedViewBar + Lead/Customer 接入 + per-view 本地列偏好已落地并验收。
10. ~~xlsx 导入导出与池内导入导出。~~ R2 已落地并验收；当前明确剩余 `.xls` 兼容和 Metadata 字段级 unique 规则。
11. 线索/客户字段 diff 公共服务已落地；继续扩大到所有写入口并补完整操作历史时间线。
12. 资源删除引用检查与级联清理语义对齐。

## 11. 验收状态

当前属于 **Wave 0 公共底座已落地 + W1.1-W1.7 已验收 + R1/R2 已验收 + 当前执行计划仍有 R3-R6**，不能标记整个 Wave 1 对齐阶段完成。

已找到用户真实 Node/pnpm 环境（Node 24.5.0 / pnpm 10.30.3）并实际完成验证。当前 Prisma Client 已重新 generate，R2 `export_tasks` migration 已应用，数据库共 15 个 migration。

`scripts/smoke.mjs` 当前包含 **109 条实际断言**，除 R1 覆盖外，R2 新增真实 xlsx 模板/预检/导入新建/唯一ID更新、Pool/Sea owner 排除与归属、字段顺序导出、ExportTask 创建者隔离与池导出权限测试；`resource-recycle-condition-evaluator.test.ts` 另有 7 条纯规则测试。
