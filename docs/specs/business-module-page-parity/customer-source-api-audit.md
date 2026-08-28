# W3.4.3 客户、联系人和客户公海源码与 API 证据矩阵

> 执行单元：W3.4.3 / task 4.1
>
> 日期：2026-08-28
>
> 第一事实来源：项目内 `CordysCRM/` 源码。运行页面只用于后续交互验收，当前 MicroMatrix 实现只用于差异对照。

## 1. 审计结论

Cordys 将客户域拆成三类业务资源和三类配置资源，不存在由一个 `/customers` Controller 通过参数切换普通客户与公海的设计：

- 普通客户：`/account/*`
- 联系人：`/account/contact/*`
- 客户公海资源：`/pool/account/*`
- 客户公海设置：`/account-pool/*`
- 客户库容：`/account-capacity/*`
- 移入公海原因：`/dict/*`，模块为 `CUSTOMER_POOL_RS`

客户 360 的跟进、计划、负责人历史、协作、关系及交易链资源也各有独立入口。普通客户数据范围、协作访问、只读协作和公海成员访问是四种不同边界，不能通过一个“可读客户”布尔值合并。

MicroMatrix 已有 `Customer`、`CustomerField/Blob`、`CustomerOwner`、`CustomerContact*`、`CustomerCollaboration`、`CustomerRelation`、`CustomerPool*` 与 `CustomerCapacity` 直接模型。对照 Cordys 最终迁移后，本单元不需要新增数据库表；主要差异位于 API 分域、权限码、子资源访问、联系人可选客户、公海规则副作用和三个模块设置入口。

## 2. 页面和调用入口

### 2.1 普通客户

前端入口：

- `frontend/packages/web/src/views/customer/customer.vue`
- `frontend/packages/web/src/views/customer/components/customerTable.vue`
- `frontend/packages/web/src/views/customer/components/customerOverviewDrawer.vue`
- `frontend/packages/lib-shared/api/modules/customer.ts`
- `frontend/packages/lib-shared/api/requrls/customer/index.ts`

普通客户真实操作：

| 类型   | 操作     | Cordys 权限                    |
| ------ | -------- | ------------------------------ |
| 顶部   | 新增     | `CUSTOMER_MANAGEMENT:ADD`      |
| 顶部   | 导入     | `CUSTOMER_MANAGEMENT:IMPORT`   |
| 顶部   | 导出全部 | `CUSTOMER_MANAGEMENT:EXPORT`   |
| 批量   | 导出选中 | `CUSTOMER_MANAGEMENT:EXPORT`   |
| 批量   | 转移     | `CUSTOMER_MANAGEMENT:TRANSFER` |
| 批量   | 移入公海 | `CUSTOMER_MANAGEMENT:RECYCLE`  |
| 批量   | 编辑     | `CUSTOMER_MANAGEMENT:UPDATE`   |
| 批量   | 合并     | `CUSTOMER_MANAGEMENT:MERGE`    |
| 批量   | 删除     | `CUSTOMER_MANAGEMENT:DELETE`   |
| 行操作 | 跟进     | `CUSTOMER_MANAGEMENT:UPDATE`   |
| 行操作 | 编辑     | `CUSTOMER_MANAGEMENT:UPDATE`   |
| 行操作 | 转移     | `CUSTOMER_MANAGEMENT:TRANSFER` |
| 行操作 | 移入公海 | `CUSTOMER_MANAGEMENT:RECYCLE`  |
| 行操作 | 删除     | `CUSTOMER_MANAGEMENT:DELETE`   |

普通客户分页必须固定排除 `inSharedPool=true` 的记录。公海数据不能因为当前用户属于某个公海 Scope 而从 `/account/page` 或普通客户详情漏出。

### 2.2 联系人

前端入口：

- `frontend/packages/web/src/views/customer/contact.vue`
- `frontend/packages/web/src/components/business/crm-form-create-table/contactTable.vue`

同一个联系人表格同时服务独立联系人页面和客户 360：

