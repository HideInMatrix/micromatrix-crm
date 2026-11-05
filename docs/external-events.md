# 外部事件配置与 API 调用（首期）

管理员入口：**系统 → 企业设置 → 外部事件**，对应前端路径 `/system/settings/external-events`。仅具备 `system:setting` 的账号可以查看，只有具备 `system:setting:update` 的账号能够维护事件与进行模拟校验。

## 配置流程

1. **基本信息**：填写名称、唯一 `eventType`、来源 `source`，选择拥有 API Key 的 CRM 账号，先保持停用。
2. **资源定位**：将外部参数对应到线索/客户的稳定字段 key。普通事件定位器使用 AND 精确匹配；缴费成功同步会同时检查 Customer 和 Lead，禁止多条命中、跨模块独立记录冲突、越权或模糊匹配。
3. **执行动作 / 流程方案**：保留原有更新、创建、线索转化单动作；新增「缴费成功同步」组合流程：按姓名 + 手机号同时匹配客户和线索，命中客户则更新客户字段，命中线索则直接转化为客户并写入客户字段；均未命中时不创建客户，正式调用返回 `PAYMENT_TARGET_NOT_FOUND`。客户保留原负责人，线索转化继承线索负责人。
4. **字段映射**：允许外部参数映射至非系统、可写的动态字段。单选、多选等选项字段支持配置外部值到 CRM 选项值的映射，例如 `PAID` → `paid`。`Customer.owner` **不是**动态字段；缴费成功同步会保留客户原负责人，线索转化继承线索负责人。
5. **测试配置**：保存配置后使用无写入的模拟执行检查身份匹配、字段类型、选项值及客户完结规则。核验无误再启用事件。

配置保存到 `ExternalEventTemplates`，同一租户中的 `eventType` 唯一，`version` 随修改递增。管理员可在「查看接口」中复制根据映射动态生成的请求示例（cURL / JavaScript / Python）并模拟调试。正式调用审计统一在「系统日志 → 事件日志」查看。

## 第三方单次调用

`POST /api/external-events/execute`

认证方式：`X-Access-Key` 和 `X-Secret-Key`；不接受 JWT 代替 API Key。事件必须启用且 API Key 必须属于管理员为该事件绑定的 CRM 账号，仍遵守该账号的 RBAC 和数据范围。

下方是假设管理员配置的 `RECEPTION_COMPLETED`，示例仅表达请求结构，外部参数实际取决于租户配置：

```json
{
  "source": "reception-system",
  "eventType": "RECEPTION_COMPLETED",
  "externalEventId": "RECEPTION-20261014-0001",
  "data": {
    "phone": "13800000000",
    "receptionistUserId": "B_TEACHER_CRM_OR_EXTERNAL_USER_ID"
  }
}
```

若定位到 A 老师负责的线索，事件可以原子地转换为 Customer，并指定 B 为 `Customer.owner`。原线索仍保留 A，线索关联与跟进历史按照现有转换机制处理。若定位到已存在的客户，只更新允许写入的客户动态字段，不会静默转移负责人。

接口复用 `ExternalEventInbox` 幂等收件箱：同一租户、来源、`externalEventId` 重放相同参数会返回已有成功结果，不重复创建客户；重复编号携带不同参数将返回 `IDEMPOTENCY_KEY_REUSED`。事件执行失败会保存状态和错误原因，整体事务回滚。配置版本发生变化后，已成功的事件不重新执行；对于失败重试，首期按当前启用配置重新验证，调用方应分配新的事件编号来表达新一轮业务事件。

## 兼容与运维

原有 `/api/external-events/customer-sync` 保留，原财务集成不需要迁移。新的执行入口和管理员配置接口属于增量功能。

生产部署前需应用随代码提交的 Prisma 8 forward migration `20261014T0857_external_event_templates`。该迁移仅新增模板表、执行记录的可选事件类型字段以及索引，没有删除现存业务字段。遵循既有 release migration 流程，勿绕过 Prisma migration graph 手工执行 SQL。

当前不支持在同一次外部事件内转移**既有**客户负责人，不开放用户自编脚本或自由执行 SQL。缴费成功同步使用受控的组合分支流程；首期不开放任意节点脚本和任意 SQL。模拟执行只验证当前数据快照，正式执行仍会重新定位并检查并发状态。

## 通用模块动作（v2）

现有 `POST /api/external-events/execute` 请求结构、API Key 和执行日志不变。新建事件配置可选择目标模块（`lead`、`customer`）与动作（`update`、`create`、线索 `convert`、缴费成功同步 `upsertCustomer`）。已移除的线索 `stage` 动作不再接受。

