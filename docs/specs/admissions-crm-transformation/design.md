# ADMISSIONS-001 通用招生 CRM 演进设计

> 状态：边界设计 v4（2026-09-24）

## 1. 设计方向

系统从“按传统 CRM 模块组织”改为“通用资源 + 可配置业务过程 + 可配置工作台”。

```text
Lead / Customer / Contact
        │
        ├── Owner / Organization / RBAC
        ├── Dynamic Form / Dictionary / User View
        ├── FollowUp / FollowUpPlan / Attachment
        ├── Pool / SLA / Recycle Rule
        ├── Configurable Stage / Business Event
        └── External Event Integration
                    │
                    ├── Existing Lead → Customer Conversion
                    └── Customer Dynamic Fields
                                │
                                └── Workbench Metrics / Funnel / Trend / Ranking
```

招生只是这套能力的第一种组合：

```text
来源渠道 → 线索 → 分配 → 跟进 → 到访/签到
                                      │
                                      └─ 外部财务系统：缴费/报名
                                                   │
                                                   ▼
                                             CRM External API
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         ▼                                                   ▼
                   已是 Customer                                         仍是 Lead
                         │                                                   │
                         │                                      复用既有 Lead → Customer
                         │                                                   │
                         └──────────────────────┬────────────────────────────┘
                                                ▼
                                      更新 Customer 动态字段
```

## 2. 现有代码的处理原则

当前 `apps/api/src/app.module.ts` 已加载完整 CRM 模块；`apps/web/src/router/menu.ts` 与 `packages/shared/src/system.ts` 已具备模块配置能力。

因此第一步优先调整模块注册、导航默认值和组合关系，不先做数据库大删。

### 2.1 保留层

- `auth/common/prisma/redis`
- `departments/members/roles`
- `metadata/custom-forms/dictionaries/user-views`
- `leads/customers/contacts/pool-rules`
- `follow-ups/follow-up-plans/attachments`
- `notifications/message-settings/announcements/logs`
- `import-export`
- `enterprise-integrations/*-sso/organization-sync`

### 2.2 改造层

- `home`：从传统销售统计改为可配置工作台；
- `dashboard`：与首页工作台解耦，重新界定为分析/外部仪表板能力；
- `module-configs`：成为业务模块启停和组合入口；
- `customers`：保留 Customer 主体和客户公海，统一客户/联系人/公海的权限与视图逻辑；
- `contacts`：保持通用 Contact 领域并支持 Customer 子资源关系；
- `pool-rules`：继续承载领取、分配、回收与 SLA 的通用规则计算。

### 2.3 删除候选层

- `opportunities`
- `products` 的现有销售商品/价目体系
- `quotes`
- `contracts` 及仅服务传统交易链的附属页面
- `orders`
- `bidding`

删除候选必须先经过调用方审计；被其它核心模块使用的通用组件、金额类型、行项目工具、审批能力等应先抽离，再删除领域模块。

## 3. 领域关系

### 3.1 Lead

Lead 是招生主流程的入口资源。

负责保存：

- 基础身份/联系方式；
- 来源；
- 负责人；
- 当前阶段；
- 最近跟进；
- 池归属；
- 动态字段；
- 转化关联。

Lead → Customer 的正式转换只负责创建/复用 Customer、按既有规则创建 Contact，并复制 FollowUp、FollowUpPlan、Attachment 等通用跟进资产。转换完成后写入 `transitionType=CUSTOMER` 和 `transitionId=customerId`。

转换链已经移除 Opportunity 创建、Opportunity Stage 初始化、Lead → Opportunity 字段迁移、`oppCreated / oppName / opportunityId` API 契约以及“线索转商机”通知副作用；`LeadsModule` 不再依赖 `OpportunitiesModule`。

### 3.2 Customer

Customer 是形成稳定关系后的业务主体，不与“已缴费学生”文案强绑定。

Lead 的最终转化可以建立或关联 Customer，但转化结果本身不强制等于 Customer 创建。

### 3.3 Contact

Contact 表达 Customer 周围的关联人员。Contact 生命周期独立于商机、合同、订单，因此交易链删除不影响 Contact。

