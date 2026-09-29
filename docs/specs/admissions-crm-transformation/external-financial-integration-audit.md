# ADMISSIONS-001 外部财务状态同步能力审计

> 状态：T4 已实现并验收（2026-09-28）

## 1. 结论

现有系统已经具备 API Key 用户上下文、RBAC/Data Scope、Metadata、参数化动态字段过滤、Customer 字段校验和 Lead → Customer 业务能力。T4 不重建这些底座，也不新增 Payment / ConversionResult 一类招生或财务专用模型。

新增核心只有三层：

1. 严格、fail-closed 的动态资源定位器；
2. 可组合的事务级 Lead 转换 / Customer 更新 primitive；
3. External Event Inbox 幂等与审计状态机。

上述三层现已实现；正式入口为 `POST /external-events/customer-sync`。

## 2. API Key 与权限边界

全局 AuthGuard 已支持 X-Access-Key / X-Secret-Key。认证成功后使用 UserKey.createUser 作为当前用户，并继续加载该用户当前角色、权限和数据范围，然后执行控制器权限声明。

因此 External Event API 不需要另建一套 API Key 用户体系，也不得赋予 API Key 超出创建用户现有权限的数据范围。

External Event 应按实际业务分支使用权限：

```text
Customer 查询 / 更新 → customer:update
Lead 查询 / 转换     → lead:update
Lead → Customer      → customer:create
```

查询必须先套数据范围再判断 0 / 1 / 多条，不能先组织级查询再补权限检查，否则会泄露其它部门是否存在相同数据。

## 3. 动态 where 可复用能力

ResourceFieldValueService.filterResourceIds() 已提供安全的动态字段过滤：资源表来自固定白名单、字段来自当前租户 ModuleForm、值使用参数化 SQL，多条件由 buildFilter() 按 AND 组合。

External Resolver 可把每个允许的动态 where 条件编译为：

```text
key = 调用方传入字段 key
op  = eq
value = 调用方传入值
```

首版只接受字段类型本身支持 eq 的字段。date/datetime 当前筛选契约没有 eq，不能私自解释成字符串精确相等。

## 4. UI 筛选器不能直接复用

LeadsService.filterIds() / CustomersService.filterCustomerIds() 是页面筛选辅助逻辑，并非严格机器接口。部分未知系统字段存在宽松容错行为，外部 API 不能使用这种语义。

External Resolver 必须 fail-closed：

```text
未知字段         → INVALID_QUERY_FIELD
不支持 eq        → UNSUPPORTED_QUERY_FIELD
公式/子表字段    → INVALID_QUERY_FIELD
空 where         → INVALID_QUERY
```

错误字段绝不能退化成“不过滤”或“匹配全部”。

## 5. Customer 更新可复用边界

CustomersService.update() 已包含 customer:update 数据范围检查、Metadata 字段校验、类型/选项/unique 校验、ResourceFieldValueService 持久化、事务更新与 BusinessChangeLog。

因此外部 set 不得直接写 CustomerField 表。首版 set 默认只开放当前 Customer 表单中的可写动态字段；系统字段以后逐项显式开放，不接受任意 key。

## 6. 现有 transform 不能原样用于外部事件

LeadsService.transform() 会先校验明确 Lead，但内部 selectTransformCustomer() 在 Customer name 开启 unique 时会按整个 organization 查同名 Customer，并可能自动选择其中一条。

这与 External API 的唯一定位规则冲突：External Resolver 已经按本次 where + API Key 可见范围完成唯一定位，转换阶段不能再按另一套条件猜 Customer。

否则可能关联到当前 API Key 不可见部门的 Customer，并破坏 NON_UNIQUE_MATCH 契约。

T4 已抽出明确 Lead 的受控转换入口：

```text
prepareResolvedLeadConversion()
→ convertResolvedLeadInTransaction()
→ notifyResolvedLeadConversion()
```

该入口只转换 Resolver 已确认的那条 Lead，不再执行组织级 Customer 猜测；事务内会重新确认 transition、owner 与 updateTime，避免准备阶段之后发生并发变化仍继续写入。

Cordys transitionCustomer() 也不能替代该入口，因为它要求调用方提交 Customer payload，且副作用与正式 transform 不完全一致。

## 7. Strict External Resolver

示例请求：

```text
source: finance-system
externalEventId: PAY-20260928-00001
where:
  studentName: 张三
  phone: 13800000000
set:
  status: 已缴费
```