- 独立页面支持新增、导入、导出、视图和图表。
- 客户 360 传入 `sourceId=customerId`，不展示独立导入导出入口。
- 行级操作为编辑、启用/停用和删除。
- 批量操作只有导出选中和批量编辑；Cordys 不存在联系人批量删除。
- 删除前调用 `/account/contact/opportunity/check/{id}` 检查商机关联。

Cordys 最终迁移已把 `customer_contact.customer_id` 改为可空，因此联系人可以从独立页面创建而不关联客户；客户 360 创建时才强制带入当前客户。

### 2.3 客户公海

前端入口：

- `frontend/packages/web/src/views/customer/openSea.vue`
- `frontend/packages/web/src/views/customer/components/openSeaTable.vue`
- `frontend/packages/web/src/views/customer/components/openSeaOverviewDrawer.vue`
- `frontend/packages/web/src/views/system/module/components/customManagement/openSeaDrawer.vue`
- `frontend/packages/web/src/views/system/module/components/customManagement/moveReasonDrawer.vue`

页面先读取 `/pool/account/options`，只展示当前用户是成员、管理员或系统管理员的启用公海。

| 类型   | 操作     | Cordys 权限                       |
| ------ | -------- | --------------------------------- |
| 顶部   | 导入     | `CUSTOMER_MANAGEMENT_POOL:IMPORT` |
| 顶部   | 导出全部 | `CUSTOMER_MANAGEMENT_POOL:EXPORT` |
| 批量   | 导出选中 | `CUSTOMER_MANAGEMENT_POOL:EXPORT` |
| 批量   | 领取     | `CUSTOMER_MANAGEMENT_POOL:PICK`   |
| 批量   | 分配     | `CUSTOMER_MANAGEMENT_POOL:ASSIGN` |
| 批量   | 编辑     | `CUSTOMER_MANAGEMENT_POOL:UPDATE` |
| 批量   | 删除     | `CUSTOMER_MANAGEMENT_POOL:DELETE` |
| 行操作 | 领取     | `CUSTOMER_MANAGEMENT_POOL:PICK`   |
| 行操作 | 分配     | `CUSTOMER_MANAGEMENT_POOL:ASSIGN` |
| 行操作 | 删除     | `CUSTOMER_MANAGEMENT_POOL:DELETE` |

公海详情不是普通客户 360：只允许客户信息、跟进记录和负责人历史，不开放联系人、跟进计划、关系、协作、商机、合同、回款、发票和订单页签。

## 3. 普通客户 API

Controller：`CustomerController.java`  
Service：`CustomerService.java`  
基路径：`/account`

| 方法 | 路径                 | 权限与关键约束                                                   |
| ---- | -------------------- | ---------------------------------------------------------------- |
| GET  | `/module/form`       | 普通客户 READ 或公海 READ 任一权限                               |
| POST | `/page`              | CUSTOMER READ + 数据范围 + User View；强制排除公海               |
| GET  | `/get/{id}`          | CUSTOMER READ + 资源范围；无范围时可降级检查协作                 |
| POST | `/add`               | CUSTOMER ADD；校验库容并写直接字段                               |
| POST | `/update`            | CUSTOMER UPDATE + 资源范围；负责人变更同步联系人和 Owner History |
| GET  | `/delete/{id}`       | CUSTOMER DELETE + 资源范围；检查关联资源                         |
| POST | `/batch/delete`      | CUSTOMER DELETE + 全量资源范围                                   |
| POST | `/batch/transfer`    | CUSTOMER TRANSFER + 全量资源范围 + 目标负责人库容                |
| POST | `/batch/to-pool`     | CUSTOMER RECYCLE + 全量资源范围                                  |
| POST | `/to-pool`           | CUSTOMER RECYCLE + 单资源范围                                    |
| POST | `/batch/update`      | CUSTOMER UPDATE + 全量资源范围                                   |
| POST | `/option`            | CUSTOMER READ；关联客户候选                                      |
| GET  | `/tab`               | CUSTOMER READ；返回视图 Tab 开关                                 |
| POST | `/merge/page`        | CUSTOMER READ；合并目标候选                                      |
| POST | `/merge`             | CUSTOMER MERGE；事务合并                                         |
| POST | `/chart`             | CUSTOMER READ + 数据范围                                         |
| POST | `/export-all`        | CUSTOMER EXPORT + READ 数据范围                                  |
| POST | `/export-select`     | CUSTOMER EXPORT + 全量资源范围                                   |
| GET  | `/template/download` | CUSTOMER IMPORT                                                  |
| POST | `/import/pre-check`  | CUSTOMER IMPORT                                                  |
| POST | `/import`            | CUSTOMER IMPORT                                                  |