### 3.4 Pool

Pool 是资源治理能力，不是单纯页面。

线索池和客户公海都属于招生核心池能力。领取、分配、回收、容量、冷却、超时等无状态规则应保持可复用。

SLA 不建立独立规则表，直接复用每个资源池现有的回收条件：

- `storageTime + scope=Created`：按资源创建时间判断；
- `storageTime + scope=Picked`：按最近领取时间判断；
- `followUpTime`：按最近跟进时间判断；从未跟进时按超时命中处理；
- `AND / OR`：组合首次跟进 SLA、持续跟进 SLA 等规则。

`autoRecycle` 只表示“命中 SLA 后是否自动执行回收”，不是 SLA 本身的开关。即使关闭自动回收，也允许保存 SLA 条件，供后续工作台超时统计与提醒复用。自动回收仍由现有 PoolRecycleService 执行，不再建立招生专用定时任务。

典型首次跟进 SLA：

```text
最近领取时间早于 N 天前
AND
最后跟进时间早于 N 天前
```

由于空 `followUpTime` 视为命中，刚领取的数据仍会被第一条“领取时间”条件保护，不会立即被判定为可回收。

### 3.5 渠道来源

“招生渠道”不建立独立的 AdmissionsChannel 领域表，也不把官网、抖音、地推、转介绍等渠道写成代码枚举。

当前 Lead 默认表单已经提供：

```text
cf_source
label = 线索来源
type = select
system = false
```

它属于普通动态字段，渠道选项由租户通过现有表单设计器维护。默认选项只作为初始模板，不是平台固定渠道字典。

因此渠道能力的边界为：

```text
渠道值维护
→ Dynamic Form / select options

线索入库
→ 按普通 Metadata 字段写入、校验、导入导出

筛选与视图
→ 复用现有动态字段高级筛选 / Saved View

工作台渠道统计
→ 从工作台配置中选择具体 Lead 字段作为“渠道维度”
→ 默认可选择 cf_source
```

统计层不得永久写死 `cf_source`。如果某个租户新建了“校区来源”“投放计划”“合作机构”等其它可枚举字段，应能在后续工作台配置中选择其中任意一个作为渠道分析维度。

外部系统写入渠道时同样只写 Metadata 字段值，不创建招生专用渠道 API；字段选项、类型和可写性继续由现有动态表单校验负责。

### 3.6 Owner / 组织绩效维度

“招生老师”直接复用 User/Member + Lead/Customer 的 `owner`，不创建 AdmissionsTeacher 模型。

现有首页统计底座已经提供通用维度：

- `HomeDepartmentScopeService`：按当前用户权限解析全部、自身、指定部门及下级成员范围；
- `HomeStatisticRequest.searchType`：`ALL / SELF / DEPARTMENT`；
- `HomeStatisticRequest.userField`：`OWNER / CREATE_USER`；
- `HomeClueStatisticQuery`：在上述范围内按 Lead owner/createUser 聚合。

因此人员/部门绩效只需要在 T5 的指标层选择“统计什么事实”，而不是重新解决“按谁、按哪个部门统计”。可选事实包括 Lead 新增、持有、跟进、Stage Event、Lead→Customer 转化以及配置化 Customer 结果字段。

现有 `home/overview/ranking` 仍以 Opportunity 赢单金额/回款金额为口径，属于传统交易链遗留实现；招生工作台不得继续复用该口径，T5 应以通用指标查询层替换。

## 4. 阶段与外部业务事实

### 4.1 Stage

Stage 表达过程进度。招生方案可配置：

```text
待联系 → 已联系 → 已邀约 → 已到访 → 已签到 → 已转化
```

但系统不把这些值写成全局固定枚举。

当前实现将阶段定义保存到 Lead 表单级 `formProp.leadStages`：

```text
leadStages[]:
  key       稳定内部 key
  name      租户可编辑显示名称
  kind      ACTIVE / SUCCESS / FAILURE
  enabled   是否允许继续流入
```

当前阶段仍存放在 `Clue.stage`，不引入阶段配置表；默认 key 兼容原 `NEW / FOLLOWING / INTERESTED / SUCCESS / FAIL` 数据。新建 Lead 使用第一个启用阶段，领取/分配/回收属于资源动作，不再隐式修改业务阶段。