`config.flow` 是可选字段。旧事件未设置该字段时，完全沿用原客户优先定位、线索转客户和客户动态字段更新逻辑，可在兼容编辑器中维护；新事件走模块专属严格定位，不会隐式从线索跳到客户。创建动作不需要定位条件。缴费成功同步使用独立的跨模块姓名 + 手机号定位配置，不使用普通单模块定位条件。

```json
{
  "flow": {
    "target": "lead",
    "action": "update",
    "fields": [{ "source": "event", "externalKey": "note", "fieldKey": "cf_note" }],
    "owner": null
  },
  "matches": [{ "externalKey": "phone", "crmFieldKey": "phone" }],
  "actions": { "convertLead": false, "updateCustomer": false },
  "fields": [],
  "owner": null
}
```

创建时使用 `nameExternalKey` 指定外部数据中的名称字段；旧的创建/转换动作继续使用 `flow.owner`，支持 CRM 或同步过映射的外部成员身份。转换动作的目标模块是 lead，但动态字段映射到新客户；`leadOwner` 来源仅在转换动作中有效。

新增线索时，如果配置了 `flow.owner`，系统会尝试将外部负责人身份解析为当前租户的有效 CRM 成员：匹配成功则正常分配负责人；未匹配、映射不唯一或成员已停用时，则读取字段映射中的 `__leadPool`，根据第三方传入的参数值和 `valueMap` 确定线索池。配置了外部负责人时，必须增加 `__leadPool` 映射，不能使用固定兜底线索池，也不会把线索错误分配给 API Key 调用账号。

`__leadPool` 是新增线索专用的特殊映射目标，不是 CRM 自定义字段。管理员指定外部参数名（例如 `pool`），并配置外部值到 CRM 线索池的对应关系，例如 `1` → 华东线索池、`2` → 华南线索池。负责人匹配成功时仍由该成员负责，不使用线索池映射；负责人无法匹配时，外部参数必须提供已配置的值，否则拒绝创建并返回明确错误。未配置负责人映射但配置了 `__leadPool` 时，则直接按外部参数指定的线索池创建无负责人线索。线索池必须处于启用状态，并且执行 API Key 的账号需要拥有该池的可访问范围。

```json
{
  "flow": {
    "target": "lead",
    "action": "create",
    "nameExternalKey": "studentName",
    "owner": { "externalKey": "ownerId", "provider": "WECOM" },
    "fields": [
      {
        "source": "event",
        "externalKey": "consultStage",
        "fieldKey": "cf_consult_stage",
        "valueMap": [{ "externalValue": "NEW", "crmValue": "new" }]
      },
      {
        "source": "event",
        "externalKey": "pool",
        "fieldKey": "__leadPool",
        "valueMap": [
          { "externalValue": "1", "crmValue": "EAST_LEAD_POOL_ID" },
          { "externalValue": "2", "crmValue": "SOUTH_LEAD_POOL_ID" }
        ]
      }
    ]
  }
}
```

当 `ownerId` 映射到有效成员时，线索仍由该成员负责；当无法匹配时，示例中的 `pool` 决定线索池：传入 `1` 进入华东线索池，传入 `2` 进入华南线索池。此时必须传入 `pool`，且值必须命中已配置的映射，不存在固定兜底池。

第三方调用示例：

```json
{
  "eventType": "LEAD_CREATED",
  "externalEventId": "LEAD-20261105-0001",
  "data": {
    "studentName": "张三",
    "ownerId": "external_user_123",
    "pool": "1",
    "consultStage": "NEW"
  }
}
```

### 缴费成功同步流程

选择 `flow.action = "upsertCustomer"`（保留的配置兼容标识，界面显示为「缴费成功同步」）后，按学生姓名 + 手机号同时精确匹配客户和线索：

1. **匹配到已有客户**：更新客户动态字段（例如缴费状态设为已缴费），保留原负责人。客户字段更新仍遵循现有客户完结规则；若命中配置的完结规则且客户原本位于客户公海，则按现有逻辑在同一事务中移出公海。
2. **没有匹配到客户，但匹配到线索**：直接将线索转化为客户，将外部事件映射的客户动态字段一并写入新客户，继承原线索负责人及跟进历史；无负责人线索按现有转换规则处理。
3. **客户和线索均未匹配到**：不创建客户、不执行任何业务写入，返回 `PAYMENT_TARGET_NOT_FOUND`，事件收件箱和事件日志记录失败原因。
4. **同一身份同时匹配到独立客户与未转化线索**，或任一模块匹配多条记录：拒绝执行并记录冲突，不任意选择记录。

