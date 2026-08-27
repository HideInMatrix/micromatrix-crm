# W3.4.2 线索与线索池源码与 API 证据矩阵

> 执行单元：W3.4.2 / task 3.1
>
> 日期：2026-08-27
>
> 第一事实来源：项目内 `CordysCRM/` 源码。当前 MicroMatrix 实现只用于差异对照，不反推 Cordys 行为。

## 1. 结论

W3.4.2 不能继续沿用当前 `apps/api/src/modules/leads` 下的统一 `/leads` REST Controller，也不能继续让普通线索和线索池通过 `scope=pool` 共用一条列表入口。Cordys 对线索域拆分为以下独立资源：

- 普通线索：`/lead/*`
- 线索池资源：`/pool/lead/*`
- 线索池设置：`/lead-pool/*`
- 线索库容：`/lead-capacity/*`
- 普通线索个人视图：`/lead/view/*`
- 线索池个人视图：`/pool/lead/view/*`
- 线索跟进记录：`/lead/follow/record/*`
- 线索跟进计划：`/lead/follow/plan/*`
- 负责人历史：`/lead/owner/history/*`

MicroMatrix 的 Prisma 直接模型已经具备 `Clue`、`ClueField/Blob`、`ClueOwner`、`CluePool`、`CluePoolPickRule`、`CluePoolRecycleRule`、`CluePoolHiddenField` 和 `ClueCapacity`，因此本阶段不再重建线索数据库底座。主要工作是 API 分域、权限语义、事务副作用、转换链路、池规则和 Vue 页面复刻。

## 2. Cordys 页面与前端调用入口

### 2.1 普通线索

页面主入口：

- `frontend/packages/web/src/views/clueManagement/clue/index.vue`
- `frontend/packages/web/src/views/clueManagement/clue/components/clueTable.vue`
- `frontend/packages/web/src/views/clueManagement/clue/components/clueOverviewDrawer.vue`
- `frontend/packages/web/src/views/clueManagement/clue/components/convertClueModal.vue`
- `frontend/packages/web/src/views/clueManagement/clue/components/convertToCustomerDrawer.vue`

前端 API 统一从：

- `frontend/packages/lib-shared/api/modules/clue.ts`
- `frontend/packages/lib-shared/api/requrls/clue/index.ts`

调用真实后端，不存在截图推断出来的按钮。

普通线索表格真实操作：

| 类型 | 操作 | Cordys 权限 |
| --- | --- | --- |
| 顶部 | 新增 | `CLUE_MANAGEMENT:ADD` |
| 顶部 | 导入 | `CLUE_MANAGEMENT:IMPORT` |
| 顶部 | 导出全部 | `CLUE_MANAGEMENT:EXPORT` |
| 批量 | 导出选中 | `CLUE_MANAGEMENT:EXPORT` |
| 批量 | 批量转移 | `CLUE_MANAGEMENT:TRANSFER` |
| 批量 | 移入线索池 | `CLUE_MANAGEMENT:RECYCLE` |
| 批量 | 关联已有客户 | `CLUE_MANAGEMENT:UPDATE` |
| 批量 | 批量编辑 | `CLUE_MANAGEMENT:UPDATE` |
| 批量 | 批量删除 | `CLUE_MANAGEMENT:DELETE` |
| 行操作 | 编辑 | `CLUE_MANAGEMENT:UPDATE` |
| 行操作 | 跟进 | `CLUE_MANAGEMENT:UPDATE` |
| 行操作 | 转换 | `CLUE_MANAGEMENT:UPDATE`，转换时再检查客户/商机新增权限 |
| 行操作 | 移入线索池 | `CLUE_MANAGEMENT:RECYCLE` |
| 行操作 | 转移 | `CLUE_MANAGEMENT:TRANSFER` |
| 行操作 | 删除 | `CLUE_MANAGEMENT:DELETE` |

已转换线索由 `transitionType` 决定是否继续显示业务操作；前端对 `CUSTOMER/OPPORTUNITY` 关系直接收起行操作，不能仅依据展示状态判断是否已转换。

### 2.2 线索池

页面主入口：

- `frontend/packages/web/src/views/clueManagement/cluePool/index.vue`
- `frontend/packages/web/src/views/clueManagement/cluePool/components/cluePoolTable.vue`
- `frontend/packages/web/src/views/clueManagement/cluePool/components/cluePoolOverviewDrawer.vue`
- `frontend/packages/web/src/views/system/module/components/clueManagement/cluePoolDrawer.vue`