阶段 key 受现有 `Clue.stage` 数据库约束限制为 30 字符。已被历史线索使用的 key 不能直接删除，只能先停用或迁移历史数据。

### 4.1.1 SLA / 超时未跟进

SLA 不建立第二套时间算法，直接复用资源池的 `storageTime / followUpTime` 条件和 `ResourceRecycleConditionEvaluator`：

```text
CluePool.enable = true
  + recycleRule.condition 有有效时间条件
  → 可参与 SLA / 超时统计

CluePool.auto = true
  → 在满足同一条件时额外执行自动回收
```

因此关闭“自动回收”不会关闭 SLA；工作台仍可以显示超时线索。当前 `LeadPoolSlaService` 负责解析线索池作用域、匹配当前 owner 和同一套 evaluator，Home 通过 `/home/statistic/lead/overdue` 消费该能力。后续提醒调度也必须复用此服务。

提醒调度已经复用同一能力：

```text
每天 09:00
  ↓
DistributedCoordinatorService
job = lead-sla-reminder
slot = DAILY
  ↓
LeadPoolSlaService.overdue(...)
  ↓
CLUE_FOLLOW_UP_OVERDUE
  ↓
当前 owner
```

多实例通过现有 DAILY 调度槽避免同日重复执行；Redis 可用时使用 36 小时 claim-once，Redis 不可用时由 PostgreSQL advisory lock 保证同一时刻只有一个实例执行。消息仍通过现有 `BusinessNotificationsService`，因此站内消息和企业消息渠道继续受租户消息设置控制。

兼容策略：

- `Clue.stage` 继续保存当前阶段 key，不新增第二份“当前阶段”字段；
- 旧 `NEW / FOLLOWING / INTERESTED / SUCCESS / FAIL` 只作为无配置租户的默认 Stage Config，因此历史数据无需迁移；
- 新建 Lead 使用配置中第一个启用阶段；
- 状态更新 API 不再接受固定 enum，而是校验请求 key 必须存在于当前租户配置且处于启用状态；
- PC 列表筛选和状态展示从 `leadStages` 读取，停用阶段仍保留在筛选中以便迁移历史数据；
- 删除阶段时，如果仍有 Lead 使用该 key，配置保存必须拒绝；允许“停用但保留”；
- 领取、分配、回收等资源归属动作不再自动把业务阶段改成 `FOLLOWING`；
- 传统 Bidding 转 Lead 的兼容入口也必须读取当前 Lead 默认阶段，不能写死旧阶段。

阶段配置入口位于系统“模块配置 → 线索”的模块级配置中，不复用准备删除的 OpportunityStageConfig。

### 4.2 Business Event

仅保存 `Clue.stage` 只能回答“现在在哪个阶段”，不能可靠回答“何时进入过哪个阶段”。工作台漏斗如果需要阶段进入量、阶段耗时、阶段回退等历史口径，必须保存独立业务事件。

Business Event 不得复用 `OperationLogs`：操作日志存在租户级保留期限和清理任务，若漏斗依赖它，会出现日志过期后历史指标消失的问题。

当前最小事实模型：

```text
LeadStageEvent
  id
  organizationId
  leadId
  fromStageKey
  toStageKey
  occurredAt
  operatorId
  ownerId
  source          MANUAL / IMPORT / RULE / EXTERNAL / SYSTEM
```

要求：

1. 当前阶段更新与 Stage Event 写入必须处于同一事务边界；
2. Event 只记录业务事实，不复制 Lead 全量快照；
3. 阶段配置改名不改历史 key，因此历史事件仍可关联当前/历史配置解释；
4. Event 不受操作日志 retentionDays 清理策略影响；
5. 工作台同时支持“当前阶段存量”和“阶段进入事件量”两种口径。

当前 contract 已加入 `LeadStageEvent`，但它**不对 Clue 建级联 FK**。原因是 Stage Event 是独立业务事实：Lead 被删除后，历史漏斗和阶段到达量不应一起消失。事件只保存稳定 `leadId` 与当时 `ownerId`，不复制 Lead 全量快照。

