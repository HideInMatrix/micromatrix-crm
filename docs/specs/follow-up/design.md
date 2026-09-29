# Follow-up 统一协同设计

## 1. 领域边界

```text
Lead / Customer
      │
      ├── FollowUpPlan
      │     ├── Field / FieldBlob
      │     ├── Comment / Mention
      │     └── convert
      │             ↓
      └── FollowUpRecord
            ├── Field / FieldBlob
            ├── Attachment
            └── Comment / Mention
```

计划与记录都以 `tenantId + targetType + targetId` 绑定业务对象；`targetType` 只允许 `lead/customer`。

## 2. 数据访问

- 列表和详情先按 tenant 隔离，再按 Lead/Customer 对应权限与 DataScope 计算可见范围。
- 客户协作者只获得既有协作类型允许的读取/写入边界，不因为存在协作关系绕过客户权限。
- 池中 Lead 和公海 Customer 的访问继续由各自 pool 规则决定，Follow-up 不自行发明第二套范围模型。

## 3. 动态字段

`followPlan` 与 `followRecord` 都属于 ModuleForm 资源。普通值进入对应 Field 表，复杂值进入 Blob；校验、唯一性、附件 claim、动态筛选和展示解析复用 Metadata。

跨表单复制只执行显式 formLink：

- `PLAN_TO_RECORD`：计划 → 跟进记录。
- `CLUE_TO_RECORD`：线索 → 跟进记录。
- `CUSTOMER_TO_RECORD`：客户 → 跟进记录。

不再保留 Opportunity 相关 formLink。

## 4. 转换事务

计划转记录在一个 Prisma transaction 中完成：检查计划未转换 → claim → 创建 FollowUpRecord → 写 Field/Blob → 更新目标最近跟进信息 → 回写计划 `convertedRecordId`。任何后续步骤失败都回滚业务写入。

## 5. 评论模型

计划评论和记录评论共享相同的两层评论语义：

- 顶层评论分页。
- 回复只能挂顶层评论，禁止形成第三级。
- Mention 关系单独持久化。
- `commentCount` 使用原子事务同步维护。
- 编辑保留 before/after 日志元数据。

事件根据资源和 targetType 映射到 Customer / Clue 的计划或记录评论事件；通知服务负责收件人去重、租户成员过滤和渠道投递。

## 6. 调度

到期提醒只扫描 `PREPARED / UNDERWAY` 且处于当天提醒窗口的计划。`dueNotifiedAt` 作为幂等边界；修改计划时间时按服务规则重置提醒状态。

调度通过统一 DistributedCoordinator 执行，Redis unavailable 时使用既有 PostgreSQL fallback，不引入 Follow-up 私有锁。

## 7. 前端

PC 与 Mobile 只通过 API 和共享 DTO 访问 Follow-up。目标选择、联系人选择、动态表单、评论和附件应复用领域组件/composable；路由 View 不重复实现资源状态机。

当前产品没有独立 Opportunity 跟进入口；任何历史 Opportunity 文档/路由不得作为当前实现依据。