池页面首先读取 `/pool/lead/options`，按当前用户 Scope 返回多个命名池。每个池选项携带：

- members
- owners
- `editable`
- pickRule
- recycleRule
- fieldConfigs

`editable=true` 仅表示当前用户属于池管理员范围，前端据此在池选择器中展示设置图标。

线索池真实操作：

| 类型 | 操作 | Cordys 权限 |
| --- | --- | --- |
| 顶部 | 导入 | `CLUE_MANAGEMENT_POOL:IMPORT` |
| 顶部 | 导出全部 | `CLUE_MANAGEMENT_POOL:EXPORT` |
| 批量 | 导出选中 | `CLUE_MANAGEMENT_POOL:EXPORT` |
| 批量 | 领取 | `CLUE_MANAGEMENT_POOL:PICK` |
| 批量 | 分配 | `CLUE_MANAGEMENT_POOL:ASSIGN` |
| 批量 | 编辑 | `CLUE_MANAGEMENT_POOL:UPDATE` |
| 批量 | 删除 | `CLUE_MANAGEMENT_POOL:DELETE` |
| 行操作 | 领取 | `CLUE_MANAGEMENT_POOL:PICK` |
| 行操作 | 分配 | `CLUE_MANAGEMENT_POOL:ASSIGN` |
| 行操作 | 删除 | `CLUE_MANAGEMENT_POOL:DELETE` |

池页面不复用普通线索写权限。池详情读取、池跟进记录和负责人历史也必须先满足池访问边界。

## 3. Cordys 普通线索 API

Controller：`backend/crm/src/main/java/cn/cordys/crm/clue/controller/ClueController.java`

基路径：`/lead`

| 方法 | 路径 | DTO/结果 | 权限与关键行为 |
| --- | --- | --- | --- |
| GET | `/module/form` | `ModuleFormConfigDTO` | 普通线索 READ 或池 READ 任一权限 |
| POST | `/page` | `CluePageRequest` → `PagerWithOption<List<ClueListResponse>>` | `CLUE_MANAGEMENT:READ` + Dept DataScope + User View |
| GET | `/get/{id}` | `ClueGetResponse` | READ + Resource Scope |
| POST | `/add` | `ClueAddRequest` | ADD |
| POST | `/update` | `ClueUpdateRequest` | UPDATE + Resource Scope |
| POST | `/status/update` | `ClueStatusUpdateRequest` | UPDATE + Resource Scope |
| GET | `/delete/{id}` | void | DELETE + Resource Scope |
| POST | `/transition/account` | `ClueTransitionCustomerRequest` | `CUSTOMER_MANAGEMENT:ADD` |
| POST | `/batch/transfer` | `ClueBatchTransferRequest` | TRANSFER + Batch Resource Scope |
| POST | `/batch/update` | `ResourceBatchEditRequest` | UPDATE + Batch Resource Scope |
| POST | `/batch/delete` | `List<String>` | DELETE + Batch Resource Scope |
| POST | `/batch/to-pool` | `BatchPoolReasonRequest` | RECYCLE + Batch Resource Scope |
| POST | `/to-pool` | `PoolReasonRequest` | Resource Scope；源码注解常量写成 `CUSTOMER_MANAGEMENT_RECYCLE`，实现阶段按页面与需求 R5 统一为线索 RECYCLE，不复制该明显常量误用 |
| GET | `/tab` | `ResourceTabEnableDTO` | READ；决定普通数据视图 Tab 可见性 |
| POST | `/export` | `ClueExportRequest` | EXPORT + READ DataScope |
| POST | `/export-select` | `ExportSelectRequest` | EXPORT + Batch Resource Scope |
| POST | `/transition/account/page` | `CustomerPageRequest` | 线索 READ + 客户 READ |
| POST | `/re-transition/account` | `BatchReTransitionCustomerRequest` | UPDATE + Batch Resource Scope |
| POST | `/transform` | `ClueTransformRequest` | UPDATE + Resource Scope，Service 再检查客户/商机新增权限 |
| GET | `/template/download` | xlsx | IMPORT |
| POST | `/import/pre-check` | multipart | IMPORT |
| POST | `/import` | multipart | IMPORT |
| POST | `/chart` | `ChartAnalysisRequest` | READ + DataScope |

`CluePageRequest` 只是在公共分页请求上增加 `poolId`。普通 `/lead/page` 的真实数据范围由 `DataScopeService.getDeptDataPermission()` 与 User View 共同决定；池 `/pool/lead/page` 才把 `poolId` 作为强制条件。

## 4. Cordys 线索池 API