写入链路：

- 新建 Lead：与 `Clue.create`、动态字段写入处于同一事务，写入 `null → initialStage`；
- Excel/批量导入新建：复用 create 链路，source 为 `IMPORT`；
- 手工阶段切换：`Clue.stage / lastStage` 更新与 Stage Event 创建处于同一事务；
- 重复写入当前相同阶段时直接返回，不产生重复事件；
- `markInvalid` 继续复用 `updateStatus`，因此不会产生第二套事件逻辑；
- 后续规则引擎和 External API 可分别传入 `RULE / EXTERNAL` source，不需要修改数据模型。

数据库迁移已通过 Prisma 8 正式 `contract emit + migration plan` 生成：

```text
migrations/app/20260928T0247_add_lead_stage_event
from = dee42ec15d90123679a39e92cd8468c445ed20dea1161a6b69ba8c615206c7b1
to   = d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c
```

Migration 只包含：

- 新增 `lead_stage_event`；
- 4 个查询索引；
- 8 个长度约束；
- 无 DROP/ALTER 其它业务表；
- 无 data transform placeholder；
- 全部 operation 均为 additive。

开发数据库已执行 `db migrate --advance-ref db`，marker 与 `db` ref 均推进到新 contract hash，随后 `db verify` 通过。

### 4.3 外部财务事件

缴费、报名成功属于财务系统的领域事实，CRM 只消费事件，不成为支付或财务真相来源。

推荐边界为：

```text
Finance System
      │
      │ authenticated external event
      ▼
ExternalEvent API
      │
      ├─ validate source / event id / resource locator
      ├─ enforce idempotency
      ├─ resolve CRM resource
      │
      ├─ Customer ───────────────────────────────┐
      │                                           │
      └─ Lead → Existing Lead Conversion Service │
                                                  ▼
                                   Customer Dynamic Field Service
                                                  │
                                                  ▼
                                     Audit / External Event Log
```

#### 4.3.1 外部 API 的动态字段条件定位

外部 API 不读取“线索判重设置”来决定查询字段，也不要求管理员预先配置固定的身份字段组合。第三方平台在每次请求中直接提供本次定位数据所需的字段条件。

推荐请求语义：

```json
{
  "where": {
    "studentName": "张三",
    "phone": "13800000000"
  },
  "set": {
    "status": "已缴费"
  }
}
```

`studentName`、`phone`、`status` 都可以是用户在表单设计器中自行创建的动态字段，平台不理解这些字段的招生语义。

处理流程：

```text
API Key
  ↓
解析为 API Key 创建用户
  ↓
套用现有角色 / Permission / Data Scope
  ↓
解析本次 where 字段
  ↓
所有条件 AND 精确查询
  ├─ 0 条  → NOT_FOUND
  ├─ 1 条  → 唯一定位成功
  └─ >1 条 → NON_UNIQUE_MATCH
```

调用方遇到 `NON_UNIQUE_MATCH` 时自行增加更多允许查询的字段，例如部门、校区、报名编号或其它自定义字段，直到当前 API Key 可见范围内只命中一条。

查询能力必须复用 Metadata 字段解析和现有数据范围逻辑，不允许第三方传入原始 SQL、任意 Prisma where 或绕过 Scope 的查询表达式。

#### 4.3.1.1 Customer / Lead 解析顺序

财务同步接口的资源定位顺序：

1. 在当前 API Key 可见范围内，使用本次 `where` 条件查询 Customer；
2. Customer 恰好 1 条：直接使用该 Customer；
3. Customer 多于 1 条：返回 `NON_UNIQUE_MATCH`；
4. Customer 为 0 条：使用同一组可解析条件查询 Lead；
5. Lead 恰好 1 条且未转换：调用既有 Lead → Customer 转换；
6. Lead 恰好 1 条但已转换：通过 transitionId 归一到已有 Customer；
7. Lead 多于 1 条：返回 `NON_UNIQUE_MATCH`；
8. Customer / Lead 均为 0 条：返回 `NOT_FOUND`。

