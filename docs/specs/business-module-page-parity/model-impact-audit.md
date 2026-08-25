# W3.4.0 直接模型与调用方影响审计

> 状态：已完成（任务 1.1）
>
> 审计日期：2026-08-25
>
> 范围：只固化 Cordys 最终数据模型、现有调用方和一次性替换顺序；本任务不修改 Prisma Schema、迁移或业务代码。
>
> 关联需求：R1、R2、R10

## 1. 审计结论

1. W3.4.0 需要建立 **32 张 Cordys 直接表**：模块表单 4 张、用户视图 2 张、线索域 9 张、客户域 14 张、仪表板 3 张。
2. 当前实现不能通过改表名完成迁移。旧模型把 Cordys 的分域表合并为 `Lead/Contact/customData/ResourcePool/ResourceOwnerHistory` 等通用结构，字段类型、时间类型、负责人历史、池规则、组织字段和关联方式均不一致。
3. 现有生产代码中至少有 15 个后端 Service 直接访问待删除 Prisma 模型；Web、shared、Seed、Smoke 和公共筛选/导出组件也直接依赖旧 DTO 或 `customData`。Schema 修改必须与这些调用方在 W3.4.0 同阶段切换。
4. 不建立兼容视图、双写、旧字段别名或 `Lead -> Clue` 包装模型。实施过程可以按本文顺序修改文件，但 W3.4.0 的完成提交中只能保留一套 Cordys 数据真相。
5. Cordys 的 `Dashboard.resource_id` 只是 1.1.0 初始 DDL，1.3.0 已改为最终的 `resource_url VARCHAR(500)`；Prisma 必须使用 `resourceUrl`。`dashboard_module.parent_id` 的根值是非空字符串 `NONE`，不能擅自改成 nullable 根节点。
6. Cordys 源码中存在 `CustomerContactBlob` Domain 类，但全迁移目录没有 `customer_contact_blob` DDL，Mapper/Service 也没有该表调用。它属于孤立源码，不进入目标 32 表；联系人动态大字段使用 `customer_contact_field_blob`。

## 2. 第一事实来源

### 2.1 最终 DDL 基线

- 模块表单/字段：`CordysCRM/backend/crm/src/main/resources/migration/1.0.0/ddl/V1.0.0_2__system_setting.sql`
- 客户域：`CordysCRM/backend/crm/src/main/resources/migration/1.0.0/ddl/V1.0.0_4__customer.sql`
- 线索域：`CordysCRM/backend/crm/src/main/resources/migration/1.0.0/ddl/V1.0.0_5__clue.sql`
- 仪表板：`CordysCRM/backend/crm/src/main/resources/migration/1.1.0/ddl/V1.1.0_2__ga_ddl.sql`
- 用户视图、池隐藏字段、池新数据保护、池原因：`CordysCRM/backend/crm/src/main/resources/migration/1.1.1/ddl/V1.1.1_2__ga_ddl.sql`
- 后续最终结构修订：1.0.1、1.0.4、1.1.3、1.1.5、1.2.1、1.2.3、1.3.0、1.4.1、1.5.0、1.6.2、1.8.0 对应 DDL。

不能只复制首版建表语句。最终结构必须合并以下演进事实：

- `customer_capacity.filter TEXT`；
- Clue/Customer 与 Owner History 的 `reason_id`；
- Pick Rule 的 `limit_new/new_pick_interval`；
- `sys_user_view_condition.children_value TEXT`；
- `customer_contact.customer_id` 最终允许为空；
- `dashboard.resource_id` 最终改为 `resource_url VARCHAR(500)`；
- `clue.phone` 最终为 `VARCHAR(255)`，Clue/CustomerContact 有 phone 查询索引；
- `sys_module_form.form_key` 最终为 `VARCHAR(50)`；
- `sys_module_field_blob.prop` 最终为 `LONGTEXT`；
- `clue_pool_hidden_field.field_id` 最终为 `VARCHAR(255)`。

### 2.2 Domain、Mapper 与 Service 交叉校验

