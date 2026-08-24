# W2.4 业务消息触发链路技术设计

## 1. 设计目标

W2.4 在 W2.3 的事件目录、租户设置和底层 `NotificationsService` 之上增加业务事件分发层，使业务模块只负责描述“发生了什么、操作者是谁、业务接收人是谁”，公共层统一完成事件开关、排除操作者、接收人去重和可配置范围解析。

设计遵循以下约束：

- Cordys 业务 Service、审批结束通知和定时任务是事件触发语义的第一事实来源。
- 业务写入先完成，通知失败只记录日志，不把已成功的业务操作伪装成失败。
- 普通业务事件使用业务动作给出的接收人；只有 Cordys 带范围配置的到期/状态事件使用配置解析器扩展接收人。
- 未存在的领域状态和审批对象不为消息事件临时造模。

## 2. 分层结构

```text
客户 / 线索 / 商机 / 报价 / 审批业务 Service
                    │
                    ▼
BusinessNotificationsService
  ├─ excludeSelf / 去重 / 有效成员过滤
  ├─ 调用 NotificationsService（事件开关、落库、SSE）
  └─ best-effort 日志隔离
                    ▲
                    │
MessageExpiryService ── MessageSettingsService.resolveRecipients()
       │                         │
       ├─ 报价 validUntil        ├─ OWNER / 指定成员
       ├─ 合同 endAt             ├─ 角色成员
       └─ 回款计划 dueDate        └─ 当前及上级部门负责人
```

### 2.1 `NotificationsService`

继续作为站内通知原语：

- `notify/notifyMany` 负责事件开关判断、通知落库和 SSE 推送。
- 保留无事件通知的兼容行为，审批待办、预回收提示等不会因 W2.4 被意外关闭。
- 不承担业务事件到接收人的映射，避免底层服务依赖客户、线索等领域模型。

### 2.2 `BusinessNotificationsService`

新增于 `modules/notifications`，由全局 `NotificationsModule` 导出。

输入结构：

```ts
interface BusinessNotificationInput {
  tenantId: string
  event: MessageTaskEvent
  operatorId?: string
  recipientIds: Array<string | null | undefined>
  excludeSelf: boolean
  type: NotificationBizType
  title: string
  content?: string
  link?: string
}
```

执行顺序：

1. 去除空 ID、重复 ID；`excludeSelf=true` 时排除操作者。
2. 一次查询过滤非本租户和非 `ACTIVE` 用户。
3. 接收人为空时直接返回。
4. 调用 `NotificationsService.notifyMany`，由其读取 W2.3 事件开关。
5. 捕获并记录通知异常，不反向破坏已经提交的业务写入。

到期类事件使用第二个入口 `sendConfigured`：先调用消息设置接收范围解析器，再复用上述发送流程，且不排除系统任务上下文中的业务负责人。

## 3. 配置接收范围解析

在 `MessageSettingsService` 增加只读能力：

- `getEffectiveSetting(tenantId, event)`：合并目录默认值与租户覆盖。
- `resolveRecipients(tenantId, event, context)`：仅允许可配置事件调用。

上下文：

```ts
interface MessageRecipientContext {
  ownerId?: string | null
  createUserId?: string | null
}
```

解析规则：

- `userIds` 中的 `OWNER` 使用 `ownerId`；保留对 Cordys `CREATE_USER` 占位符的兼容解析，但当前 UI 不主动添加该值。
- 其他 `userIds` 作为指定成员。
- `roleEnable=true` 时，通过 `UserRole` 查询角色下的有效租户成员。
- `ownerEnable=true` 时，从负责人所属部门开始读取 `Department.leaderId`；`ownerLevel=0/1` 均只包含当前部门，之后每增加一级再沿 `parentId` 增加一层部门负责人，与 Cordys 循环边界一致。
- 最终只保留当前租户 `ACTIVE` 用户并去重；解析结果为空时不回退为负责人或全员。

## 4. 业务事件接入矩阵

### 4.1 客户、联系人和协作团队

| 当前动作       | Cordys 事件                         | 接收人       | 处理说明                         |
| -------------- | ----------------------------------- | ------------ | -------------------------------- |
| 新建客户       | `CUSTOMER_ADD`                      | 客户负责人   | 负责人为操作者时排除             |
| 新建联系人     | `CUSTOMER_CONCAT_ADD`               | 客户负责人   | 保留客户与联系人名称             |
| 新增协作成员   | `CUSTOMER_COLLABORATION_ADD`        | 客户负责人   | 修正当前错误发送给协作成员的差异 |
| 人工变更负责人 | `CUSTOMER_TRANSFERRED_CUSTOMER`     | 新负责人     | 普通客户更新/分配共用            |
| 人工移入公海   | `CUSTOMER_MOVED_HIGH_SEAS`          | 原负责人     | 写入完成后发送                   |
| 自动回收公海   | `CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS` | 原负责人     | 复用现有回收任务                 |
| 公海分配       | `HIGH_SEAS_CUSTOMER_DISTRIBUTED`    | 新负责人     | 根据动作前 `inSea` 区分普通转移  |
| 删除客户       | `CUSTOMER_DELETED`                  | 删除前负责人 | 单条与批量共用                   |

客户 `update` 中直接修改 `ownerId` 的路径必须和独立分配接口走同一通知语义，避免批量字段编辑漏发或重复发送。

### 4.2 线索与线索池