Controller：`backend/crm/src/main/java/cn/cordys/crm/clue/controller/PoolClueController.java`

基路径：`/pool/lead`

| 方法 | 路径 | 权限 | Service 关键约束 |
| --- | --- | --- | --- |
| GET | `/options` | POOL READ | 只返回当前用户为成员/管理员的启用池 |
| POST | `/page` | POOL READ | `poolId` 必填；先 `checkPoolMember`，再查询 |
| POST | `/pick` | POOL PICK | 池成员校验、库容、领取规则 |
| POST | `/assign` | POOL ASSIGN | 由 clueId 反查 pool，再做池成员校验和库容 |
| GET | `/delete/{id}` | POOL DELETE | 由 clueId 反查 pool，再做池成员校验 |
| GET | `/get/{id}` | POOL READ | 由 clueId 反查 pool，再做池成员校验 |
| POST | `/batch-pick` | POOL PICK | 指定池成员校验 + 批量领取规则 |
| POST | `/batch-assign` | POOL ASSIGN | 第一条记录反查池；实现阶段额外强制所有 IDs 同池，避免跨池绕过 |
| POST | `/batch-update` | POOL UPDATE | 第一条记录反查池；实现阶段额外强制所有 IDs 同池 |
| POST | `/batch-delete` | POOL DELETE | 第一条记录反查池；实现阶段额外强制所有 IDs 同池 |
| POST | `/export-all` | POOL EXPORT | `poolId` 成员校验 + 当前筛选 |
| POST | `/export-select` | POOL EXPORT | 由首条记录确定池并校验 |
| POST | `/chart` | POOL READ | `poolId` 成员校验 |
| GET | `/template/download` | POOL IMPORT | 下载池导入模板 |
| POST | `/import/pre-check` | POOL IMPORT | `poolId` 成员校验 |
| POST | `/import` | POOL IMPORT | `poolId` 成员校验 |

W3.4.2 在不改变 Cordys 页面行为的前提下，将“只取首条 ID 判断池”的实现细节收紧为“请求中的所有资源必须属于同一个已授权池”；这是后端越权防护，不属于业务语义改变。

## 5. 线索池选项、Scope 与隐藏字段

`PoolClueService.getPoolOptions()` 的真实语义：

1. 查询当前组织所有 `enable=true` 的 `CluePool`。
2. 解析每个池的 `scopeId` 与 `ownerId`。
3. 当前用户属于成员 Scope、管理员 Scope 或为系统管理员时，池才可见。
4. 池管理员设置 `editable=true`。
5. 合并 `CluePoolPickRule`、`CluePoolRecycleRule`。
6. 从 `CluePoolHiddenField` 得到隐藏字段。
7. 用当前线索真实表单字段生成 `fieldConfigs`；`enable=false` 的字段在当前池页面隐藏。
8. 线索名称字段不可在池设置中改为 editable。

因此 MicroMatrix 当前 `/resource-pools/options?module=lead` 只读兼容 facade 只能在 W3.4.2 过渡期间存在；池页完成后必须改用 `/pool/lead/options` 并删除线索调用方对通用 facade 的依赖。

## 6. 线索池设置与库容 API

### 6.1 线索池设置

Controller：`CluePoolController.java`

基路径：`/lead-pool`

| 方法 | 路径 | 权限 | 行为 |
| --- | --- | --- | --- |
| POST | `/page` | `MODULE_SETTING:UPDATE` | 分页读取全部线索池设置 |
| POST | `/add` | `MODULE_SETTING:UPDATE` | 创建 Pool + PickRule + RecycleRule + HiddenFields |
| POST | `/update` | `MODULE_SETTING:UPDATE` | 同事务更新 Pool/Rule/HiddenFields |
| POST | `/quick-update` | 池管理员校验 | 页面内快速保存自己可管理的池 |
| GET | `/no-pick/{id}` | `MODULE_SETTING:UPDATE` | 删除前检查池中是否仍有未领取线索 |
| GET | `/delete/{id}` | `MODULE_SETTING:UPDATE` | 删除 Pool + PickRule + RecycleRule + HiddenFields |
| GET | `/switch/{id}` | `MODULE_SETTING:UPDATE` | 启用/禁用 |

`CluePoolAddRequest` 包含：`name`、`scopeIds`、`ownerIds`、`enable`、`auto`、`pickRule`、`recycleRule`、`hiddenFieldIds`。线索池不是只有名称的简单字典。

### 6.2 线索库容

Controller：`ClueCapacityController.java`