- 线索：`clue/domain/*`、`ExtClueMapper.xml`、`ExtCluePoolMapper.xml`、`ExtClueOwnerMapper.xml`、`ExtClueCapacityMapper.xml`、`ClueService`、`PoolClueService`、`CluePoolService`。
- 客户：`customer/domain/*`、`ExtCustomerMapper.xml`、`ExtCustomerContactMapper.xml`、`ExtCustomerPoolMapper.xml`、`ExtCustomerOwnerMapper.xml`、`ExtCustomerCapacityMapper.xml` 及 Customer/Contact/Pool/Collaboration/Relation Service。
- 用户视图与表单：`UserView/UserViewCondition/ModuleForm/ModuleField` Domain、对应 Ext Mapper、`UserViewService`、`ModuleFormService`、`ModuleFieldService`。
- 仪表板：`dashboard/domain/*`、三个 Ext Mapper、`DashboardService`、`DashboardModuleService`、`DashboardSortService`。

Mapper 证明 `scope_id` 是 JSON/范围 token 文本而不是 PostgreSQL 数组；动态字段筛选通过普通值表或 Blob 表 JOIN；池领取/回收读取独立分域规则；Dashboard 收藏由 Service 先查重后写入。NestJS 可以补充不改变业务语义的外键/并发唯一约束，但不能用约束替代 Cordys Service 规则。

## 3. 逐表差异与替换动作

所有带 `audit` 的表均指 Cordys `BaseModel`：`id/createUser/updateUser/createTime/updateTime`；时间为 epoch milliseconds `BIGINT`，不是当前的 Prisma `DateTime`。

### 3.1 模块表单与用户视图（6 张）

| Cordys 表 | 最终核心结构 | 当前实现 | W3.4.0 动作 |
| --- | --- | --- | --- |
| `sys_module_form` | `formKey VARCHAR(50)/organizationId/audit` | `FieldDefinition` 直接按 tenant/module 存全部字段 | 新建 `SysModuleForm`，组织字段只用 `organizationId` |
| `sys_module_form_blob` | 与 form 同 ID 的 `prop TEXT` | FieldDefinition 的 `options/config/layout` 分散列 | 新建 `SysModuleFormBlob`；表单属性保留 Cordys 文本契约 |
| `sys_module_field` | `formId/internalKey/name/type/mobile/pos/audit` | `FieldDefinition.key/label/type/system/hidden/sort` | 新建 `SysModuleField`；索引保留 `formId+internalKey`、`mobile` |
| `sys_module_field_blob` | 与 field 同 ID 的 `prop LONGTEXT` | `options/config/required/span/showInList/listWidth` | 新建 `SysModuleFieldBlob`，由适配器生成现有稳定 FieldVO |
| `sys_user_view` | `userId/name/fixed/resourceType/organizationId/pos/enable/searchMode/audit` | `SavedView.tenantId/module/sort/enabled` | 新建 `SysUserView`，删除旧表与旧 Prisma 模型 |
| `sys_user_view_condition` | `sysUserViewId/name/value/valueType/type/multipleValue/operator/childrenValue/audit`，值均为文本契约 | `SavedViewCondition.field/value JSON/fieldType/containChildIds[]/sort` | 新建直接模型；条件树显式序列化，不能继续依赖 Prisma JSON/数组 |

### 3.2 线索域（9 张）

| Cordys 表 | 最终核心结构 | 当前实现 | W3.4.0 动作 |
| --- | --- | --- | --- |
| `clue` | `name/owner/stage/lastStage/contact/phone/products/organizationId/collectionTime/inSharedPool/transitionType/transitionId/follower/followTime/poolId/reasonId/audit` | `Lead` 使用 `tenantId/contactName/email/status/inPool/ownerId/deptId/customData/DateTime` | 用 `Clue` 完整替换 `Lead`；删除 `LeadStatus`，阶段与转换事实按 Cordys 表达 |
| `clue_field` | `id/resourceId/fieldId/fieldValue VARCHAR(255)` | `Lead.customData JSONB` | 普通动态值进入直接表；保留复合查询索引 |
| `clue_field_blob` | `id/resourceId/fieldId/fieldValue TEXT` | `Lead.customData JSONB` | 大文本/序列化值进入 Blob 表 |
| `clue_owner` | `clueId/owner/collectionTime/endTime/operator/reasonId` | `ResourceOwnerHistory(module=lead)` | 独立负责人历史；写入时必须显式提供 epoch ms |
| `clue_pool` | `name/scopeId TEXT/organizationId/ownerId TEXT/enable/auto/audit` | `ResourcePool(module=lead)`，scope/manager/hidden 为数组 | 独立线索池；范围文本按 Cordys 解析，隐藏字段拆表 |
| `clue_pool_hidden_field` | 复合主键 `poolId+fieldId`，fieldId 最终 255 | `ResourcePool.hiddenFieldIds[]` | 新建关联表，删除数组字段 |
| `clue_pool_pick_rule` | `poolId/limitOnNumber/pickNumber/limitPreOwner/pickIntervalDays/limitNew/newPickInterval/audit` | 通用 PickRule 的 daily/cooldown 字段 | 按 Cordys 命名和 nullable/default 建独立规则 |
| `clue_pool_recycle_rule` | `poolId/operator/condition TEXT/audit` | 通用 RecycleRule `conditions JSON` 与旧 `PoolRule` 天数抽象 | 保存 Cordys 条件文本；删除两个旧规则真相 |
| `clue_capacity` | `organizationId/scopeId TEXT/capacity/audit` | `ResourceCapacity(module=lead)`，scope 数组 | 独立库容表；同 scope 冲突由 Service/事务保证 |