新增客户默认负责人为当前用户，`collectionTime=createTime`，`inSharedPool=false`。负责人变更必须同时校验目标库容、更新关联联系人负责人、结束旧 Owner History、建立新 Owner History、发送转移通知并重置领取时间。

删除客户前至少检查联系人和商机引用；实际清理客户字段值、Blob、协作、关系、负责人历史、跟进记录和计划必须处于同一事务。不能先删除主体后异步清理子表。

## 4. 联系人 API

Controller：`CustomerContactController.java`  
Service：`CustomerContactService.java`  
基路径：`/account/contact`

| 方法 | 路径                      | 行为                                                        |
| ---- | ------------------------- | ----------------------------------------------------------- |
| GET  | `/module/form`            | 客户、联系人或商机 READ 任一权限                            |
| POST | `/page`                   | 联系人独立分页，CONTACT READ + Contact 数据范围 + User View |
| POST | `/chart`                  | 联系人独立图表                                              |
| GET  | `/list/{customerId}`      | 客户 360 内嵌列表，执行 Customer 资源边界                   |
| GET  | `/get/{id}`               | 客户 READ 或 CONTACT READ；仍需资源约束                     |
| POST | `/add`                    | CUSTOMER ADD 或 CONTACT ADD；`customerId` 可空              |
| POST | `/update`                 | CUSTOMER UPDATE 或 CONTACT UPDATE                           |
| GET  | `/enable/{id}`            | CUSTOMER UPDATE 或 CONTACT UPDATE                           |
| POST | `/disable/{id}`           | CUSTOMER UPDATE 或 CONTACT UPDATE；保存停用原因             |
| GET  | `/delete/{id}`            | CUSTOMER DELETE 或 CONTACT DELETE                           |
| GET  | `/opportunity/check/{id}` | 删除前检查商机关联                                          |
| GET  | `/tab`                    | CONTACT READ                                                |
| POST | `/export-all`             | CONTACT EXPORT + CONTACT READ 数据范围                      |
| POST | `/export-select`          | CONTACT EXPORT + 全量资源范围                               |
| GET  | `/template/download`      | CONTACT IMPORT                                              |
| POST | `/import/pre-check`       | CONTACT IMPORT                                              |
| POST | `/import`                 | CONTACT IMPORT                                              |
| POST | `/batch/update`           | CONTACT UPDATE + 全量资源范围                               |

Cordys 页面先执行商机关联检查，但 Service 的删除本身没有再次检查。MicroMatrix 实施必须把拒删校验放到后端事务内，不能只依赖前端；这是需求 R8 已确认的安全收紧。

联系人动态字段由 `CUSTOMER_CONTACT` 模块表单、普通字段表和 Blob 字段表提供。唯一性规则同时适用于新增、更新、导入和客户合并，不能只校验系统列。

## 5. 客户 360 调用链

普通客户详情抽屉按模块权限组合以下页签：

