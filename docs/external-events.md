# 外部事件配置与 API 调用（首期）

管理员入口：**系统 → 企业设置 → 外部事件**，对应前端路径 `/system/settings/external-events`。仅具备 `system:setting` 的账号可以查看，只有具备 `system:setting:update` 的账号能够维护事件与进行模拟校验。

## 配置流程

1. **基本信息**：填写名称、唯一 `eventType`、来源 `source`，选择拥有 API Key 的 CRM 账号，先保持停用。
2. **资源定位**：将外部参数对应到线索/客户的稳定字段 key。现有严格定位器使用 AND 精确匹配，优先查找 Customer，失败则查找 Lead；不允许匹配多条、越权或模糊地降级匹配。
3. **执行动作**：按资源类型启用「线索转换为客户」和/或「已有客户更新动态字段」。新客户负责人可选择继承线索 `owner`，或从外部事件的某个字段解析为 CRM 用户。成员 ID 支持 `CRM`、`WECOM`、`DINGTALK`、`LARK`；后三者需先同步外部成员映射。**已有客户默认不修改 `Customer.owner`。**
4. **字段映射**：允许外部参数映射至非系统、可写的 Customer 动态字段；也可将原线索 `Clue.owner` 映射到一个成员类型的客户字段，记录邀约老师 A。`Customer.owner` **不是**动态字段，必须使用第 3 步配置。
5. **测试配置**：保存配置后使用无写入的模拟执行检查资源定位、字段校验、成员解析及负责人业务约束。核验无误再启用事件。

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

首期不支持在同一次外部事件内转移**既有**客户负责人，不提供用户自编脚本或自由执行 SQL，也不保证在未执行数据库并发锁校验时的模拟结果一定等于最终结果。

## 通用模块动作（v2）

现有 `POST /api/external-events/execute` 请求结构、API Key 和执行日志不变。新建事件配置可选择目标模块（`lead`、`customer`）与主动作（`update`、`create`、线索 `convert`、线索 `stage`）。

`config.flow` 是可选字段。旧事件未设置该字段时，完全沿用原客户优先定位、线索转客户和客户动态字段更新逻辑，可在兼容编辑器中维护；新事件走模块专属严格定位，不会隐式从线索跳到客户。创建动作不需要定位条件。

```json
{
  "flow": {
    "target": "lead",
    "action": "update",
    "fields": [{"source": "event", "externalKey": "note", "fieldKey": "cf_note"}],
    "owner": null
  },
  "matches": [{"externalKey": "phone", "crmFieldKey": "phone"}],
  "actions": {"convertLead": false, "updateCustomer": false},
  "fields": [],
  "owner": null
}
```

创建时使用 `nameExternalKey` 指定外部数据中的名称字段；修改线索状态时使用 `stageExternalKey`；创建或转换时的负责人使用 `flow.owner`，支持 CRM 或同步过映射的外部成员身份。转换动作的目标模块是 lead，但动态字段映射到新客户；`leadOwner` 来源仅在转换动作中有效。

所有新动作使用已有 CRM 服务的业务验证；业务写入与 Inbox 的 SUCCESS 状态处于同一数据库事务。当前不开放独立负责人转移、跟进记录及任意多动作串联，防止异步通知与独立业务事务引入半成功/重复执行。


## API Key 调用审计

事件日志归入「系统 → 系统日志 → 事件日志」，与操作日志共用 `OperationLogs` / `OperationLogBlobs`，但使用独立的保留天数、永久保留选项及清理状态。过期清理和手动清空不会影响其他两类日志；`ExternalEventInbox` 幂等记录不受审计清理影响。外部事件配置不再单独展示执行记录。

- API Key 验证通过后调用 `/api/external-events/execute` 或兼容 `/api/external-events/customer-sync`，记录实际调用账号、来源、事件编号、动作、处理结果和业务对象。
- 审计详情保存接口传入的 `source` / `eventType` / `externalEventId` / `data` 或 `where` / `set` 参数的脱敏快照。敏感字段名（密码、Secret、Token、API Key、凭证等）自动脱敏，过大的参数有限制并标注截断；不持久化认证请求头。
- 每次实际请求可产生一条审计记录：成功、失败和幂等重放分别标识，不展示或储存调用次数。
- 业务写入、Inbox SUCCESS 和审计记录同事务提交。失败记录与 Inbox FAILED 一起写入；对相同事件的幂等重放只记录请求，不重复执行业务动作。
- `ExternalEventInbox` 仅负责后端幂等控制，不受审计日志清理影响，避免清理日志后重新执行已经成功的事件。
- 未通过 API Key 身份认证的请求无法关联到有效调用账号，不写入这份业务日志。