### 3.3 客户域（14 张）

| Cordys 表 | 最终核心结构 | 当前实现 | W3.4.0 动作 |
| --- | --- | --- | --- |
| `customer` | `name/owner/collectionTime/poolId/inSharedPool/organizationId/follower/followTime/reasonId/audit` | plural `customers` 还含 industry/phone/email/remark/customData/deptId/DateTime | 改为直接 `Customer`；非 Cordys 主列业务字段进入动态字段值表 |
| `customer_field` | `id/resourceId/fieldId/fieldValue VARCHAR(255)` | `Customer.customData` | 普通动态值直接表 |
| `customer_field_blob` | `id/resourceId/fieldId/fieldValue TEXT` | `Customer.customData` | 大文本动态值直接表 |
| `customer_owner` | `customerId/owner/collectionTime/endTime/operator/reasonId` | `ResourceOwnerHistory(module=customer)` | 独立负责人历史 |
| `customer_contact` | `customerId? /owner/name/phone/enable/disableReason/organizationId/audit` | `Contact` 强制 customerId，含 tenantId/deptId/customData/DateTime | 改名为 `CustomerContact`；最终 `customerId` 必须 nullable，Opportunity 联系人关系一并切换 |
| `customer_contact_field` | `id/resourceId/fieldId/fieldValue VARCHAR(255)` | `Contact.customData` | 普通动态值直接表 |
| `customer_contact_field_blob` | `id/resourceId/fieldId/fieldValue TEXT` | `Contact.customData` | 大文本动态值直接表；不创建无 DDL 的 `customer_contact_blob` |
| `customer_collaboration` | `userId/customerId/collaborationType/audit` | `CustomerTeamMember` 含 tenantId/role/createdById 等兼容字段 | 新建直接模型；保留 `COLLABORATION/READ_ONLY` Service 语义，删除 role 兼容字段 |
| `customer_relation` | `sourceCustomerId/targetCustomerId/createTime` | plural 表额外 tenantId 和 DB unique | 映射单数表；组织隔离从客户记录校验，集团/子公司约束由 CustomerRelationService 执行 |
| `customer_pool` | 与 CluePool 同构 | `ResourcePool(module=customer)` | 独立客户公海模型 |
| `customer_pool_hidden_field` | 复合主键 `poolId+fieldId` | `hiddenFieldIds[]` | 新建关联表 |
| `customer_pool_pick_rule` | 与 Clue PickRule 同构 | 通用 PickRule | 新建分域规则 |
| `customer_pool_recycle_rule` | `condition TEXT` | 通用 JSON RecycleRule + PoolRule | 新建分域规则，删除旧规则模型 |
| `customer_capacity` | `organizationId/scopeId TEXT/capacity/filter TEXT/audit` | 通用 Capacity 的 `filters JSON` | 新建直接模型；filter 保持 Cordys 文本契约 |

### 3.4 仪表板（3 张）

| Cordys 表 | 最终核心结构 | 当前实现 | W3.4.0 动作 |
| --- | --- | --- | --- |
| `dashboard_module` | `organizationId/name/parentId='NONE'/pos BIGINT/audit` | 无数据库模型；`/reports` 是固定 Vue 报表 | 新建目录树直接模型；根节点保持 `NONE` |
| `dashboard` | `name/resourceUrl VARCHAR(500)/dashboardModuleId/organizationId/pos/scopeId TEXT/description/audit` | 无数据库模型；当前同名 Nest 模块是销售统计 | 新建资源模型；释放 `/api/dashboard` 路径给 Cordys 资源 API |
| `dashboard_collection` | `userId/dashboardId/audit` | 无数据库模型 | 新建收藏模型；Cordys Service 先查重，PostgreSQL 可用组合唯一约束封住并发重复 |

