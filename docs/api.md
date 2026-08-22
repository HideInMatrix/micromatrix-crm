# 接口文档使用指南（Swagger / OpenAPI）

## 访问入口

| 地址 | 用途 |
| --- | --- |
| http://localhost:3000/api/docs | Swagger UI 在线文档与调试 |
| http://localhost:3000/api/docs-json | OpenAPI 3.0 JSON（供工具导入） |

文档默认常开（内部系统）；如需关闭，环境变量 `SWAGGER_ENABLED=false`。

## 在线调试步骤

1. 展开「认证」分组 → `POST /api/auth/login`，用演示账号登录拿到 `accessToken`
2. 点击页面右上角 **Authorize**，粘贴令牌（不需要 `Bearer ` 前缀），Authorize 后**刷新页面也会保留**
3. 任意接口 Try it out 即可；响应时长会显示在结果里

长期集成（脚本/第三方系统）请用 `POST /api/auth/api-token` 签发 365 天令牌，或到「Web 端 → 系统管理 → 企业设置 → 开放 API」生成。

## 导入到 Apifox / Postman

- **Apifox**：新建项目 → 导入数据 → OpenAPI/Swagger → URL 导入 `http://localhost:3000/api/docs-json`，可开启定时同步
- **Postman**：Import → Link → 同上 URL
- 每个接口的 `operationId` 形如 `Customers_findAll`（控制器_方法），导入后名称稳定可读

## 阅读约定（与文档首页描述一致）

- **鉴权**：除标注公开的接口（登录/注册/刷新/健康检查/SSE 流）外，一律需要 Bearer 令牌；无权限返回 `403`（缺权限码）、未登录返回 `401`
- **分页响应**：`{ items: T[], total, page, pageSize }`
- **高级筛选 filters**：JSON 字符串数组，`[{"key":"name","op":"contains","value":"科技"},{"key":"cf_xxx","op":"gt","value":100}]`
- **自定义字段**：写操作把 `cf_*` 键放进 `customData` 对象；字段定义通过 `GET /api/metadata/{module}/fields` 获取
- **错误结构**：`{ statusCode, message, error? }`，`message` 为中文提示，校验错误时可能为数组
- **数据范围**：成员可拥有多个角色；功能权限取并集，数据范围按当前接口权限码筛选角色后再合并，联调时需同时关注“权限码属于哪个角色”和该角色的数据范围

## 测试账号

| 账号 | 密码 | 数据范围 |
| --- | --- | --- |
| admin@demo.com | admin123 | 全部 |
| zhangwei@demo.com | demo123 | 本部门及下级 |
| lina@demo.com | demo123 | 仅本人 |

## 已知限制

- 响应体 Schema 未逐接口建模（VO 为 TS interface，无运行时元数据）：响应结构以 `packages/shared/src` 中的 `*VO` 类型为准；后续如需完整响应 Schema，可将 VO 改为带 `@ApiProperty` 的 class 或引入 nest CLI swagger 插件（需恢复 nest build 链路）
- SSE 接口（`GET /api/notifications/stream?token=`）无法在 Swagger UI 中调试，请用浏览器 EventSource 或 curl 验证

## 组织、成员与角色（R6 / R7 多角色）

```text
GET    /departments/tree
POST   /departments
PATCH  /departments/{id}
DELETE /departments/{id}

GET    /members
GET    /members/options
POST   /members
PATCH  /members/{id}
POST   /members/{id}/reset-password
POST   /members/{id}/toggle-status
DELETE /members/{id}

GET    /roles
GET    /roles/options
GET    /roles/{id}/members
POST   /roles/{id}/members              body: { userIds: string[] }
DELETE /roles/{id}/members/{userId}
POST   /roles
PATCH  /roles/{id}
DELETE /roles/{id}
```