| 当前动作     | Cordys 事件                | 接收人       | 处理说明                         |
| ------------ | -------------------------- | ------------ | -------------------------------- |
| 新建线索     | `CLUE_ADD`                 | 线索负责人   | 不再误用通用“分配”语义           |
| 普通转移     | `TRANSFER_CLUE`            | 新负责人     | 更新和独立分配共用               |
| 人工移池     | `CLUE_MOVED_POOL`          | 原负责人     | 写入完成后发送                   |
| 自动回收     | `CLUE_AUTOMATIC_MOVE_POOL` | 原负责人     | 复用现有回收任务                 |
| 池内分配     | `CLUE_DISTRIBUTED`         | 新负责人     | 根据动作前 `inPool` 区分普通转移 |
| 删除线索     | `CLUE_DELETED`             | 删除前负责人 | 单条与批量共用                   |
| 转/关联客户  | `CLUE_CONVERT_CUSTOMER`    | 线索负责人   | 转换事务完成后发送               |
| 同时创建商机 | `CLUE_CONVERT_BUSINESS`    | 线索负责人   | 与转客户事件分开发送             |

从池中由本人领取时，因接收人与操作者相同且 Cordys 排除自身，不产生站内通知。

### 4.3 商机、报价和审批

| 当前动作       | Cordys 事件                   | 接收人       |
| -------------- | ----------------------------- | ------------ |
| 新建商机       | `BUSINESS_ADD`                | 商机负责人   |
| 修改商机负责人 | `BUSINESS_TRANSFER`           | 新负责人     |
| 删除商机       | `BUSINESS_DELETED`            | 删除前负责人 |
| 删除报价       | `BUSINESS_QUOTATION_DELETED`  | 报价负责人   |
| 报价审批结束   | `BUSINESS_QUOTATION_APPROVAL` | 审批提交人   |
| 合同审批结束   | `CONTRACT_APPROVAL`           | 审批提交人   |
| 订单审批结束   | `ORDER_APPROVAL`              | 审批提交人   |

`ApprovalsService` 新增纯函数映射 `quote/contract/order -> MessageTaskEvent`，只用于审批通过或驳回结果。`receivableRecord` 返回空值并继续发送不带目录事件的通用结果通知；审批待办始终保持通用通知。

## 5. 到期通知执行器

### 5.1 模块归属

新增 `MessageExpiryService`，放在 `modules/notifications` 并由全局模块注册 Cron。移除当前仅支持固定 3 天回款提醒的 `ReceivableReminderService` 定时注册，避免重复发送。

每天 08:00 执行，与 Cordys `NoticeExpireJob` 一致；核心方法接受可注入的 `now`，便于固定时钟测试。

### 5.2 日期窗口

所有日期使用服务器本地日历日，查询窗口统一为 `[目标日 00:00, 次日 00:00)`：

- `EXPIRING`：对配置中的每个 `timeValue` 查询 `today + timeValue`。
- `EXPIRED`：查询今天到期的数据。
- `timeUnit` 仅接受 W2.3 已支持的 `DAY`。

### 5.3 业务过滤

- 报价：`validUntil` 命中，排除 `VOID`。
- 合同：`endAt` 命中，只处理 `EXECUTING`，排除草稿、完成和终止。
- 回款计划：`dueDate` 命中，累计有效回款小于计划金额；接收上下文负责人取合同负责人。

每个租户、每个事件独立执行；事件关闭、提前时间为空、配置接收范围为空均安全跳过。通知链接分别使用现有 `/quotes`、`/contracts` 页面。

## 6. 数据与 API 影响

- 不新增数据库表和迁移；复用 `message_task_settings`、用户、角色、部门和现有业务日期字段。
- 不新增公开 HTTP API；W2.3 设置接口继续作为唯一配置入口。
- 不修改 35 事件目录及消息设置页面结构。
- 通知表暂不增加事件字段；事件只用于发送门控。到期任务按精确日期每天执行一次，不引入跨日重复通知。

## 7. 错误处理与安全

- 所有接收人查询都包含 `tenantId` 和 `ACTIVE` 条件，防止跨租户或禁用账号接收消息。
- 业务操作完成后的通知使用 best-effort 发送；错误写入服务日志，接口仍返回真实业务结果。
- 配置解析不信任 JSON 中的用户/角色 ID，发送前再次做租户有效性过滤。
- 定时任务按租户隔离异常；一个租户失败不得中断其他租户。

## 8. 测试设计

### 单元测试

- `BusinessNotificationsService`：去重、排除操作者、租户/状态过滤、开关透传、异常隔离。
- `MessageSettingsService`：OWNER、指定成员、角色成员、部门负责人层级和空范围。
- 客户/线索：事件选择函数覆盖普通转移与池内分配；转换覆盖客户和商机双事件。
- 商机/审批：新增、转移、删除与审批模块事件映射。
- `MessageExpiryService`：固定日期验证 3/7 天、当天到期、状态过滤、足额回款、开关/空配置跳过。

### 集成与 Smoke

- 关闭目标事件后执行真实业务动作，验证未新增通知；恢复开关后验证通知产生。
- 覆盖客户人工移池、线索带商机转换、商机负责人变更和合同审批结果；回款计划提前提醒由固定时钟自动化测试覆盖，避免新增 Cordys 不存在的公开手工执行 API。
- 测试结束恢复全部消息开关和默认 3 天配置。

## 9. 实施边界

W2.4 完成后，35 个目录事件中 32 个具备真实触发链路（含 W2.3 的 3 个跟进计划事件）。剩余三项必须在后续先补齐对应领域能力：

- `CONTRACT_ARCHIVED`：合同归档状态与页面动作。
- `CONTRACT_VOID`：Cordys 作废状态、原因与阶段流转。
- `INVOICE_APPROVAL`：发票审批对象、状态和审批入口。

上述缺口以及创建人、回款计划负责人、第三方渠道和公告等已发现差异，统一登记在 [`docs/cordys-deferred-backlog.md`](../../cordys-deferred-backlog.md)。W2.4 实现不得删除或弱化这些条目，只能补充证据或推进状态。