## 4. Prisma relation 与下游编译断点

### 4.1 Schema relation

| 当前 relation | 直接替换后的要求 |
| --- | --- |
| `Tenant.customers Customer[]`、`Tenant.contacts Contact[]` | 目标表不保留 `tenantId`；删除旧 relation，业务查询统一用 `organizationId`。若保留 Prisma relation，只能关联同一 ID 的组织实体，不得双字段并存 |
| `User.ownedCustomers`、`User.ownedContacts` | `owner` 在 Cordys 是字符串用户 ID；可建立关系但字段名和 onDelete 行为不得改变业务记录 |
| `Customer.contacts Contact[]` | 改为 `CustomerContact[]`，且 Contact 的 `customerId` 最终允许空，删除客户时不能用当前 Cascade 抹掉所有独立联系人 |
| `Customer.teamMembers CustomerTeamMember[]` | 改为 `CustomerCollaboration[]` |
| `Customer.opportunities/quotes/contracts` | 继续关联目标 `Customer`；所有生成类型和 include/select 会重编译 |
| `Opportunity.contact Contact?` | 改为 `CustomerContact?`；联系人删除仍需业务层拒绝被商机引用的数据 |
| `ResourcePool.pickRule/recycleRule` | 删除通用 relation，分别建立 CluePool 与 CustomerPool 规则关系 |
| `SavedView.conditions` | 改为 `SysUserView.conditions`，条件字段与序列化格式全部变化 |

### 4.2 关键类型差异

- `tenantId` 只在请求鉴权边界存在；目标 W3.4 表内统一为 `organizationId`。
- Cordys BaseModel 时间和业务时间均为 `BIGINT` epoch ms。API 必须集中安全序列化，不能把 Prisma `BigInt` 直接交给 JSON。
- `scopeId/ownerId/condition/filter/prop/value/childrenValue` 是文本契约，不得自动改为 PostgreSQL array/JSONB 数据库真相。
- `inPool/inSea` 改为统一 Cordys 字段 `inSharedPool`；`ownerId` 改为 `owner`，`collectedAt` 改为 `collectionTime`，`lastFollowedAt` 改为 `followTime`。
- `Lead.status` 和 `LeadStatus` 不保留；转换状态由 `stage/lastStage/transitionType/transitionId` 共同表达。
- `CustomerContact.enable` 的 Cordys DDL 注释与 Java 字段命名存在历史歧义，模型保留原字段；启停行为必须在任务 4.1/4.3 继续以页面、API 与 Service 校验，不能仅凭注释反转布尔值。

## 5. 待删除模型的调用方清单

以下为生产代码、模块装配、Web、shared、Seed/Smoke 的当前直接调用点。旧迁移文件只作为历史证据保留，不回写。

### 5.1 Lead / LeadStatus

- Prisma/关系：`apps/api/prisma/schema.prisma`。
- 后端直接访问：
  - `apps/api/src/modules/leads/leads.service.ts`
  - `apps/api/src/customers/customers.service.ts`
  - `apps/api/src/modules/bidding/bidding.service.ts`
  - `apps/api/src/modules/dashboard/dashboard.service.ts`
  - `apps/api/src/modules/follow-up-plans/follow-up-plans.service.ts`
  - `apps/api/src/modules/follow-ups/follow-ups.service.ts`
  - `apps/api/src/modules/members/members.service.ts`
  - `apps/api/src/modules/pool-rules/pool-recycle.service.ts`
  - `apps/api/src/modules/pool-rules/resource-pools.service.ts`
- DTO/shared/Web：`apps/api/src/modules/leads/dto/lead.dto.ts`、`packages/shared/src/sales.ts`、`apps/web/src/api/sales.ts`、`apps/web/src/views/LeadsView.vue`、Mobile Leads 页面与转换组件。
- Seed/测试：现有 Seed 没有线索样例；`scripts/smoke.mjs` 直接断言 `status/inPool/customData`，必须重写。