studentName、phone、status 都只是租户自定义字段 key，平台不解释其招生语义。

Customer 优先：

```text
校验 customer:update
→ 解析 Customer 可查询字段
→ 当前 API Key 可见范围内全部 where AND 精确匹配
→ 0 条：继续 Lead
→ 1 条：RESOLVED_CUSTOMER
→ 多条：NON_UNIQUE_MATCH
```

Lead 回退：

```text
校验 lead:update + customer:create
→ 解析 Lead 可查询字段
→ 当前 API Key 可见范围内全部 where AND 精确匹配
→ 0 条：NOT_FOUND
→ 1 条已转 Customer：归一到 transitionId，并再次校验 Customer 可更新范围
→ 1 条未转：convertResolvedLead
→ 多条：NON_UNIQUE_MATCH
```

唯一 Lead 没有负责人时继续沿用正式转换约束，返回可诊断错误，不允许 External Event 随意选择负责人。

## 8. 字段解析规则

where 至少一个条件，固定 AND，不接受调用方自定义 operator、原始 SQL 或 Prisma where。动态字段必须存在并支持 eq；系统字段只允许显式白名单。

Customer 与 Lead 分别解析字段。首版直接接受 Metadata field key 或 field id，不新增组织级外部字段映射表；只有未来第三方 external key 与 CRM field key 无法对齐时再增加可选名称映射。字段映射永远只解决 externalKey → resourceFieldKey，不定义固定身份字段组合。

不能因为某资源缺少一个 where key 就静默删除该条件后继续查询，否则会扩大命中范围。

## 9. 原子性缺口

当前 transform 自己开启事务，之后再调用 CustomersService.update() 会形成第二个事务。下面的串行实现禁止使用：

```text
await leads.transform(...)
await customers.update(...status...)
mark event success
```

如果第二步失败，会出现 Lead 已转 Customer、财务状态未写入的半完成状态。

当前实现已经把以下动作放进同一可恢复一致性边界：

```text
External Event Inbox 幂等锁
可选 Lead → Customer
Customer 动态字段更新
Event SUCCESS
```

Customer 直接更新分支会在事务内重新确认 owner 与 updateTime；Lead 分支会在事务内重新确认 transition、owner 与 updateTime。任一业务写入失败时整个业务事务回滚，随后在独立写入中把 Inbox 记录为 FAILED，从而避免“Lead 已转 Customer 但财务状态未写入”的不可恢复半完成状态。

## 10. External Event Inbox 最小模型

```text
ExternalEventInbox
  id
  organizationId
  source
  externalEventId
  requestHash
  apiKeyUserId
  status: PROCESSING / SUCCESS / FAILED
  resolvedType: CUSTOMER / LEAD
  resolvedId
  customerId
  attempts
  receivedAt
  startedAt
  completedAt
  updatedAt
  errorCode
  errorMessage
```

唯一约束：organizationId + source + externalEventId。

Inbox 不保存银行卡、支付凭据或完整敏感支付载荷，只保留最小定位/更新审计摘要。requestHash 使用 canonicalized `where + set` 的 SHA-256，用于拒绝同一 externalEventId 被不同请求内容复用；FAILED 可安全重试，PROCESSING 超过 15 分钟视为 stale 并允许重新抢占，attempts 记录处理次数。

Prisma migration：

```text
20260928T0309_add_external_event_inbox
from = d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c
to   = 9d7edfaa09a05603882af604f7f566ac550540b03765f1a984fad2fe4625f3fc
```

该 migration 只新增 `external_event_inbox`、3 个索引和约束，4 个 operation 全部为 additive；开发数据库已执行 `db migrate --advance-ref db` 并通过 `db verify`。

## 11. 验收结果

- Strict Resolver：Customer 优先、Customer 0 → Lead、0/1/多条、NOT_FOUND / NON_UNIQUE_MATCH 已覆盖；
- API Key-only：普通 JWT 调用被拒绝；
- Data Scope：资源查询在判定 0/1/多条前先套 owner 范围；
- Customer set：field id / stable key 归一、系统字段拒绝、Metadata 类型校验已覆盖；
- Inbox：成功重放、不同 payload 复用幂等键、PROCESSING 并发冲突、FAILED 重试已覆盖；
- 原子性：Lead 转换事务内模拟后续失败时业务写入回滚，Inbox 最终记录 FAILED；
- T4 focused tests 34 项通过，API TypeScript typecheck 通过。
