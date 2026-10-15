# 外部事件配置与 API 调用（首期）

管理员入口：**系统 → 企业设置 → 外部事件**，对应前端路径 `/system/settings/external-events`。仅具备 `system:setting` 的账号可以查看，只有具备 `system:setting:update` 的账号能够维护事件与进行模拟校验。

## 配置流程

1. **基本信息**：填写名称、唯一 `eventType`、来源 `source`，选择拥有 API Key 的 CRM 账号，先保持停用。
2. **资源定位**：将外部参数对应到线索/客户的稳定字段 key。现有严格定位器使用 AND 精确匹配，优先查找 Customer，失败则查找 Lead；不允许匹配多条、越权或模糊地降级匹配。
3. **执行动作**：按资源类型启用「线索转换为客户」和/或「已有客户更新动态字段」。新客户负责人可选择继承线索 `owner`，或从外部事件的某个字段解析为 CRM 用户。成员 ID 支持 `CRM`、`WECOM`、`DINGTALK`、`LARK`；后三者需先同步外部成员映射。**已有客户默认不修改 `Customer.owner`。**
4. **字段映射**：允许外部参数映射至非系统、可写的 Customer 动态字段；也可将原线索 `Clue.owner` 映射到一个成员类型的客户字段，记录邀约老师 A。`Customer.owner` **不是**动态字段，必须使用第 3 步配置。
5. **测试配置**：保存配置后使用无写入的模拟执行检查资源定位、字段校验、成员解析及负责人业务约束。核验无误再启用事件。

配置保存到 `ExternalEventTemplates`，同一租户中的 `eventType` 唯一，`version` 随修改递增。管理员可在「查看接口」中复制根据映射动态生成的请求示例（cURL / JavaScript / Python）、模拟调试，以及查看最近 50 条执行记录。

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