基路径：`/lead-capacity`

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/get` | `MODULE_SETTING:UPDATE` |
| POST | `/add` | `MODULE_SETTING:UPDATE` |
| POST | `/update` | `MODULE_SETTING:UPDATE` |
| GET | `/delete/{id}` | `MODULE_SETTING:UPDATE` |

库容按组织 + Scope 生效，不是用户表上的单一数字。

## 7. 领取、分配与库容规则

Cordys `PoolClueService` 的领取规则包含四层约束：

1. **库容**：`capacity - 当前负责人非池线索数 >= 本次处理数`。
2. **每日领取上限**：`limitOnNumber=true` 时，统计当天 `collectionTime` 的已领取线索，超过 `pickNumber` 拒绝。
3. **新数据保护**：`limitNew=true` 时，线索进入池后必须经过 `newPickInterval` 天才能由普通成员领取；池管理员不受该规则限制。
4. **前归属人冷却**：`limitPreOwner=true` 时，读取最近一条 `ClueOwner`，同一前负责人必须等待 `pickIntervalDays` 后才能再次领取。

领取成功后：

```text
poolId = null
inSharedPool = false
owner = 领取/分配目标用户
collectionTime = now
stage = FOLLOWING
updateUser/updateTime = 当前值
```

分配额外发送 `CLUE_DISTRIBUTED` 通知。普通领取不发送分配通知。

## 8. 移入线索池与负责人历史

`ClueService.batchToPool()` 是普通线索进入池的事实入口：

- 已经在池内的记录先过滤。
- 请求传 `poolId` 时使用指定启用池；未传时按原负责人 Scope 选择默认池。
- 找不到默认池的记录不移动，并进入 fail 计数。
- 为原负责人发送 `CLUE_MOVED_POOL` 通知。
- 插入 `ClueOwner` 历史，并记录 `reasonId`。
- 更新线索：`poolId`、`inSharedPool=true`、`owner=null`、`collectionTime=null`。
- 写入 `MOVE_TO_CUSTOMER_POOL` 类型业务日志；名称虽然沿用 Customer Pool 常量，业务事实是线索入池。

因此普通线索进入池绝不能只把 `inSharedPool` 改为 `true`。

## 9. 自动回收

证据：`backend/crm/src/main/java/cn/cordys/crm/system/job/listener/CluePoolRecycleListener.java`。

自动回收只处理：

- `CluePool.enable=true`
- `CluePool.auto=true`
- 当前不在线索池
- 当前负责人命中该池 Scope
- `transitionId` 为空，即未转换
- 对应 `CluePoolRecycleRule` 条件组匹配

回收条件由 `CluePoolService.checkRecycled()` 解析，支持 AND/OR 组合，并处理创建/领取存量时间和最近跟进时间等条件。

回收成功副作用：

- 发送 `CLUE_AUTOMATIC_MOVE_POOL` 通知给原负责人。
- 新增负责人历史，operator 为系统管理员。
- `poolId = 命中池`
- `inSharedPool = true`
- `owner = null`
- `collectionTime = null`
- `reasonId = "system"`
- `updateUser = admin`

W3.4.2 的 NestJS `PoolRecycleService` 必须保持幂等，并保证同一条线索同一轮不会被多个池重复回收。

## 10. 跟进记录

Controller：`ClueFollowRecordController.java`

基路径：`/lead/follow/record`

| 方法 | 路径 | 关键权限语义 |
| --- | --- | --- |
| POST | `/add` | `checkRecordPermission(..., write)` |
| POST | `/update` | 只允许具备更新资格的记录 |
| POST | `/page` | 普通线索资源权限 + Follow Record 动态筛选 |
| POST | `/pool/page` | 池资源读取权限 |
| GET | `/get/{id}` | 资源读取权限 |
| GET | `/delete/{id}` | 记录更新权限 |

Cordys 没有把“池跟进记录”做成另一个数据库模型；它通过资源访问校验区分普通线索和池线索。

当前 MicroMatrix `GET/POST /follow-ups` 仍是通用 REST 契约，只支持列表与新增，缺少 Cordys 的线索专用更新、详情、删除、池列表路径。W3.4.2 必须补齐 `/lead/follow/record/*` facade/Controller，并复用现有 FollowUps Service 数据，不复制第二套表。

## 11. 跟进计划

Controller：`ClueFollowPlanController.java`

基路径：`/lead/follow/plan`

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/add` | 新增线索跟进计划 |
| POST | `/update` | 编辑 |
| POST | `/page` | 线索计划分页 + 动态筛选 |
| GET | `/get/{id}` | 详情 |
| GET | `/cancel/{id}` | 取消 |
| GET | `/delete/{id}` | 删除 |
| POST | `/status/update` | 更新计划状态 |

当前 MicroMatrix `/follow-up-plans` 已有 create/update/list/get/status/delete/convert 领域能力，但 URL 和 DTO 不是 Cordys 契约。W3.4.2 只增加线索域入口并复用现有 Service；不得删除“我的计划”等其他页面仍依赖的通用入口。

## 12. 负责人历史

Controller：`ClueOwnerHistoryController.java`

真实路径：`GET /lead/owner/history/list/{clueId}`。

权限是普通线索 READ 或线索池 READ 任一满足，但 Service/资源访问还必须确认当前记录位于对应可读范围。历史数据来自 `clue_owner`：

```text
clue_id
owner
collection_time
end_time
operator
reason_id
```

写入时机至少包括：

- 普通线索负责人变更。
- 批量转移。
- 主动移入线索池。
- 自动回收。

池领取时保留此前结束的 Owner History，用于“前归属人冷却”计算。

## 13. User View

Cordys 普通线索与线索池有两套资源类型：

```text
/lead/view/*
/pool/lead/view/*
```

两套均提供：

- add
- update
- delete/:id
- detail/:id
- list
- fixed/:id
- edit/pos
- enable/:id

当前 MicroMatrix `UserViewsService` 已直接实现同样的资源隔离，Controller 路径也已经是 `/lead/view` 和 `/pool/lead/view`。W3.4.2 仅需把权限从当前宽泛 `menu:lead` 对齐为普通 READ 与池 READ 的独立权限，不重写 User View 数据模型。

## 14. 三条线索转换链路

### 14.1 自动转换 `/lead/transform`

DTO：

```text
clueId: string
oppCreated: boolean
oppName?: string
```

真实流程：

1. 检查客户新增权限；选择创建商机时再检查商机新增权限。
2. 读取线索并验证负责人存在。
3. 如果客户名称存在唯一性规则且有同名客户，按 selector 选择现有客户；否则通过 `CLUE_TO_CUSTOMER` 表单联动创建客户。
4. 通过 `CLUE_TO_CONTACT` 联动创建/关联联系人，并维护客户协作关系。
5. 设置 `transitionType=CUSTOMER`、`transitionId=customerId`。
6. 如创建商机，通过 `CLUE_TO_OPPORTUNITY` 联动创建商机。
7. 复制线索跟进记录与跟进计划到客户/商机侧。
8. 刷新客户最新跟进时间。
9. 发送客户转换通知；有商机时再发商机转换通知。

### 14.2 新建客户并关联 `/lead/transition/account`

`ClueTransitionCustomerRequest extends CustomerAddRequest`，额外增加 `clueId`。

Cordys 先通过真实客户新增表单创建 Customer，然后写线索 `transitionId/transitionType`，并按联系人电话检查后同步创建联系人，最后发送转换通知。

W3.4.2 保持这一入口与 `/lead/transform` 独立，不合并为一个“万能转换” DTO。

### 14.3 关联已有客户 `/lead/re-transition/account`

行为：

- `clueIds + customerId` 批量关联。
- 目标客户如果在公海，先尝试领取；领取失败则整体不继续。
- 每条线索负责人必须仍是有效用户；无负责人/负责人不存在的记录按 Cordys 行为跳过或拒绝。
- 建立客户协作、联系人关系。
- 写 `transitionType=CUSTOMER`、`transitionId=customerId`。
- 复制跟进计划与跟进记录。
- 刷新客户最近跟进时间。
- 只通知线索负责人。

## 15. 转换时 FollowUpRecord / FollowUpPlan 复制事实

`ClueService.batchCopyCluePlanAndRecord()` 是本阶段必须保留的关键事实。

### 15.1 FollowUpRecord

Cordys：

1. 读取原线索全部 `type=CLUE` FollowUpRecord。
2. 读取每条 Record 的 `FollowUpRecordField` 与 `FollowUpRecordFieldBlob`。
3. 为副本生成新 ID。
4. `clueId=null`，`type=CUSTOMER`。
5. 填 `customerId/opportunityId/contactId`。
6. `commentCount=0`。
7. 批量写入记录及字段副本。
8. 原线索侧记录不删除。

### 15.2 FollowUpPlan

Cordys：

1. 读取原线索全部 `type=CLUE` FollowUpPlan。
2. 读取 `FollowUpPlanField` 与 `FollowUpPlanFieldBlob`。
3. 为副本生成新 ID。
4. `clueId=null`，`type=CUSTOMER`。
5. 填 `customerId/opportunityId/contactId`。
6. `commentCount=0`。
7. 批量写入计划及字段副本。
8. 原线索侧计划不删除。

当前 MicroMatrix `LeadsService.associateLeadsToCustomer()` 只复制 `followUpRecord`，没有复制 `FollowUpPlan`。这就是 W3.4.2 task 3.3 已登记的历史缺口；同时当前 `FollowUpRecord` 模型没有独立动态字段表，而 `FollowUpPlan` 使用 `customData`。实现时以当前项目已存在领域模型表达同样业务结果，不伪造 Cordys 不存在的删除行为。

## 16. Cordys 数据表事实

基础迁移 `V1.0.0_5__clue.sql` 与后续迁移共同确定：

| Domain | 表 | 关键字段 |
| --- | --- | --- |
| Clue | `clue` | owner/stage/last_stage/collection_time/transition_type/transition_id/in_shared_pool/follower/follow_time/pool_id/reason_id |
| ClueField | `clue_field` | resource_id/field_id/field_value |
| ClueFieldBlob | `clue_field_blob` | resource_id/field_id/field_value |
| ClueOwner | `clue_owner` | clue_id/owner/collection_time/end_time/operator/reason_id |
| CluePool | `clue_pool` | name/scope_id/owner_id/enable/auto/org/audit |
| CluePoolPickRule | `clue_pool_pick_rule` | limit_on_number/pick_number/limit_pre_owner/pick_interval_days/limit_new/new_pick_interval |
| CluePoolRecycleRule | `clue_pool_recycle_rule` | operator/condition |
| CluePoolHiddenField | `clue_pool_hidden_field` | pool_id/field_id |
| ClueCapacity | `clue_capacity` | organization_id/scope_id/capacity |

当前 Prisma 对上述表已经直接建模，不再保留旧通用 ResourcePool 作为数据库真相。

## 17. 当前 MicroMatrix 差异矩阵

| 能力 | Cordys 事实 | 当前 MicroMatrix | W3.4.2 动作 |
| --- | --- | --- | --- |
| 普通线索 API | `/lead/*` POST 风格资源 API | `/leads` REST | task 3.2 新建 `/lead` Controller，完成后删除旧 `/leads` Controller/DTO |
| 普通/池列表 | `/lead/page` 与 `/pool/lead/page` 分开 | `/leads?scope=mine/pool` 共用 | 拆分入口，Service 可复用内部查询器 |
| 池选项 | `/pool/lead/options` | `/resource-pools/options?module=lead` | 用分域 Controller 替换线索调用方，删除该 facade 的线索依赖 |
| 池领取/分配 | `/pool/lead/pick|assign|batch-*` + 池独立权限 | `/leads/:id/claim|assign` 和 `/leads/batch/*` 混用普通权限 | task 3.4 全部切池权限 |
| 池设置 | `/lead-pool/*` | 无直接 Controller | task 3.4 新建 |
| 线索库容 | `/lead-capacity/*` | Repository/Service 内部能力，无 Cordys Controller | task 3.4 新建 |
| 隐藏字段 | Pool options 返回 fieldConfigs | 前端从通用 option 的 hiddenFieldIds 派生 | 按 Cordys 输出稳定 fieldConfigs |
| 普通 User View | `/lead/view/*` | 已存在 | 保留模型，收紧权限 |
| 池 User View | `/pool/lead/view/*` | 已存在 | 保留模型，收紧权限 |
| 跟进记录 | `/lead/follow/record/*` | `/follow-ups` 只有 list/create | 补线索 facade + update/get/delete/pool page |
| 跟进计划 | `/lead/follow/plan/*` | `/follow-up-plans` 通用 REST | 补线索 facade，复用领域 Service |
| Owner History | `/lead/owner/history/list/:id` | `/leads/:id/owner-history` | 改为 Cordys 路径 |
| 自动转换 | `/lead/transform` | `/leads/transform` | 改路径，保留三条链路独立 |
| 新建客户并关联 | `/lead/transition/account` | `/leads/transition/account` | 改路径与 DTO |
| 关联已有客户 | `/lead/re-transition/account` | `/leads/re-transition/account` | 改路径与批量权限 |
| 转换 FollowUpRecord | 复制记录 + 字段值，保留原记录 | 已复制基础记录 | 对齐目标关联信息；不删除原记录 |
| 转换 FollowUpPlan | 复制计划 + 字段值，保留原计划 | **未复制** | task 3.3 必修 |
| 普通列表池排除 | `/lead/page` 不混池数据 | 当前通过 `scope=mine` 做到 | 新 Service 固化为普通列表强制 `inSharedPool=false` |
| 图表 | `/lead/chart`、`/pool/lead/chart` | 当前线索页未按 Cordys 分域 | task 3.2/3.4 补齐 |
| 池页面 | 独立池页面、池切换、池设置图标 | 当前 `LeadsView.vue` 内 Tab 共用 | task 3.5 重建页面内导航/独立 URL |

## 18. 当前 Vue 与 Cordys 页面差异

当前 `apps/web/src/views/leads/LeadsView.vue` 把“我的线索/线索池”放在同一个 `el-tabs` 中，并复用一张表。主要差异：

- 池选项仍来自 `resourcePoolApi.options('lead')`。
- 池领取按钮没有按 `leadPool:pick` 隐藏。
- 池分配当前检查的是 `lead:assign`，与 Cordys `leadPool:assign` 不一致。
- 普通行操作缺少 Cordys 的明确“转移”和“移入线索池”权限拆分语义，当前大量复用 `lead:assign`。
- 普通线索新增页面允许根据当前 Tab 创建到池，Cordys 池页面本身没有“新增池线索”按钮；池数据通过导入或普通线索入池产生。
- 当前池详情直接复用普通 `FollowUpDrawer`，需要改为只读池详情并按池权限读取 Follow Record/Owner History。
- Cordys 池表根据当前池 `fieldConfigs` 隐藏列；当前页面只做通用字段渲染，需按池配置裁剪。
- Cordys 普通线索的行操作在已转换后整体变为 `-`；当前页面主要按 `status` 控制，需要改用 `transitionType + transitionId`。

这些差异全部归 task 3.5，不在 task 3.2 API 阶段提前用页面补丁掩盖。

## 19. 事务与副作用边界

Cordys `ClueService` 与 `CluePoolService` 为类级 `@Transactional(rollbackFor = Exception.class)`。W3.4.2 在 NestJS 中必须把以下写操作放入明确 Prisma transaction，而不是用“失败后人工 delete”模拟原子性：

- 新增主记录 + 动态字段。
- 编辑主记录 + 动态字段 + Owner History。
- 删除线索 + 动态字段 + Owner History + FollowUpRecord + FollowUpPlan。
- 批量转移。
- 主动移入池。
- 自动转换。
- 新建客户并关联。
- 关联已有客户。
- 领取/分配涉及 Owner/Pool 状态的切换。
- 池设置 Pool + PickRule + RecycleRule + HiddenFields。

通知与外部副作用在数据库事务提交后发送；事务失败不得产生“数据库已回滚但通知已发”的状态。

## 20. 权限映射

W3.4.2 继续使用 MicroMatrix 已有权限命名，但语义必须与 Cordys 一一对应：

| Cordys | MicroMatrix |
| --- | --- |
| `CLUE_MANAGEMENT:READ` | `menu:lead` / 后续如拆出 `lead:read` 则统一迁移，不双轨 |
| `CLUE_MANAGEMENT:ADD` | `lead:create` |
| `CLUE_MANAGEMENT:UPDATE` | `lead:update` |
| `CLUE_MANAGEMENT:DELETE` | `lead:delete` |
| `CLUE_MANAGEMENT:TRANSFER` | `lead:transfer`，不得继续借用 `lead:assign` |
| `CLUE_MANAGEMENT:RECYCLE` | `lead:recycle`，不得继续借用 `lead:assign` |
| `CLUE_MANAGEMENT:IMPORT` | `lead:import` |
| `CLUE_MANAGEMENT:EXPORT` | `lead:export` |
| `CLUE_MANAGEMENT_POOL:READ` | `leadPool:read` |
| `CLUE_MANAGEMENT_POOL:PICK` | `leadPool:pick` |
| `CLUE_MANAGEMENT_POOL:ASSIGN` | `leadPool:assign` |
| `CLUE_MANAGEMENT_POOL:UPDATE` | `leadPool:update` |
| `CLUE_MANAGEMENT_POOL:DELETE` | `leadPool:delete` |
| `CLUE_MANAGEMENT_POOL:IMPORT` | `leadPool:import` |
| `CLUE_MANAGEMENT_POOL:EXPORT` | `leadPool:export` |
| `MODULE_SETTING:UPDATE` | 当前模块设置更新权限事实 |

如果现有 seed/角色缺少 `lead:transfer`、`lead:recycle` 或 `leadPool:read/pick/assign`，task 3.2/3.4 同批补齐权限初始化与测试，不在 Controller 中回退到宽泛权限。

## 21. 已确认的实现边界

### task 3.2 普通线索 API

- 新增 Cordys `/lead` Controller 与 DTO。
- 复用 `Clue` 直接模型、Metadata、DataScope、UserViews、导入导出基础设施。
- 普通列表永久排除 `inSharedPool=true`。
- 补 `module/form`、`tab`、`chart`。
- 把普通线索 Owner History 切到 `/lead/owner/history/list/:id`。
- 为跟进记录/计划提供 `/lead/follow/*` 资源入口。
- 删除旧 `/api/leads` Controller 和旧 Web 调用只在新入口通过全量测试后进行；不保留双路由兼容层。

### task 3.3 三条转换链路

- 三条路径保持独立。
- 全部转换用事务完成 Customer/Contact/Collaboration/Opportunity/transition 字段/Follow 复制。
- 补 FollowUpPlan 复制。
- `transitionType + transitionId` 是已转客户事实。
- 保留原线索跟进记录与计划。
- 通知在事务提交后发送。

### task 3.4 多线索池

- 新增 `/pool/lead`、`/lead-pool`、`/lead-capacity` Controller。
- 删除线索 Web 对 `/resource-pools/options` 的依赖。
- 池权限全部独立。
- 执行 Scope、隐藏字段、库容、每日领取、前负责人冷却、新数据保护、自动回收。
- 批量请求强制所有 IDs 同一授权池。

### task 3.5 Vue

- 按 Cordys 重建普通线索与线索池页面内导航。
- 保留独立 URL。
- 公共 ResourceTable/Metadata/UserView 继续复用。
- 池页面不提供 Cordys 不存在的“新建”按钮。
- 池字段按当前池 `fieldConfigs` 裁剪。
- 已转换行根据 `transitionType + transitionId` 禁止业务写操作。

## 22. task 3.1 关闭条件

本文件已覆盖 task 3.1 要求的完整调用链：

- 普通线索页面/API/Controller/Service/Domain/DDL。
- 详情、状态、删除、批量转移/编辑/删除、入池。
- 自动转换、新建客户并关联、关联已有客户。
- 线索池页面、Pool options、领取、分配、批量、导入导出、图表。
- Owner History。
- FollowUpRecord。
- FollowUpPlan。
- 普通/池 User View。
- Pool Scope、Hidden Field、Pick Rule、Recycle Rule、Capacity。
- 自动回收 Listener。
- 当前 MicroMatrix API/Prisma/Vue 差异与后续任务边界。

因此 W3.4.2 task 3.1 可以关闭，执行指针进入 **3.2 重建普通线索 API**。

## 23. task 3.2 实施回写（2026-08-27）

普通线索 API 已按本文前述事实切换到 Cordys `/lead` 契约：

- 新 Controller：`ClueController`，覆盖 `module/form`、`page`、`get/:id`、`add`、`update`、`status/update`、`delete/:id`、`batch/*`、`to-pool`、导入导出与 `chart`。
- Owner History 使用 `/lead/owner/history/list/:clueId`；旧 `LeadsController` 与 `dto/lead.dto.ts` 已删除。
- `Clue.stage` 恢复 Cordys `NEW/FOLLOWING/INTERESTED/SUCCESS/FAIL`，转换事实不再写伪 `CONVERTED` 状态，继续由 `transitionType + transitionId` 表达。
- 普通 `page/get` 强制排除 `inSharedPool=true`；批量转移使用单事务写 `clue_owner` 并更新 Owner/collectionTime；移池继续原子维护 Owner History、`poolId/reasonId` 与 Owner 清空。
- Web 与 Mobile API 层已切到 `/lead/*`；前端 `/leads` 仅作为 SPA 页面路由保留，不再是后端 API。

专项运行证据：

```text
pnpm smoke:w342-clue-api     18/18
pnpm smoke:w341-home         17/17
shared build                PASS
API typecheck               PASS
Web typecheck               PASS
本批 ESLint                 PASS
API production build        PASS
Web production build        PASS
```

`smoke:w342-clue-api` 实际覆盖：表单、两次新增、Cordys Pager 与排序、详情、部分更新、状态/lastStage、批量修改、单事务批量转移、Owner History、移池、普通列表排池、xlsx 模板、真实导出任务、动态字段图表、删除以及旧 `/api/leads` 404。

3.2 不提前宣称线索池完整复刻：当前 `/pool/lead` 只为旧 Controller 删除后的调用连续性提供分域过渡入口；多池 Scope、隐藏字段、池级图表和完整独立权限验收仍归 task 3.4。