首版不新增独立外部字段映射表：`where` / `set` 直接接受当前 Metadata field key 或 field id。如果 Lead 与 Customer 对应动态字段 key 不同，调用方可以分别使用各资源现有字段标识；未来只有在第三方 external key 与 CRM field key 无法对齐时才增加可选名称映射。字段映射只解决名称对应，不定义“哪些字段共同代表唯一学生”。

#### 4.3.1.3 External Event 幂等与事务

正式入口：

```text
POST /external-events/customer-sync
认证：X-Access-Key + X-Secret-Key
普通 JWT：拒绝
```

幂等键：

```text
organizationId + source + externalEventId
```

Inbox 还保存 canonicalized `where + set` 的 SHA-256 `requestHash`。相同 eventId + 相同 payload 在 SUCCESS 后直接返回既有结果；相同 eventId + 不同 payload 返回 `IDEMPOTENCY_KEY_REUSED`；正在处理返回 `EVENT_PROCESSING`；FAILED 或超过 15 分钟的 stale PROCESSING 可以安全重试并递增 attempts。

业务提交边界：

```text
Customer 命中：
  Customer 动态字段更新
  + Inbox SUCCESS
  = 同一事务

Lead 命中：
  Resolved Lead → Customer
  + Customer 动态字段写入
  + Inbox SUCCESS
  = 同一事务
```

事务失败时业务写入全部回滚，再独立记录 Inbox FAILED。这样不会出现 Lead 已转换但外部结果字段未落库的不可恢复半完成状态。

#### 4.3.1.2 Lead 模块级线索判重设置

当前系统模块设置中已经存在：

```text
线索表单设置
线索池设置
线索库容设置
```

目标新增同级入口：

```text
线索判重设置
```

其职责边界如下：

```text
线索表单设置
→ 定义 Lead 有哪些字段

线索判重设置
→ 不重新选择组合判重字段
→ 读取线索表单中已经开启 unique 的字段
→ 定义这些 unique 字段在入库时的校验隔离范围
→ 保证互不可见的不同资源池不会因为相同唯一字段值互相阻塞

线索池设置
→ 创建具体线索池
→ 配置池成员/可见范围/领取/分配/回收/隐藏字段

线索库容设置
→ 限制负责人最多能持有多少条线索
```

因此“手机号是否唯一”仍在表单字段配置中决定；“这个唯一值在入库时按整个组织校验，还是按当前资源池的数据隔离范围校验”由线索判重设置统一决定。

当前实现采用 Lead 表单级配置：

```text
formProp.leadUniqueScope =
  RESOURCE_POOL   // 默认
  ORGANIZATION
```

`RESOURCE_POOL` 只在“目标是具体线索池”的入库动作中把唯一校验限定到该 poolId；直接创建为私有线索时没有目标池，因此继续沿用组织级唯一。这样不需要新增配置表，也不会修改 Customer/Contact 等其它资源的 unique 语义。

当前核心场景：

```text
手机号字段：
unique = true

线索池 A：
张三 / 13800000000

线索池 B：
张三 / 13800000000

A、B 互不可见：
→ 两条都允许入库
→ B 入库时不能因为 A 已存在相同手机号而失败
```

当配置为 `RESOURCE_POOL` 时，判重边界就是具体目标线索池：不同 poolId 互不参与 unique 冲突计算；当配置为 `ORGANIZATION` 时才恢复整个组织内的历史唯一规则。默认不得使用其它池的数据阻止当前池入库，也不得通过“重复”错误泄露其它池的数据存在。

该模块只影响 CRM 内部的线索新建入池、Excel 预检/导入、手工移入池和批量移入池等流程，不参与第三方 API 的 `where` 条件解析。

#### 4.3.2 动态字段映射

CRM 不预置：

- `paymentStatus`
- `enrollmentStatus`
- `paymentAmount`
- `paymentTime`

等招生/财务专用 Customer 系统字段。

用户通过现有表单设计器创建自己需要的 Customer 字段，例如：

```text
报名状态    SELECT
缴费状态    SELECT
缴费时间    DATETIME
实收金额    DECIMAL
```

