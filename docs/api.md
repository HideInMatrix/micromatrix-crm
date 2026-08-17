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
- **数据范围**：同一接口不同角色返回的数据集合不同（按角色数据范围自动过滤），联调时注意用对应测试账号

## 测试账号

| 账号 | 密码 | 数据范围 |
| --- | --- | --- |
| admin@demo.com | admin123 | 全部 |
| zhangwei@demo.com | demo123 | 本部门及下级 |
| lina@demo.com | demo123 | 仅本人 |

## 已知限制

- 响应体 Schema 未逐接口建模（VO 为 TS interface，无运行时元数据）：响应结构以 `packages/shared/src` 中的 `*VO` 类型为准；后续如需完整响应 Schema，可将 VO 改为带 `@ApiProperty` 的 class 或引入 nest CLI swagger 插件（需恢复 nest build 链路）
- SSE 接口（`GET /api/notifications/stream?token=`）无法在 Swagger UI 中调试，请用浏览器 EventSource 或 curl 验证

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
customer_collaboration
```

视图服务端保存 `name + searchMode + conditions + fixed/enabled/sort`，与 Cordys UserView 语义一致。列表按 `sort desc` 返回；`fixed` 仅决定是否显示为顶部快捷标签，不改变排序。

Lead / Customer 列表可附加 `viewId`。如果同时传临时 `filters`：

```text
(SavedView 条件，内部按 AND/OR)
AND
(临时 filters，当前高级筛选按 AND)
```

列可见性与列顺序不是 SavedView 服务端数据。Web 按 `userId + module + viewId` 保存浏览器本地偏好，避免修改企业级字段配置。

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