| 页签       | API/Controller                             | 权限与访问边界                            |
| ---------- | ------------------------------------------ | ----------------------------------------- |
| 跟进记录   | `/account/follow/record/*`                 | CUSTOMER READ；写入受 CustomerAccess 控制 |
| 联系人     | `/account/contact/list/{customerId}`       | CONTACT READ + Customer 子资源范围        |
| 跟进计划   | `/account/follow/plan/*`                   | CUSTOMER READ；写入受 CustomerAccess 控制 |
| 负责人历史 | `/account/owner/history/list/{customerId}` | CUSTOMER READ 或 POOL READ                |
| 客户关系   | `/account/relation/*`                      | CUSTOMER READ/UPDATE + Customer 资源范围  |
| 商机       | `/account/opportunity/page`                | CUSTOMER READ + OPPORTUNITY READ          |
| 协作人     | `/account/collaboration/*`                 | CUSTOMER READ/UPDATE + Customer 资源范围  |
| 合同       | `/account/contract/page`                   | CUSTOMER READ + CONTRACT READ             |
| 回款计划   | `/account/contract/payment-plan/*`         | CUSTOMER READ + PAYMENT PLAN READ         |
| 回款记录   | `/account/contract/payment-record/*`       | CUSTOMER READ + PAYMENT RECORD READ       |
| 发票       | `/account/invoice/*`                       | CUSTOMER READ + INVOICE READ              |
| 订单       | `/account/order/*`                         | CUSTOMER READ + ORDER READ                |

有 `collaborationType` 的详情不显示“协作人”页签。`READ_ONLY` 时联系人、跟进、关系、商机和订单等子页面全部只读。`COLLABORATION` 不获得客户主体的编辑、转移、入公海、删除、合并或协作管理权。

商机、合同、回款计划、回款记录、发票和订单不是“只要有菜单权限就返回全部关联数据”。Cordys 的客户 360 列表与统计会继续叠加对应业务模块的数据范围；MicroMatrix 实现也必须在 CustomerAccess 通过后再次按关联模块 DataScope 裁剪，避免客户本身可见时穿透查看超出商机/合同/订单范围的数据。

## 6. 四类资源访问边界

| 场景            | 可读范围                          | 可写范围                                           | 明确禁止                                           |
| --------------- | --------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| 普通客户        | CUSTOMER READ 对应角色数据范围    | 再叠加 ADD/UPDATE/TRANSFER/RECYCLE/DELETE/MERGE    | 不得读写数据范围外客户                             |
| `COLLABORATION` | 指定协作客户详情                  | 已证实的跟进与联系人子域；联系人只处理自身可见记录 | 客户主体、转移、入池、删除、合并、协作管理         |
| `READ_ONLY`     | 指定协作客户及允许展示的 360 页签 | 无                                                 | 所有业务写操作                                     |
| 客户公海        | 已授权 Pool 内客户                | 领取、分配、编辑、删除分别使用独立 POOL 权限       | 普通客户 360、跨 Pool 操作、普通 CUSTOMER 权限替代 |

实现时 `CustomerAccessService` 只能作为统一判定入口，不能把 Pool Member、DataScope、`COLLABORATION` 合并成一个通用 `canRead` 后复用到所有 Controller。普通客户、客户子资源和公海必须调用不同断言。

批量公海操作在 Cordys Service 中有“只由第一条记录反查 Pool”的实现。MicroMatrix 按已确认的越权防护要求，必须验证请求中的全部 ID 均属于同一个已授权 Pool；该收紧不改变页面业务语义。

## 7. 协作、关系与合并

### 7.1 协作

Controller：`CustomerCollaborationController.java`  
类型只允许：

- `COLLABORATION`
- `READ_ONLY`

列表读取客户 READ，新增、修改、删除和批量删除都复用 CUSTOMER UPDATE。Cordys 没有独立的“客户协作”功能权限，因此当前 `customer:team` 不是目标权限；W3.4.3 应把协作管理回归 `customer:update`。

每个客户与用户只能有一条直接协作关系。新增协作写操作日志并发送通知；协作关系不会扩大该用户的 CUSTOMER 数据范围。

### 7.2 客户关系

Controller：`CustomerRelationController.java`  
关系类型：