外部集成只允许向“当前组织已经存在且允许外部写入”的 Customer 字段映射值。字段类型、选项、必填、唯一性和其它校验仍由现有 Metadata / Dynamic Form 服务负责，外部 API 不绕过字段校验。

首版**不新增独立的外部字段映射表**。调用方直接使用当前 Customer/Lead Metadata 的稳定 field key 或 field id；系统把 field id 归一到稳定 key 后再执行校验和写入。

只有未来某个第三方平台的 external key 无法与 CRM Metadata key 对齐时，才增加可选的 externalKey → fieldKey 映射。该映射只解决名称对应，仍不得定义固定的“学生身份组合”。

#### 4.3.3 复用既有 Lead → Customer 转换

当财务事件定位到 Lead 时，ExternalEvent Service 只负责发起转换，不负责复制转换逻辑。

必须调用当前已经存在并通过验收的 Lead 转换应用服务，以继续获得相同的：

- Customer 创建/关联规则；
- 动态字段迁移规则；
- Owner/负责人历史；
- Contact/关联人员处理；
- FollowUp/FollowUpPlan 迁移或关联规则；
- 转换状态与 transitionId；
- 通知、操作日志及其它已定义副作用。

禁止在外部财务模块中直接执行 `customer.create()` 来替代 Lead 转换。

#### 4.3.4 幂等与一致性

每个外部事件至少具有：

- `organizationId`（由鉴权上下文确定，不信任请求任意指定）；
- `source`；
- `externalEventId`；
- 资源定位信息；
- 经映射后的字段更新意图；
- 接收时间、处理状态和错误摘要。

`organizationId + source + externalEventId` 必须形成幂等边界。

该幂等键只用于“事件去重”，不能代替 4.3.1 的动态字段查询。本次资源是否唯一只由 `where` 在当前 API Key 可见范围内的查询结果决定。

处理要求：

1. 同一事件重试只能得到同一业务结果；
2. 已完成事件不得再次触发 Lead 转换；
3. 并发重复事件必须通过数据库唯一约束/事务锁等机制收敛；
4. “Lead 转 Customer + Customer 动态字段更新 + 事件完成标记”必须形成一致的应用事务边界，或者使用可靠 Inbox/状态机实现可恢复的一致性；
5. 如果转换成功但字段更新失败，事件不能标记为成功；重试时必须识别已经产生的 Customer 并继续完成剩余步骤，而不是创建第二个 Customer。
6. Lead → Customer 转换、Customer 动态字段更新和事件完成状态必须保持一致，不能出现转换成功但字段更新丢失的不可恢复窗口。

当前实现：

```text
POST /external-events/customer-sync
  ↓ @ApiKeyOnly
ExternalResourceResolverService
  ↓
ExternalEventInbox PROCESSING
  ↓
Customer
  ├─ prepareDynamicFieldUpdate
  └─ transaction:
       Customer field update
       + Inbox SUCCESS

Lead
  ├─ prepareResolvedLeadConversion
  └─ transaction:
       Lead → Customer
       + Customer set 字段
       + Inbox SUCCESS
```

Inbox 使用：

- 唯一键：`organizationId + source + externalEventId`；
- `requestHash`：对规范化后的 `where + set` 做 SHA-256，同一幂等键复用不同 payload 返回 `IDEMPOTENCY_KEY_REUSED`；
- `PROCESSING / SUCCESS / FAILED` 状态机；
- SUCCESS 重放直接返回原 `customerId / resolvedType / resolvedId`，不重复执行业务动作；
- PROCESSING 15 分钟内返回 `EVENT_PROCESSING`；
- FAILED 或超过 15 分钟的 stale PROCESSING 使用 `status + updatedAt` 乐观条件原子抢占重试；
- 失败事务回滚后单独写 FAILED/errorCode/errorMessage，不保存完整 where/set 或支付敏感载荷。

Prisma migration：

```text
migrations/app/20260928T0309_add_external_event_inbox
from = d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c
to   = 9d7edfaa09a05603882af604f7f566ac550540b03765f1a984fad2fe4625f3fc
```

Migration 仅新增 Inbox 表、3 个索引及约束，4 个 operation 均为 additive；开发数据库已 migrate 并通过 `db verify`。