- 部门名称在同一父部门下不区分大小写唯一；根部门不可删除，移动时禁止自身/子孙循环。
- 部门主管只能是当前租户、启用状态且直属该部门的成员；成员移出或停用后自动清理主管关系。
- 删除部门会检查下级部门、成员和角色 `scopeDeptIds` 引用；删除成员会检查业务资源、审批、协作和团队引用，且不允许操作自己。
- `GET /members/options` 与 `GET /roles/options` 为已登录业务选择器接口；角色 options 只返回 `id/name`，不暴露 permissions/dataScope/scopeDeptIds。
- 成员创建/更新使用 `roleIds: string[]` 且至少一个角色；成员列表返回 `roles + roleIds`。角色成员接口支持 Cordys 风格的角色侧批量关联与单人移除。
- 角色 `dataScope=CUSTOM` 时 `scopeDeptIds` 必填且必须属于当前租户；列表和单资源鉴权均包含所选部门的全部下级部门。
- 角色权限必须来自 shared canonical permission tree；动作码会自动补齐祖先菜单/READ，未知权限返回 `400`，超出操作人权限/数据范围的授权返回 `403`。
- 多角色功能权限为并集；数据范围不做全局“最大范围”压平。每次读取/动作只合并拥有该权限码（或 `*`）的角色：任一 `ALL` 胜出，否则合并部门范围并始终包含本人负责数据。无关角色的 `ALL/CUSTOM` 不会扩大当前动作权限的数据范围。

管理端动作权限码：

```text
system:dept:create / update / delete
system:member:create / update / status / resetPassword / delete
system:role:create / update / delete
```

`system:dept` / `system:member` / `system:role` 仍是页面菜单与 READ 权限。

## 模块与顶部导航配置（W2.1）

```text
GET   /module-configs
PATCH /module-configs/{moduleKey}                  body: { enabled: boolean }
POST  /module-configs/reorder                      body: { moduleKeys: NavigationModuleKey[] }

GET   /module-configs/top-navigation
POST  /module-configs/top-navigation/reorder       body: { navigationKeys: TopNavigationKey[] }
```

- 顶部导航读取接口对所有登录用户开放；排序接口要求 `system:module:update`。
- `navigationKeys` 必须一次提交且仅提交八个完整 key：`search / task / event / agent / notify / about / language / help`；缺项、重复或未知 key 返回 `400`。
- 旧租户首次读取时自动幂等补种默认顺序。Header 使用同一顺序，但只渲染 MicroMatrix 已具备的真实能力；`task` 还要求 `menu:approval`。
- Cordys 当前源码只有顶部导航列表与排序 API。虽然数据模型保留 `enabled`，W2.1 不开放启停接口。

## 多公海 / 多线索池自动回收规则

`POST /api/resource-pools` 与 `PATCH /api/resource-pools/{id}` 的 `recycleRule` 使用 CordysCRM 时间规则语义：

```json
{
  "autoRecycle": true,
  "recycleRule": {
    "operator": "AND",
    "conditions": [
      {
        "column": "storageTime",
        "operator": "DYNAMICS",
        "value": "CUSTOM,30,BEFORE_DAY",
        "scope": ["Created", "Picked"]
      },
      {
        "column": "followUpTime",
        "operator": "DYNAMICS",
        "value": "CUSTOM,7,BEFORE_DAY"
      }
    ]
  }
}
```

约定：

- `column`: `storageTime | followUpTime`
- `operator`: `FIXED | DYNAMICS`
- `FIXED` 的 `value`: `开始毫秒时间戳,结束毫秒时间戳`
- `DYNAMICS` 可用预设：`TODAY / YESTERDAY / TOMORROW / WEEK / LAST_WEEK / MONTH / LAST_MONTH / LAST_SEVEN / SEVEN / LAST_THIRTY / THIRTY`
- 自定义动态阈值示例：`CUSTOM,30,BEFORE_DAY`（早于 30 天前），也支持 WEEK / MONTH 以及 AFTER
- `storageTime.scope`: `Created / Picked`；两者同时存在时创建时间或最近领取时间任一命中即可
- 启用 `autoRecycle` 时至少必须存在一条有效条件，否则 API 拒绝保存
- 新条件规则存在时优先执行；旧 `/pool-rules` 的 `recycleDays` 仅作为未配置新规则模块的兼容 fallback