- `GROUP`：当前客户的集团/上级
- `SUBSIDIARY`：当前客户的子公司

页面限制一个集团和最多十个子公司，并排除自身及重复选择。后端必须进一步保证：

1. 禁止自关联；
2. 禁止重复边；
3. 一个客户最多一个上级集团；
4. 子公司数量不超过十个；
5. 禁止形成关系环；
6. 全部校验和写入位于同一事务。

防循环是 MicroMatrix 的安全完整性收紧，应保留。

### 7.3 客户合并

Controller：`CustomerController.merge`  
Service：`CustomerService.mergeCustomer`

Cordys 页面流程为第一次风险确认 → 合并 Modal → 第二次确认。请求字段是 `mergeIds`、`toMergeId`、`ownerId`，没有让用户选择 `KEEP_ALL/SKIP_DUPLICATES` 的冲突策略。

合并事务至少处理：

- 联系人，并按模块唯一字段规则去重；
- 商机；
- 跟进记录；
- 跟进计划；
- 协作关系；源负责人和协作人转为目标客户协作人，排除目标负责人和重复用户；
- 目标负责人变更时的联系人负责人、Owner History、领取时间和通知；
- 源客户删除与操作日志。

MicroMatrix 可保留只读合并预览和二次确认作为需求 R7 的保护，但必须删除 Cordys 不存在的可选联系人冲突策略；冲突结果由动态字段唯一规则确定。合并失败必须整体回滚。

## 8. 客户公海 API 与规则

Controller：`PoolCustomerController.java`  
Service：`PoolCustomerService.java`  
基路径：`/pool/account`

| 方法 | 路径                 | 权限与约束                               |
| ---- | -------------------- | ---------------------------------------- |
| GET  | `/options`           | POOL READ；仅启用且命中成员/管理员 Scope |
| POST | `/page`              | POOL READ；`poolId` 必填并校验成员       |
| GET  | `/get/{id}`          | POOL READ；由客户反查 Pool 并校验        |
| POST | `/pick`              | POOL PICK；成员、库容、每日限制和冷却    |
| POST | `/assign`            | POOL ASSIGN；成员与目标负责人库容        |
| GET  | `/delete/{id}`       | POOL DELETE                              |
| POST | `/batch-pick`        | POOL PICK；全部 ID 同 Pool               |
| POST | `/batch-assign`      | POOL ASSIGN；全部 ID 同 Pool             |
| POST | `/batch-update`      | POOL UPDATE；全部 ID 同 Pool             |
| POST | `/batch-delete`      | POOL DELETE；全部 ID 同 Pool             |
| POST | `/export-all`        | POOL EXPORT + Pool Scope                 |
| POST | `/export-select`     | POOL EXPORT + 全部 ID 同 Pool            |
| POST | `/chart`             | POOL READ + Pool Scope                   |
| GET  | `/template/download` | POOL IMPORT                              |
| POST | `/import/pre-check`  | POOL IMPORT + Pool Scope                 |
| POST | `/import`            | POOL IMPORT + Pool Scope                 |

领取规则依次执行：

1. 库容：`capacity=null` 表示不限，`0` 表示真实零库容；Filter 命中的客户不计入容量。
2. 每日领取上限；Pool 管理员不受领取限制。
3. 新数据保护：以客户进入公海时更新的 `customer.updateTime` 计算，不需要新增 `enteredAt` 列。
4. 前归属人冷却：读取最新 `CustomerOwner.collectionTime/endTime`。

领取或分配成功后：

```text
poolId = null
inSharedPool = false
owner = 领取/分配目标用户
collectionTime = now
updateTime = now
```

同时更新相关联系人负责人、建立新的 Owner History、写日志；分配还要发送通知。

普通客户移入公海时：