### 5.2 Contact

- Prisma/关系：`Customer.contacts`、`Tenant.contacts`、`User.ownedContacts`、`Opportunity.contact`。
- 后端直接访问：`customers.service.ts`、`contacts.service.ts`、`follow-up-plans.service.ts`、`members.service.ts`、`opportunities.service.ts`。
- DTO/shared/Web：`modules/contacts/dto/contact.dto.ts`、`packages/shared/src/sales.ts`、`apps/web/src/api/customers.ts`、Contacts/Customers/CustomerDetail/CustomerContactTable 及 Mobile 联系人组件。
- Seed/测试：现有 Seed 无联系人样例；`scripts/smoke.mjs` 使用 `customData` 与强制 customerId。

### 5.3 CustomerTeamMember

- Prisma relation：`Customer.teamMembers`，旧表有 `@@unique(customerId,userId)`。
- 后端直接访问：`customer-access.service.ts`、`customers.service.ts`、`follow-up-plans.service.ts`、`leads.service.ts`、`members.service.ts`。
- Web 通过客户 360 的协作 API 间接依赖：`CustomerDetailView.vue`、`CustomerDetailDrawer.vue`、customer overview 组件。
- Seed/测试：Seed 无协作样例；客户/线索转换 Smoke 依赖协作者结果。

### 5.4 FieldDefinition 与 customData

- 唯一直接 DB Service：`apps/api/src/modules/metadata/metadata.service.ts`；`ModulesView.vue` 当前删除提示也明确依赖 customData。
- 目标域后端：customers/leads/contacts Service 与 DTO，bidding 创建线索时写 `cf_source`。
- 公共基础设施：`apps/api/src/common/filter-builder.ts`、`export-format.ts`、`apps/web/src/components/form-engine/DynamicForm.vue`、`AdvancedFilter.vue`、`field-display.ts`、`CsvImportDialog.vue`。
- Web/shared：Leads/Customers/Contacts 及 Mobile 页面、`packages/shared/src/metadata.ts`、`sales.ts`、`index.ts`。
- 测试：`scripts/smoke.mjs`；Swagger 的旧 customData 示例也需同步。
- 非 W3.4 目标模块仍使用 `customData` 的事实另登记 DB-021，不能因删除 `FieldDefinition` 让商机、产品、报价、合同、订单和跟进计划失去字段配置能力。

### 5.5 SavedView / SavedViewCondition

- 后端：`modules/saved-views/*`、`customers.service.ts`、`contacts.service.ts`、`leads.service.ts`、`members.service.ts`；模块装配位于 `app.module.ts` 与对应业务 module。
- Web：`apps/web/src/api/saved-views.ts`、`SavedViewBar.vue`、Leads/Customers/Contacts/CustomerPool 页面、SalesSettings 页面。
- Seed/测试：Seed 无用户视图样例；`scripts/smoke.mjs` 覆盖旧条件 JSON/数组契约。

### 5.6 ResourcePool / PickRule / RecycleRule / ResourceCapacity

- 后端：`modules/pool-rules/resource-pools.service.ts`、`pool-recycle.service.ts`、`resource-recycle-condition-evaluator.service.ts`、`customers.service.ts`、`leads.service.ts`、`follow-up-plans.service.ts`、`customer-access.service.ts`；Controller/DTO/Module 位于 `modules/pool-rules/*`。
- Web：`apps/web/src/api/sales.ts`、LeadsView、CustomerPoolView、SalesSettingsView、Mobile CustomerOpenSeaPane。
- Seed/测试：Seed 无多池、规则和库容数据；`scripts/smoke.mjs` 调用旧 `/resource-pools` 与 `/resource-capacities`。

### 5.7 PoolRule

- 后端：`pool-rules.service/controller/module`、`pool-recycle.service.ts`，并由 Customers/Leads/FollowUpPlans module 注入。
- Web/shared：`apps/web/src/api/sales.ts`、`SalesSettingsView.vue`、`packages/shared/src/sales.ts`。
- 该单规则模型不能与 Cordys 多池 Pick/Recycle Rule 并存，必须删除。

### 5.8 ResourceOwnerHistory

- 后端直接访问：`customers.service.ts`、`leads.service.ts`、`pool-recycle.service.ts`、`resource-pools.service.ts`。
- Web 通过客户/线索详情负责人历史接口间接依赖。
- 替换为 `ClueOwner` 与 `CustomerOwner`，调用方必须显式选择分域 Repository。