库容接口：`GET/POST/PATCH/DELETE /api/resource-capacities`。同一模块下的 Scope 不能命中同一个实际成员：服务端会把 `* / user:* / dept:* / 裸 user/dept id` 展开成实际用户集合后判断交集，因此 `dept:销售部` 与该部门成员 `user:xxx` 不能分别建立两条库容规则。该行为对齐 Cordys `hasDuplicateScopeObj()` 的“按实际成员防重”语义。

## 客户协作权限

客户协作使用 `customer_team_members.collaborationType`：

- `READ_ONLY`：可读取客户详情和客户跟进记录，但不会获得客户主体修改权限，也不能新增客户跟进或联系人。
- `COLLABORATION`：在没有普通客户数据范围时，可读取客户详情/跟进，并新增跟进；联系人仅能查看、创建、修改、删除自己负责的数据。
- 协作身份不会赋予客户主体 `update/delete/assign/team manage` 权限；这些操作仍要求正常客户数据范围，公海管理操作可由池管理员完成。
- 客户集团关系属于 Cordys 的协作子域例外：`COLLABORATION` 在具备 `customer:update` 功能权限时可编辑关系；`READ_ONLY` 仍只能查看。该例外不会扩展到客户主体字段。

客户详情 `GET /api/customers/{id}` 返回当前用户对该客户的资源级能力：

```json
{
  "collaborationType": "READ_ONLY",
  "canManageCustomer": false,
  "canCollaborateWrite": false
}
```

- `collaborationType` 只有在当前访问依赖协作关系时返回 `READ_ONLY/COLLABORATION`；正常 owner/部门数据范围或公海访问为 `null`。
- `canManageCustomer=true` 只表示当前用户通过正常客户数据范围拥有客户主体管理能力；协作关系不会把它提升为 true。
- `canCollaborateWrite=true` 表示可写联系人/客户跟进子域；普通公海“可见”不会自动获得该能力，必须先领取或通过 `COLLABORATION` 获得协作写能力。

### 联系人（R3，按 Cordys `/account/contact` 资源边界）

```text
POST /contacts/page                       独立联系人分页
GET  /contacts/list/{customerId}          客户下联系人列表
GET  /contacts/get/{id}                   联系人详情
POST /contacts/add                        新增联系人
POST /contacts/update                     更新联系人
GET  /contacts/enable/{id}                启用联系人
POST /contacts/disable/{id}               停用联系人（reason 必填）
GET  /contacts/delete/{id}                删除联系人
GET  /contacts/opportunity/check/{id}     删除前商机关联检查
GET  /contacts/tab                        ALL/DEPT 数据视图显隐
POST /contacts/batch/update               批量修改一个字段
GET  /contacts/template/download          xlsx 导入模板
POST /contacts/import/pre-check           xlsx 导入预校验
POST /contacts/import                     xlsx 正式导入
POST /contacts/export-all                 导出全部任务
POST /contacts/export-select              导出选中任务
```

- Contact 核心固定字段按 Cordys 收口为 `customerId / ownerId / name / phone / enable / disableReason`；额外字段走 Metadata `customData`，不再保留早期页面驱动的固定 `position/email`。
- 新增时 `ownerId` 可省略并默认当前用户；负责人变化同步 `deptId`。
- 独立联系人页使用 Contact 自己的 owner/dept 数据范围；客户详情内嵌列表继续按客户资源访问语义处理。仅依靠 `COLLABORATION` 访问客户时，只能管理自己负责的联系人；`READ_ONLY` 不获得联系人子域写能力。
- Opportunity 可通过 `contactId` 绑定当前客户下的联系人；联系人被商机引用时 Service 层拒绝删除。
- 联系人批量能力与 Cordys 一致，仅提供“导出选中 + 批量编辑”，不新增批量删除。