- 显式 Pool 必须启用且属于当前组织；未传 Pool 时按原负责人 Scope 选择默认 Pool。
- 关联联系人负责人改为 `-`。
- 结束当前 Owner History 并保存 `reasonId`。
- `poolId` 设为目标 Pool，`inSharedPool=true`，`owner=null`，`collectionTime=null`。
- `updateTime` 即进入公海时间基准。
- 写日志并向原负责人发送移入公海通知。

## 9. 公海设置、容量和自动回收

### 9.1 公海设置

Controller：`CustomerPoolController.java`  
基路径：`/account-pool`

| 方法 | 路径            | 行为                                    |
| ---- | --------------- | --------------------------------------- |
| POST | `/page`         | 分页读取设置                            |
| POST | `/add`          | 创建 Pool、领取规则、回收规则、隐藏字段 |
| POST | `/update`       | 同事务更新全部配置                      |
| POST | `/quick-update` | Pool 管理员在业务页面快速保存           |
| GET  | `/no-pick/{id}` | 删除前检查池内未领取数据                |
| GET  | `/delete/{id}`  | 删除 Pool 与全部规则/隐藏字段           |
| GET  | `/switch/{id}`  | 启停                                    |

配置包含 `name`、`scopeIds`、`ownerIds`、`enable`、`auto`、`pickRule`、`recycleRule`、`hiddenFieldIds`。`editable` 只由 Pool 管理员 Scope 决定，不代表普通成员能修改设置。

### 9.2 客户库容

Controller：`CustomerCapacityController.java`  
基路径：`/account-capacity`

- `GET /get`
- `POST /add`
- `POST /update`
- `GET /delete/{id}`

容量按 Scope 生效，并可包含排除 Filter。不同容量配置解析出的实际成员不能重叠。

### 9.3 移入公海原因

复用现有 `sys_dict/sys_dict_config` 和 `/dict/*`，模块固定为 `CUSTOMER_POOL_RS`。普通和批量移入公海都必须校验启用原因；Owner History 返回原因名称。系统自动回收使用内部 `system` 原因，不把它伪装成用户可配置项。

### 9.4 自动回收

`CustomerPoolRecycleListener` 只处理启用、开启自动回收、当前不在公海且负责人命中 Pool Scope 的客户。规则按配置的 AND/OR 组合检查入库/领取时间和最后跟进时间；成功后执行与手工入池相同的联系人负责人、通知、Owner History 和客户字段副作用。

## 10. User View 与负责人历史

User View 独立分域：

- 普通客户：`/account/view/*`
- 联系人：`/account/contact/view/*`
- 客户公海：`/pool/account/view/*`

三类视图必须分别按组织、用户和资源类型隔离，不能共享当前选中视图或条件。现有直接模型已满足，不新增表。

负责人历史入口 `/account/owner/history/list/{customerId}` 同时允许 CUSTOMER READ 或 POOL READ，但 Service 必须根据调用场景执行 Customer DataScope/Collaboration 或 Pool Scope，不能只检查功能权限。

## 11. 权限码校正

本阶段目标权限语义：

- 客户：`customer:read/create/update/delete/transfer/recycle/import/export/merge`
- 联系人：`contact:read/create/update/delete/import/export`
- 客户公海：`customerPool:read/pick/assign/update/delete/import/export`

当前 `customer:assign` 同时承担转移和公海动作，必须拆除；普通客户转移使用 `customer:transfer`，入公海使用 `customer:recycle`。当前 `customer:team` 也不是 Cordys 独立权限，协作管理使用 `customer:update`。客户公海不能缺少 `read/pick/assign` 三个独立权限。

权限迁移按当前项目“未发布、无需兼容”原则直接替换 Seed、角色授权、Controller Guard、前端按钮和规则测试，不保留旧权限别名。

## 12. 数据模型最终核验

Cordys 最终 DDL 演进确认：

- 基础客户、字段、联系人、协作、关系、公海、规则、容量和负责人历史表已存在。
- 后续迁移为容量增加 `filter`。
- 公海领取规则增加新数据保护字段，客户增加 `reason_id`，增加公海隐藏字段表。
- 联系人 `customer_id` 最终为 nullable。