#### 4.3.5 安全与审计

财务系统调用使用机器到机器 API Key 鉴权，不复用浏览器用户 Token。External Event Controller 使用 `@ApiKeyOnly()`，即使 JWT 用户拥有同样权限也不能调用。

外部事件日志只保存处理所需的最小审计信息；敏感支付载荷、密钥、完整银行卡/支付凭据不得写入 CRM 日志。

操作日志必须能回答：

- 哪个外部系统；
- 哪个事件；
- 定位了哪个 Lead/Customer；
- 是否发生 Lead → Customer 转换；
- 最终更新了哪些 Customer 字段；
- 处理成功或失败的原因。

External Event Log 是集成审计/Inbox，不是财务账本。

## 5. 工作台

首页统计从固定 Opportunity 指标切换为配置化指标：

- 线索新增量；
- 待跟进数；
- SLA 超时数；
- 各阶段到达量；
- 按配置的 Customer 动态业务字段统计成功量、状态分布或金额；
- 渠道转化率；
- Owner 跟进/转化绩效；
- 时间趋势；
- 漏斗。

所有卡片、漏斗、趋势和排行榜共享同一指标查询层，不能各页面自行拼 SQL。

工作台不得假设某个字段一定叫“缴费状态”或“实收金额”。涉及外部财务结果的指标必须由工作台配置选择具体 Customer 字段、目标值和聚合方式。

当前实现统一由 `HomeAnalyticsService` 输出：

```text
summary
  ├─ totalLeads
  ├─ convertedLeads
  ├─ conversionRate
  ├─ overdueLeads
  ├─ resultCustomers
  └─ resultAmount?

funnel
  └─ LeadStageEvent 去重后的阶段到达量

trend
  ├─ 近 6 个月 Lead 新增量
  └─ 配置 Customer 结果时间字段后的结果量

channels
  └─ 配置 Lead 渠道字段后的线索 / 转客户 / 业务结果

performance
  └─ Owner 维度线索 / 转客户 / 业务结果

resultDistribution
  └─ Customer 结果字段值分布
```

阶段漏斗以业务事件为主：对存在 `LeadStageEvent` 的 Lead，按 `fromStageKey / toStageKey` 推导其曾到达阶段并按 Lead 去重；对于 migration 前尚无事件历史的 Lead，才使用当前 `Clue.stage` 作为兼容 fallback。

Dashboard 点击跳转不直接拼 URL 查询参数，而继续使用一次性 `HomeFilterPayload`：

- `leadStageKey`：阶段漏斗；
- `converted`：已转 Customer；
- `overdue`：通过 `LeadPoolSlaService` 重新解析真实超时 Lead ID；
- `filters`：渠道字段和 Customer 业务结果字段。

因此列表页面仍会重新执行 RBAC、Data Scope、Metadata filter 和 SLA 规则，不依赖前端统计结果作为授权依据。

旧“商机 / 赢单”首页概览已经退出 Dashboard 产品表面，旧 Opportunity 首页统计代码只作为 T6 物理删除候选保留，不再被当前 Dashboard 请求。

## 6. 导航边界

目标信息架构第一版：

```text
首页
线索
  ├─ 线索
  └─ 线索池
客户
  ├─ 客户
  └─ 联系人
分析（可选）
系统
  ├─ 组织与成员
  ├─ 角色权限
  ├─ 模块配置
  ├─ 表单/字段配置
  ├─ 流程/审批
  ├─ 消息设置
  └─ 日志
```

客户公海作为客户域的正式子入口保留，并与客户、联系人保持 PC/Mobile 一致的权限与视图行为。

## 7. 删除安全门槛

物理删除任一旧业务模块必须先生成依赖审计，至少覆盖：

- Route/Menu；
- Web/Mobile API client；
- Nest Module/Controller/Service；
- Prisma relation；
- Metadata/Form key；
- Permission code；
- Home/Search；
- FollowUp/Approval/Notification；
- Import/Export；
- Seed；
- Tests/Smoke；
- 文档。

只要存在核心链路引用，该模块只能处于“隐藏/解耦中”，不能标记“已删除”。