### 线索转换（R4，按 Cordys `/lead/*` 转换边界）

```text
POST /leads/transform                    自动转换：客户+联系人固定，商机可选
POST /leads/transition/account           使用客户新增表单新建客户并关联线索
POST /leads/re-transition/account        一条/批量线索关联已有客户
POST /leads/transition/account/page      关联客户全屏抽屉的候选客户分页
GET  /leads/{id}                         线索详情（含 transitionType/transitionId）
```

`POST /leads/transform` 请求示例：

```json
{
  "clueId": "lead-id",
  "oppCreated": true,
  "oppName": "2026 年升级项目"
}
```

转换规则：

- 自动转换固定处理客户和联系人；商机是唯一可选项。商机名称最大 255 字符，不再接受旧实现中的“创建联系人开关/商机金额”。
- Lead 成功关联客户后写 `transitionType=CUSTOMER / transitionId=customerId`；旧 `convertedCustomerId` 与旧 `POST /leads/{id}/convert` 已移除。
- 客户 `name` 开启 Metadata `config.unique` 时，自动转换才复用同名客户；多条同名客户优先选择“不在公海且负责人=线索负责人”的记录，否则取第一条。未开启 unique 时同名仍创建新客户。
- 联系人 `name/phone` 的 `config.unique` 分别决定是否执行姓名/电话唯一校验。按 Cordys 实际 SQL，唯一范围是当前租户而非单个客户；命中重复时跳过本次联系人创建。
- 关联已有客户的候选范围为：正常客户数据范围 + 当前用户协作客户 + 当前用户可访问公海；`READ_ONLY` 协作客户会返回但 `selectable=false`，直接绕过 UI 调接口也会被 Service 拒绝。
- 关联公海客户前先执行领取规则；领取失败则不继续转换。
- 线索负责人不是客户负责人且尚未在团队中时，自动补 `COLLABORATION`；商机绑定本次新建联系人；线索 FollowUpRecord 复制到客户且原记录保留，同时刷新客户 `lastFollowedAt`。
- MicroMatrix 当前尚无完整 FollowUpPlan 与 Cordys `FormLinkScenario` 跨字段映射配置。R4 不伪造 FollowUpPlan；动态字段仅迁移目标模块存在的同 key `customData`，显式跨字段映射归动态表单平台后续补齐。

## 保存的用户视图 SavedView

基础路径：`/api/saved-views`。

主要接口：

```text
GET    /saved-views/{module}
GET    /saved-views/detail/{id}
POST   /saved-views/{module}
PATCH  /saved-views/detail/{id}
DELETE /saved-views/detail/{id}
POST   /saved-views/detail/{id}/fixed
POST   /saved-views/detail/{id}/enabled
POST   /saved-views/{module}/reorder
```

当前销售核心 module：

```text
lead
lead_pool
customer
customer_pool
```

`customer_collaboration` 不再作为独立 SavedView module 使用。Cordys 的“协作客户”属于客户模块的系统视图，当前统一由 `customer` module + `view=COLLABORATION` 表达；历史数据若存在可保留，但新 Web 不再创建该 module 的个人视图。

视图服务端保存 `name + searchMode + conditions + fixed/enabled/sort`，与 Cordys UserView 语义一致。列表按 `sort desc` 返回；`fixed` 仅决定是否显示为顶部快捷标签，不改变排序。

Lead / Customer 列表可附加 `viewId`。如果同时传临时 `filters`：

```text
(SavedView 条件，内部按 AND/OR)
AND
(临时 filters，当前高级筛选按 AND)
```

列可见性与列顺序不是 SavedView 服务端数据。Web 按 `userId + module + viewId` 保存浏览器本地偏好，避免修改企业级字段配置。