## 6. 旧 Dashboard 与 `/reports` 入口

| 入口 | 当前文件 | 处理 |
| --- | --- | --- |
| Nest 模块装配 | `apps/api/src/app.module.ts`、`modules/dashboard/dashboard.module.ts` | 当前统计模块迁移/拆分到 Home；`DashboardsModule` 重新承担 Cordys 仪表板资源 |
| 5 个统计接口 | `dashboard.controller.ts` 的 `summary/funnel/ranking/trend/conversion` | W3.4.1 首页统计改用 `/api/home/statistic/*`；旧路径删除 |
| 统计 Service | `dashboard.service.ts` | 线索统计切换 Clue；首页需要的逻辑按 Cordys Home Service 重建，不能整体保留成 Dashboard API |
| Web API | `apps/web/src/api/dashboard.ts` | 首页与仪表板分别建立 API，不保留旧 5 接口 |
| 首页 | `apps/web/src/views/DashboardView.vue` | W3.4.1 重建 Cordys 普通工作台 |
| 固定报表 | `apps/web/src/views/ReportsView.vue` | W3.4.4 替换为目录、资源、收藏、排序、嵌入/跳转页面 |
| 路由/菜单 | `apps/web/src/router/index.ts`、动态菜单配置 | `/dashboard` 仍是首页；`/reports` 仍是仪表板菜单入口，但组件和业务含义直接替换 |
| Smoke/Mobile API | `scripts/smoke.mjs`、`apps/web/src/mobile/api/index.ts` | 删除旧统计断言；Mobile 不新增仪表板，但既有首页 API 引用必须回归 |

## 7. Seed、测试与公共调用方影响

### 7.1 Seed

`apps/api/prisma/seed.ts` 当前只创建旧 `Customer` 样例，仍写 `tenantId/industry/phone/email/ownerId/deptId`，没有 Field/Form、Clue、Contact、UserView、Pool、Capacity、Owner History 或 Dashboard 样例。任务 1.8 必须改为直接模型 Seed，并至少形成：

- 组织、角色、用户及审计用户；
- Clue/Customer/CustomerContact 表单与普通/Blob 字段值；
- 系统视图代码事实和至少一个个人用户视图；
- 两个线索池、两个客户公海及 Scope/Hidden/Pick/Recycle/Capacity；
- 负责人历史、协作、客户关系、转换关系；
- Dashboard 目录、资源、Scope 和收藏。

### 7.2 自动化

- `scripts/smoke.mjs` 是主要旧模型 Smoke，必须重写旧字段和旧 URL。
- `scripts/wecom-sso-message-smoke.mjs` 中的 `customData` payload 需要回归，确认它不是 W3.4 目标业务字段值入口。
- 现有 Service 测试中 Metadata/FollowUpPlans/Pool 行为需重生成 mock 类型；不能通过 `as any` 长期绕过新 Prisma 类型。
- 迁移验收必须搜索旧表不存在、目标 32 表和关键索引存在，并从空库执行 Seed。

### 7.3 非直接 Prisma 但会编译失败的公共代码

- `DataScopeService` 和各模块的 Prisma `WhereInput` 类型引用；
- `filter-builder.ts` 的 JSONB 路径编译；
- `export-format.ts` 的 customData 值读取；
- Metadata 公式/校验输出，当前被商机、产品、报价、合同、订单、跟进计划复用；
- shared sales/metadata 类型、Web API response、动态表单/高级筛选/字段显示；
- `swagger.ts`、路由菜单、权限与消息资源类型中的 `lead/contact/dashboard` 名称映射。

## 8. 一次性替换顺序

以下是同一 W3.4.0 工作阶段内的安全编辑顺序，不代表允许提交双真相中间版本：