客户手机号字段与线索手机号字段可以分别配置。客户手机号字段必须是可写的手机号/文本型自定义字段，并且必须将同一个外部手机号参数映射到该客户字段，确保后续事件仍能匹配。学生姓名使用 `nameExternalKey`，手机号使用 `identity.phoneExternalKey`。客户与线索的手机号查询均为精确匹配；客户和线索均在同一轮身份解析中检查。已转化线索与其 `transitionId` 指向的客户视为同一业务记录，不作为跨模块重复数据。

缴费成功同步不再配置新建客户负责人策略，也不要求外部系统传递 CRM 负责人。客户更新保留客户原负责人；线索转化继承线索原负责人。无匹配时不会降级为创建客户。

示例配置：

```json
{
  "flow": {
    "target": "customer",
    "action": "upsertCustomer",
    "nameExternalKey": "studentName",
    "identity": {
      "phoneExternalKey": "phone",
      "customerPhoneFieldKey": "cf_phone",
      "leadPhoneFieldKey": "phone"
    },
    "fields": [
      { "source": "event", "externalKey": "phone", "fieldKey": "cf_phone" },
      {
        "source": "event",
        "externalKey": "paymentStatus",
        "fieldKey": "cf_payment_status",
        "valueMap": [{ "externalValue": "SUCCESS", "crmValue": "PAID" }]
      }
    ]
  },
  "matches": [],
  "actions": { "convertLead": false, "updateCustomer": false },
  "fields": [],
  "owner": null
}
```

缴费系统只需调用同一个 `eventType`，例如：

```json
{
  "eventType": "ENROLLMENT_PAYMENT_SUCCEEDED",
  "externalEventId": "PAY-20261104-0001",
  "data": {
    "studentName": "王同学",
    "phone": "13800000000",
    "paymentStatus": "SUCCESS"
  }
}
```

`paymentStatus` 的外部值及 CRM 选项值由管理员在字段映射中配置，不在代码中写死。

### 退费事件

退费不使用 `upsertCustomer` 组合流程。管理员新建普通外部事件，目标模块选择「客户」，业务动作选择「更新当前客户的自定义字段」，定位字段配置为姓名 + 手机号，字段映射将外部退费状态映射为客户自定义缴费状态中的「已退费」。该动作只更新客户字段，不移入客户公海、不转移负责人、不删除客户，也不修改跟进历史。

缴费成功同步在数据库事务内按租户 + 姓名 + 手机号获取事务级 advisory lock，再执行跨模块匹配和写入；不同事件编号的同一学生缴费通知也会串行处理。由于姓名 + 手机号是跨模块身份依据，绑定的 API Key 账号必须具有客户和线索全局数据范围；租户配置了客户公海或线索池时，还必须具有对应的池查询/分配权限。权限不足时直接拒绝执行，避免因看不到数据而误处理。客户更新、线索转化、Inbox SUCCESS 和审计记录在同一数据库事务中提交。

## API Key 调用审计

事件日志归入「系统 → 系统日志 → 事件日志」，与操作日志共用 `OperationLogs` / `OperationLogBlobs`，但使用独立的保留天数、永久保留选项及清理状态。过期清理和手动清空不会影响其他两类日志；`ExternalEventInbox` 幂等记录不受审计清理影响。外部事件配置不再单独展示执行记录。

- API Key 验证通过后调用 `/api/external-events/execute` 或兼容 `/api/external-events/customer-sync`，记录实际调用账号、来源、事件编号、动作、处理结果和业务对象。
- 审计详情保存接口传入的 `source` / `eventType` / `externalEventId` / `data` 或 `where` / `set` 参数的脱敏快照。敏感字段名（密码、Secret、Token、API Key、凭证等）自动脱敏，过大的参数有限制并标注截断；不持久化认证请求头。
- 每次实际请求可产生一条审计记录：成功、失败和幂等重放分别标识，不展示或储存调用次数。
- 业务写入、Inbox SUCCESS 和审计记录同事务提交。失败记录与 Inbox FAILED 一起写入；对相同事件的幂等重放只记录请求，不重复执行业务动作。
- `ExternalEventInbox` 仅负责后端幂等控制，不受审计日志清理影响，避免清理日志后重新执行已经成功的事件。
- 未通过 API Key 身份认证的请求无法关联到有效调用账号，不写入这份业务日志。