## 客户系统视图与客户公海路由

PC 客户模块按 Cordys 拆为三个一级入口：

```text
/customers            客户
/contacts             联系人
/customers/open-sea   客户公海
```

`/customers` 不再用页面内 Tab 混入客户公海。普通客户列表使用以下系统视图：

```text
GET /customers/tab
GET /customers?view=ALL
GET /customers?view=SELF
GET /customers?view=DEPARTMENT
GET /customers?view=COLLABORATION
```

- `GET /customers/tab` 返回 `{ all, dept }`，只决定 ALL / DEPARTMENT 系统视图是否显示。
- `ALL` 表示当前角色数据权限下的全部可见客户，不会绕过角色 DataScope。
- `SELF` 只看本人负责客户。
- `DEPARTMENT` 使用当前角色允许的部门范围；无此系统视图权限时直接请求返回 403。
- `COLLABORATION` 只看当前用户作为客户协作成员的数据。
- 个人 SavedView 仍使用 `module=customer`；选中个人视图时使用角色默认数据范围，再叠加 SavedView 条件。
- 客户公海继续使用 `scope=sea + poolId` 和 `module=customer_pool`，但只在独立 `/customers/open-sea` 页面使用。

## 客户 360（R5）

客户详情保留轻量聚合接口：

```text
GET /customers/{id}/related
```

该接口用于兼容已有统计/轻量关联读取，但 R5 起会按当前用户模块权限裁剪：

- 联系人需要 `contact:read`，并继续服从客户协作子域规则。
- 商机需要 `menu:opportunity`。
- 合同聚合需要 `menu:contract`。
- 当前访问依赖 `READ_ONLY/COLLABORATION` 协作关系时，不通过该聚合接口泄露完整协作成员列表。

客户 360 的大列表使用独立分页接口：

```text
GET /customers/{id}/360/opportunities
GET /customers/{id}/360/contracts
GET /customers/{id}/360/receivablePlans
GET /customers/{id}/360/receivableRecords
GET /customers/{id}/360/invoices
GET /customers/{id}/360/orders
```