1. **冻结最终 Schema 规格**：按 32 表与最终 ALTER 结果确定字段、长度、nullable、默认值、索引、审计和删除行为；纠正 `resourceUrl`、`parentId='NONE'`、nullable `customerContact.customerId`。
2. **一次性改 Prisma relation**：创建目标模型，更新 Tenant/User/Customer/Opportunity/Quote/Contract 等关系，删除旧 enum/model/customData；生成破坏性 migration 并人工审计 SQL。
3. **先接公共元数据和值服务**：ModuleForms、Metadata adapter、ResourceFieldValueService、过滤/导入/导出/表单输出先可供业务 Service 使用。
4. **切换用户视图**：建立 UserViews Service 与条件文本序列化，切换所有列表，删除 SavedViews DB Service。
5. **切换分域 Repository**：Clue/Customer/CustomerContact 及各自 Pool/Rule/Capacity/Owner；只复用无状态规则计算器。
6. **迁移核心业务写链路**：线索 CRUD/转换/跟进、客户 CRUD/360/协作/关系/合并、联系人 CRUD、池领取/分配/回收，保证主记录与字段值同事务。
7. **迁移下游读写方**：bidding、follow-ups、follow-up-plans、members、opportunities、通知和旧 dashboard 统计依赖。
8. **迁移 Web/shared**：API、DTO、列表、详情、转换、Mobile、动态字段与系统设置；删除旧 URL 和兼容分支。
9. **重写 Seed/Smoke**：空库应用全部迁移、Seed、规则测试、真实数据库 Smoke、类型检查、Lint、构建和浏览器回归。
10. **负向搜索门槛**：生产代码不得再出现被删除 Prisma delegate、旧表名、`LeadStatus`、目标域 `customData`、旧统计 URL 或旧通用池 API。

## 9. 明确禁止的兼容路径

- 不保留 `Lead` Prisma 模型映射到 `clue`，也不导出 `type Lead = Clue` 供生产代码长期使用。
- 不保留 `Contact` 别名或 `/api/contacts` 与 Cordys Contact API 双 Controller。
- 不在 `Customer`/`Clue`/`CustomerContact` 同时保留 `customData` 和分域字段值表。
- 不保留通用 ResourcePool/OwnerHistory/PoolRule 与分域表双写。
- 不保留 `saved_views` 兼容视图或在 UserViews Service 回读旧表。
- 不保留旧 `/api/dashboard/summary|funnel|ranking|trend|conversion` 作为隐藏接口。
- 不保留固定 ECharts `/reports` 页面作为“经典版仪表板”。
- 不因当前项目未发布而编写历史数据回填、临时列、触发器或迁移兼容分支；空库迁移与 Seed 是唯一数据路径。

## 10. 已识别风险与后续门槛

1. **非目标模块动态字段**：Opportunity/Product/Quote/Contract/Order/FollowUpPlan 仍使用 `customData`，但它们共享即将删除的 FieldDefinition；已登记 DB-021。W3.4.0 必须保证它们的 Metadata 输出和现有页面继续工作，不能为完成目标三模块而破坏图外模块。
2. **关系删除语义**：CustomerContact 最终允许无客户，当前 `onDelete: Cascade` 不可直接沿用；Customer 删除/合并必须由 Service 处理联系人和商机引用。
3. **BigInt JSON**：所有 epoch ms/pos 必须经过统一 serializer；禁止到处手写 `Number()` 导致超安全整数或遗漏。
4. **文本范围与条件**：Cordys 用 TEXT 保存 JSON 字符串；存储格式、解析失败和空值规则必须在 Rule/UserView/Scope 测试覆盖。
5. **数据库约束边界**：Cordys MySQL 很多表只建查询索引、不建 FK/unique。PostgreSQL 可增加防并发重复的约束，但每一项必须有 Cordys Service 行为证据，不能把当前 MicroMatrix 约束当成需求。
6. **分阶段页面计划**：任务 1.1 只允许进入 1.2/1.3；首页、线索、客户和仪表板页面仍分别由 W3.4.1～W3.4.4 实施，不能在 Schema 提交中用静态页面冒充完成。

## 11. 任务 1.1 验收结果

- [x] 32 张 Cordys 目标表已逐表对照最终 DDL、Domain 和 Mapper。
- [x] 待删除模型的 Prisma relation、后端、Web/shared、Seed 与 Smoke 调用方已列出。
- [x] 旧 Dashboard 统计和 `/reports` 固定报表入口已列出。
- [x] 删除清单、替换清单、禁止兼容路径和一次性替换顺序已固化。
- [x] 新发现的非目标模块动态字段数据库缺口已转入 DB-021。

任务 1.2～1.3 已按本文第 8、9 节完成，结果见 [W3.4.0 直接模型与破坏性迁移审计](./schema-migration-audit.md)。下一执行单元为任务 1.4：模块表单与动态字段底座。