当前 Prisma 直接模型已覆盖这些结构，并带有更严格的组织级唯一索引。结论：

1. task 4.1 不新增 migration；
2. 公海进入时间继续使用 `Customer.updateTime`，不新增重复字段；
3. task 4.3 必须把联系人创建 DTO 的 `customerId` 改为可选；
4. DB-017、DB-020 继续保持 `IN_PROGRESS`，直到 API、页面和专项验收完成；
5. DB-022 继续跟踪客户公海、客户库容和移入公海原因三个模块设置入口。

## 13. 当前 MicroMatrix 差异矩阵

| 现状                                               | Cordys 目标                     | 落点                  |
| -------------------------------------------------- | ------------------------------- | --------------------- |
| `/customers` 单体 Controller                       | `/account/*`                    | task 4.2 直接替换     |
| `/contacts`                                        | `/account/contact/*`            | task 4.3 直接替换     |
| 普通客户与公海在客户 Controller 混合               | 独立 `/pool/account/*`          | task 4.5 直接替换     |
| 页面使用 `/resource-pools/options?module=customer` | `/pool/account/options`         | task 4.5/4.6 删除调用 |
| 普通 `assertRead` 可被 Pool Membership 放宽        | 普通、协作、只读、公海四类断言  | task 4.2/4.5          |
| 缺 `customerPool:read/pick/assign`                 | 公海独立权限                    | task 4.2/4.5          |
| `customer:assign` 混合转移/入池                    | `transfer` 与 `recycle` 分离    | task 4.2              |
| `customer:team` 独立权限                           | 协作复用 `customer:update`      | task 4.4              |
| 联系人创建强制 `customerId`                        | 独立联系人允许为空              | task 4.3              |
| 合并让用户选择联系人冲突策略                       | 按动态字段唯一规则自动处理      | task 4.4              |
| 公海批量操作未统一验证全部 ID                      | 全部 ID 同一已授权 Pool         | task 4.5              |
| 模块设置三个客户入口仍是占位                       | 公海、库容、原因真实 Drawer/API | task 4.5/4.6          |
| 旧导入/导出兼容路径与错误权限绑定                  | Cordys 精确路径和权限           | task 4.2～4.5 删除    |

PC 页面路由可继续使用现有 `/customers`、`/contacts`、`/customers/pool` 作为前端导航地址；必须替换的是后端 API 契约、行为和权限，不要求把浏览器 URL 改成 Java Controller 路径。

## 14. 实施硬约束

1. 不保留 `/customers`、`/contacts`、旧统一公海写入口或旧权限别名。
2. 所有 ID 查询都带 `organizationId`，跨租户统一返回不可见。
3. 批量转移、入池、领取、分配、编辑、删除和导出选中必须逐 ID 验证。
4. 客户主体、动态字段、联系人负责人、Owner History、协作/关系和通知 outbox 的关键副作用处于同一数据库事务。
5. 角色功能权限与资源数据范围分开判定；有按钮权限不等于可操作任意客户。
6. 公海隐藏字段在后端序列化阶段裁剪，不能只靠前端隐藏列。
7. 联系人商机关联拒删由后端强制；前端预检只改善交互。
8. 合并、关系图和自动回收失败必须整体回滚并留下可审计错误。
9. 后续暂未轮到但发现的数据缺口继续回写 `cordys-deferred-backlog.md`，不得只留在代码注释或聊天中。

## 15. 实施进度

task 4.2 已完成普通客户 `/account` 主契约切换与客户 360 后端收口：