通用分页参数：`page`、`pageSize`，`pageSize` 最大 100。返回统一 `PaginatedResult`：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 10
}
```

权限边界：

- 所有 360 资源首先经过 `CustomerAccessService.assertRead()`，无客户读取权时不会因关联模块权限而旁路读取。
- `opportunities` 需要 `menu:opportunity`。
- `contracts / receivablePlans / receivableRecords / invoices` 需要 `menu:contract`。
- `orders` 需要 `menu:order`。
- `resource` 使用服务端白名单，未知值返回 400，不允许落入默认资源分支。
- 公海客户不开放上述普通客户 360 业务资源；即使用户可读取该公海客户，直接请求 `/360/*` 仍返回 403。公海详情只提供客户信息、跟进记录和负责人记录。

UI 对齐：

- PC 客户列表详情使用 100% 客户概览 Drawer；左侧为 Metadata 客户字段，右侧为 360 Tab，并支持左右/上下布局与 Tab 本地显隐偏好。
- Mobile `/customers` 按 Cordys 使用 `客户 / 联系人 / 客户公海` 三页签；普通客户详情使用全页 Tab，公海客户详情只显示客户信息 / 跟进记录 / 负责人记录。
- Cordys 的“跟进计划”依赖 `FollowUpPlan` 业务对象，当前项目尚无该模型，因此 R5 不提供无数据空壳 Tab。

## 客户集团 / 子公司关系

关系类型：

```text
GROUP       当前客户的上级集团
SUBSIDIARY  当前客户的下级子公司
```

主要接口：

```text
GET /customers/options?keyword=xxx
GET /customers/{id}/relations
PUT /customers/{id}/relations
```

`GET /customers/options` 对齐 Cordys 客户 option 接口，只返回租户内 `id/name`，用于关系选择器等轻量数据源。

推荐前端使用整组替换：

```json
{
  "relations": [
    { "relationType": "GROUP", "customerId": "group-id" },
    { "relationType": "SUBSIDIARY", "customerId": "child-id" }
  ]
}
```

约束：最多 11 条；同一个关联客户不能重复；最多一个 GROUP；不能关联自身；一个子公司只能属于一个集团；不能形成直接或间接循环。

原有 POST/PATCH/DELETE 单条关系接口继续保留兼容。`READ_ONLY` 协作关系只能查看；`COLLABORATION` 在具备 `customer:update` 权限时可使用整组保存接口编辑客户关系。

## 客户合并

客户合并使用独立权限：`customer:merge`。

主要接口：

```text
POST /customers/merge/preview
POST /customers/merge
```

请求：

```json
{
  "mergeIds": ["customer-a", "customer-b"],
  "toMergeId": "customer-a",
  "ownerId": "owner-id",
  "contactConflictStrategy": "KEEP_ALL"
}
```

联系人冲突策略：

- `KEEP_ALL`：默认，迁移全部源联系人，优先保证数据不丢失。
- `SKIP_DUPLICATES`：与主客户已有联系人姓名或电话冲突的源联系人不迁入；其联系人附件若存在，会先转挂到匹配主联系人。

负责人规则对齐 Cordys：

- `toMergeId` 属于 `mergeIds`：最终负责人只能选择这批已选客户当前已有负责人。
- `toMergeId` 不属于 `mergeIds`：表示使用其它可见客户作为主客户，`ownerId` 必须保持该主客户原负责人。

preview 不修改任何数据，返回：

```text
target / sources / finalOwner
customersToDelete
contacts / contactsWillMove / contactsWillSkip
opportunities / quotes / contracts
followUps / attachments / collaborations
relationsToRemove
contactConflicts[]
```

正式 merge 与 preview 共用同一套范围、负责人、库容和联系人冲突计算逻辑。合并不可回退；Web 必须在 preview 后进行二次确认。

## 池隐藏字段与负责人历史

`ResourcePool.hiddenFieldIds` 表示**当前池列表中隐藏的字段 ID**，不属于字段脱敏：

- `name` 字段始终显示，服务端会自动剔除其字段 ID。
- 未知字段、全局 hidden 字段不会写入配置。
- Lead/Customer API 行对象仍保持完整数据；Web 只在当前线索池/客户公海表格列层面应用隐藏配置。
- SavedView 本地列偏好会先计算，再叠加当前 Pool 的隐藏字段。

负责人历史接口：

```text
GET /leads/{id}/owner-history
GET /customers/{id}/owner-history
```

返回统一结构：负责人/部门、操作人、poolId、可选原因、`collectedAt` 与 `endedAt`。系统自动回收内部记录的 `reasonId=system` 不作为普通退池原因返回。客户负责人历史按客户读取权限访问，因此 READ_ONLY/COLLABORATION 也可查看其有权读取客户的负责人历史。

## Lead / Customer 批量字段修改与删除

普通列表接口：

```text
POST /leads/batch/update
POST /leads/batch/delete
POST /customers/batch/update
POST /customers/batch/delete
```

批量字段修改请求：

```json
{
  "ids": ["id-a", "id-b"],
  "fieldId": "字段定义 ID 或字段 key",
  "fieldValue": "新值"
}
```

- `fieldId` 同时支持 FieldDefinition ID 与 `name/phone/ownerId/cf_xxx` 等 key。
- fixed/custom 字段统一先解析元数据；hidden/formula 不允许批改。
- `ownerId` 是特殊字段，会复用负责人分配链路，不会绕过库容、部门同步、负责人历史和通知。
- 普通批量修改/删除先校验整批数据范围；任一记录无权操作时不会先写入其它记录。
- Customer 删除前检查 Contact / Opportunity，并额外保护 MicroMatrix 直接外键 Quote / Contract；命中任一引用时整批拒绝。

线索池 / 客户公海接口使用独立权限：

```text
POST /leads/pool/batch/update      -> leadPool:update
POST /leads/pool/batch/delete      -> leadPool:delete
POST /customers/pool/batch/update  -> customerPool:update
POST /customers/pool/batch/delete  -> customerPool:delete
```

请求除普通字段外必须带 `poolId`。服务端同时要求：

```text
独立 Pool 功能权限
AND
当前用户命中 pool.scopeIds 或 pool.managerIds（管理员 * 例外）
AND
本批 ids 全部属于同一个指定 poolId
```

因此“池成员”与“有池操作功能权限”是两个独立条件；Pool manager 身份本身不替代角色功能权限。

## xlsx 导入 / 导出任务（R2）

Lead / Customer 导入采用与 Cordys 一致的“两阶段”流程：先上传同一份 `.xlsx` 到 `pre-check`，确认成功/失败行后再调用正式 `import`。当前仅接受 `.xlsx`，单文件上限 100MB；旧 `.xls` 暂不支持。

普通线索：

```text
GET  /leads/import/template?importType=ADD|UPDATE
POST /leads/import/pre-check             multipart: importType + file
POST /leads/import                       multipart: importType + file
POST /leads/export/all                   query=当前列表筛选，body=fileName+headList
POST /leads/export/select                body=fileName+headList+ids
```

线索池：

```text
GET  /leads/pool/import/template?poolId=...&importType=ADD|UPDATE
POST /leads/pool/import/pre-check        multipart: poolId + importType + file
POST /leads/pool/import                  multipart: poolId + importType + file
POST /leads/pool/export/all?poolId=...
POST /leads/pool/export/select?poolId=...
```

客户/公海使用同构路径：

```text
/customers/import/*
/customers/export/all
/customers/export/select
/customers/pool/import/*
/customers/pool/export/all
/customers/pool/export/select
```

权限拆分：

```text
lead:import / lead:export
customer:import / customer:export
leadPool:import / leadPool:export
customerPool:import / customerPool:export
```

Pool/Sea 除功能权限外还必须通过 ResourcePool `scopeIds + managerIds` 成员校验。Pool/Sea 导入模板不包含负责人字段；服务端也会再次拒绝 owner 注入，并强制保持 `inPool/inSea + poolId` 归属。

`UPDATE` 模板首列固定为 `唯一ID`，正式更新只按该 ID 定位资源，不根据名称/电话猜测目标。导入返回：

```json
{
  "successCount": 2,
  "failCount": 1,
  "errorMessages": [
    { "rowNum": 4, "errMsg": "客户名称不能为空" }
  ]
}
```

导出 body 中的 `headList` 是字段 key 的有序数组；服务端会重新与 Metadata 白名单核对，未知/隐藏字段不能借由请求直接导出。`export/all` 继承当前 keyword / filters / viewId / data scope；`export/select` 严格限制在 `ids` 且仍执行资源可见性检查。

导出不会直接返回文件，而是创建 `ExportTask`。当前实现同步生成 xlsx 后立即进入 `SUCCESS/FAILED`；以后可把执行器替换为 BullMQ 而不改变接口：

```text
GET    /export-tasks
GET    /export-tasks/{id}/download
DELETE /export-tasks/{id}
```

任务只对创建者可见、可下载/清理，默认保留 24 小时。Web 顶栏“导出任务”抽屉用于查看和下载。

与 Cordys 仍存在一个明确差异：Cordys 字段配置支持 `rules.unique` 并在导入 ADD/UPDATE 时统一校验；MicroMatrix 当前 Metadata 尚无同构字段级 unique 契约。Customer 继续使用现有业务查重，Lead 不人为把名称设为唯一，后续应在元数据唯一约束能力中一次性覆盖 CRUD + import。