- 普通客户列表强制排除公海客户，旧 `/api/customers` Controller 已移除；
- 客户 360 的商机、合同、回款计划、回款记录、发票、订单列表与统计在 CustomerAccess 之后继续叠加各关联模块 DataScope；
- 客户编辑时负责人变更、联系人负责人、Owner History、客户主体与动态字段处于同一事务；
- 客户删除事务补齐动态字段、Blob 和跟进计划清理；
- Cordys 证据纠正：`/account/option` 为 POST，回款计划/记录位于 `/account/contract/payment-plan/*` 与 `/account/contract/payment-record/*`；
- 专项 Smoke：`node scripts/w343-customer-api-smoke.mjs`，22 passed / 0 failed；API rules 114/114，Shared/API/Web typecheck 与受影响文件 lint 通过。

task 4.3 已完成联系人 `/account/contact/*` 主契约收口；下一独立执行单元是 **W3.4.3 task 4.4：对齐客户协作、关系和合并**。客户公海完整规则与 API 继续在 task 4.5 收口。

### 15.1 task 4.3 联系人实施锁定

2026-08-28 再次按 Cordys `CustomerContactController`、`CustomerContactService`、`ExtCustomerContactMapper.xml` 与前端 requrls 复核，task 4.3 按以下顺序实施：

1. **破坏式切换 API 命名空间**：删除旧 `/contacts/*` Controller，统一使用 `/account/contact/*`；User View 已提前位于 `/account/contact/view/*`，本任务不再增加兼容别名。
2. **恢复 Cordys Pager 契约**：独立联系人 `/page` 使用 `current/pageSize/keyword/filters/viewId/sort` 请求，响应返回 `list/total/current/pageSize/optionMap`；Web 端只在 API adapter 内转换为当前页面使用的 `PaginatedResult`。
3. **恢复联系人表单与图表入口**：增加 `/module/form` 与 `/chart`，动态字段继续使用 `CustomerContactField/Blob` 直接模型；图表、导出和分页都执行 CONTACT READ DataScope。
4. **允许独立联系人无客户**：`customer_contact.customer_id` 已是 nullable；独立 `add/import` 不再强制 `customerId`，只有客户 360 内嵌创建时由前端携带当前 `customerId`。若请求显式携带 `customerId`，后端才执行 Customer 子资源写权限校验。
5. **严格拆分独立联系人与客户子资源访问**：独立 `/page`、导出和批改只按 CONTACT 权限与联系人 owner DataScope；`/list/{customerId}` 继续执行 Customer 资源边界，并按 Cordys 规则处理 Customer owner、部门范围、`COLLABORATION` 与联系人 owner；`READ_ONLY` 不获得联系人写权限。
6. **写链路与唯一性**：新增、更新、导入继续执行系统字段 + 动态字段唯一规则；启停保存/清空原因；批量仅保留更新与导出选中，不新增批量删除。
7. **删除安全收紧**：保留需求 R8 的后端商机关联拒删，不能只依赖前端 `/opportunity/check/{id}`；删除主体与联系人动态字段/Blob、附件在同一事务清理。
8. **验收**：新增 `scripts/w343-contact-api-smoke.mjs`，至少覆盖 nullable customerId、Contact DataScope、客户 360 子资源裁剪、动态字段、启停原因、关联商机拒删、导入模板/导出/图表、旧 `/api/contacts` 404 与事务清理；同时复跑 Web typecheck、API typecheck、rules、ESLint 和 production build。

### 15.2 task 4.3 验收结果

- 旧 `/api/contacts/*` Controller 已删除，Web/移动端业务调用统一使用 `/account/contact/*`；`/contacts` 仅保留为浏览器导航路由。
- 独立联系人允许 `customerId=null`，显式关联客户时执行 Customer 子资源权限；Contact SELF DataScope 与客户 360 READ_ONLY/COLLABORATION 两类访问已通过真实 API/数据库 Smoke。
- 动态字段普通值与 Blob、unique、启停原因、图表、导出、模板、商机关联检查和后端拒删均通过；删除事务验证联系人主体与动态字段/Blob 同步清理。
- `node scripts/w343-contact-api-smoke.mjs`：**18 passed / 0 failed**；API rules **114/114**；Shared/API/Web typecheck、本批 ESLint、API/Web production build 和 `git diff --check` 全部通过。
