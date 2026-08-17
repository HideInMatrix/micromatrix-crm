# Wave 1 后续执行计划

> 计划日期：2026-08-17。本文档是 Wave 1 后续开发的执行基准。后续代码修改必须先对应到本文档的阶段、源码依据、验收条件，再实施；若实现过程中发现 CordysCRM 源码事实与计划不一致，应先更新本文档，再修改代码。

## 1. 当前基线

Wave 0 / Wave 1 已经具备以下可复用底座：

- `ScopeResolverService`
- `ResourceAccessService`
- `BusinessChangeLogService`
- `SavedViewsService`
- `ResourcePool / PickRule / RecycleRule / Capacity / OwnerHistory`
- Lead / Customer 多池归属、领取冷却、库容、负责人历史
- Lead / Customer 批量领取 / 分配 / 退池
- Customer Collaboration 后端第一版
- Customer Relation 后端第一版
- Customer Merge 后端第一版
- Web 端多池选择、协作客户 Tab、多池 / 库容设置第一版

当前不能把 Wave 1 标记为完成，原因主要是：回收条件仍未完全切换、协作写权限仍不完整、SavedView 缺少前端管理、客户关系 / 合并缺少前端流程、池隐藏字段仍未生效，并且当前 MCP 环境无法执行 Node/pnpm 编译验证。

## 2. 执行纪律

每个阶段固定执行：

1. 阅读 CordysCRM 对应 Controller / Service / Domain / DTO / Mapper XML。
2. 将新增发现先补充到本文档“源码事实”。
3. 确认 MicroMatrix 数据模型与 API 契约。
4. 先改共享类型 / Prisma / 公共服务，再改业务 Service。
5. 最后接前端。
6. 增加 smoke / integration 断言。
7. 更新 `cordys-parity.md`、当前阶段执行计划和本文件状态。

禁止：

- 在未确认 Cordys 规则前直接凭 UI 猜测业务行为。
- 为 Lead / Customer 各复制一套可以抽象的规则引擎。
- 用前端隐藏代替后端权限控制。
- 把“代码已写”标记为“完成验收”。

## 3. W1.1 回收条件引擎

### 目标

让 `ResourcePoolRecycleRule.conditions` 真正决定 Lead / Customer 是否进入指定池，逐步替换旧的单一 `PoolRule.recycleDays`。

### CordysCRM 源码读取范围

- `clue/*Pool*Recycle*`
- `customer/*Pool*Recycle*`
- 对应 RecycleRule Domain / DTO
- PoolClue / PoolCustomer Service 中自动回收方法
- 对应 Mapper XML 中回收候选数据查询
- 通用 `FilterCondition` / `ConditionFilterUtils` 等条件解析实现

### 已确认源码事实（2026-08-17）

本阶段读取 `CluePoolService.checkRecycled`、`CustomerPoolService.checkRecycled`、`RuleConditionDTO`、`RecycleConditionUtils`、两个 PoolRecycleListener 以及 Cordys Web `addOrEditPoolDrawer.vue` 后，确认：

1. Cordys 当前回收条件不是任意业务字段过滤器，而是专用时间规则。
2. Web 端实际提供两类条件：
   - `storageTime`：入库时间，可通过 `scope` 指定 `Created` / `Picked`，也可同时使用二者。
   - `followUpTime`：最后跟进时间。
3. 条件操作符为：
   - `FIXED`：固定起止时间。
   - `DYNAMICS`：动态时间，包括 `TODAY / YESTERDAY / WEEK / LAST_WEEK / MONTH / LAST_MONTH / LAST_SEVEN / SEVEN / LAST_THIRTY / THIRTY` 以及“前/后 N 天/周/月”。
4. 外层规则通过 `AND / OR` 组合。
5. `storageTime`：
   - scope 仅 `Created` → 创建时间匹配；
   - scope 仅 `Picked` → 领取时间匹配；
   - 两者都选 / 无单一分支 → 创建时间或领取时间任一匹配即可。
6. `followUpTime` 对应 `lastFollowedAt`；Cordys 对空时间返回“匹配”，MicroMatrix 保持该兼容语义。
7. 自动回收只处理：启用 + `auto=true` 的池，并按池创建时间倒序为负责人选择最佳匹配池；一个负责人最终只命中最新的一个池。
8. 线索还必须处于未转客户状态；MicroMatrix 对应继续限定 `status=FOLLOWING`。

因此本阶段不直接复用普通 `filter-builder.ts` 的字段操作符，而是建立专用 `ResourceRecycleConditionEvaluator`。普通筛选器只复用 AND/OR 组合理念，避免错误扩大 Cordys 的回收规则能力。

### MicroMatrix 设计

新增通用：

```text
ResourceRecycleConditionEvaluator
├── matchesLead(...)
├── matchesCustomer(...)
├── FIXED / DYNAMICS
├── storageTime scope
├── followUpTime
├── AND / OR
└── 时间边界计算
```

本阶段采用内存单资源判定，保持与 Cordys `checkRecycled(resource, rule)` 的业务语义一致；候选资源只先按 tenant / owner / 非池状态做数据库过滤。

### 兼容策略

- `ResourcePool.autoRecycle=false`：不参与新规则回收。
- 新池存在有效 `recycleRule.conditions`：以新规则为准。
- 租户尚未配置新规则时：旧 `PoolRule` cron 继续作为兼容 fallback。
- 新规则稳定后再移除旧模型，不在本阶段强删。

### 验收

- AND / OR 均可工作。
- `FIXED / DYNAMICS` 时间条件均可工作。
- `storageTime` 的 Created / Picked scope 与 Cordys 一致。
- `followUpTime` 与空跟进时间兼容语义一致。
- 一条资源只能进入符合其原负责人 Scope 的池。
- 自动回收写 `ResourceOwnerHistory`。
- 自动回收写 `poolId / poolEnteredAt` 并清负责人。
- 新规则存在时不再被旧 `recycleDays` 重复处理。
- smoke 增加至少一条条件命中与一条未命中断言。

状态：`✅ COMPLETE / 2026-08-17 已通过 build + typecheck + lint + rule tests + smoke 验收`

### MicroMatrix 已落地（2026-08-17）

- `ResourcePoolRecycleConditionDto`
- `ResourceRecycleConditionEvaluator`
- `FIXED / DYNAMICS` 时间匹配
- `storageTime` 的 Created / Picked scope
- `followUpTime`
- AND / OR
- 空条件安全保护（不会把空 AND 解释成“全量回收”）
- `resolveAutoRecyclePool()`：只在 `enabled + autoRecycle` 池中按新到旧匹配负责人
- 新规则优先、旧 `PoolRule` 仅在模块没有任何有效新规则时 fallback
- 自动回收继续写负责人历史、`poolId/poolEnteredAt`、系统原因和通知
- SalesSettings 新增具体池的自动回收条件编辑器
- `node:test` 规则单测覆盖命中/未命中、AND/OR、FIXED、Picked scope、空跟进、空条件

未验收项：当前 MCP 进程仍无法解析 `node` / `pnpm`，因此 `test:rules / build / typecheck / lint` 尚未实际执行。

## 4. W1.2 客户协作细粒度权限

### 目标

完成 `READ_ONLY` 与 `COLLABORATION` 的资源访问差异，而不是仅让协作人能看客户详情。

### CordysCRM 源码读取范围

- `CustomerCollaborationService`
- `CustomerService.getWithDataPermissionCheck`
- `CustomerContactService`
- `BaseFollowUpService`
- Customer Collaboration Controller / DTO / Constants
- 客户、联系人、跟进相关权限注解

### 已确认源码事实（2026-08-17）

已读取 `CustomerController`、`CustomerService.getWithDataPermissionCheck`、`CustomerResourceAccessContextProvider`、`CustomerContact`、`CustomerContactService`、`CustomerContactResourceAccessContextProvider`、`FollowUpRecordController`、`FollowUpRecordService`、`BaseFollowUpService` 与 `ResourcePermissionService`，确认：

1. **客户主体**
   - 客户详情读取是特殊路径：Controller 只先校验角色读取权限，Service 再判断普通数据范围；若超出数据范围，只要存在任意 CustomerCollaboration（READ_ONLY 或 COLLABORATION）仍可读取详情。
   - 客户 `update/delete/transfer` 仍走标准 `权限码 + owner 数据范围 (+审批状态)`；协作身份本身不会赋予客户主体修改权限。
2. **跟进记录**
   - `hasCustomerCollaborationPermission(..., isRead=true)`：READ_ONLY 与 COLLABORATION 都允许读。
   - 写入时只有 `COLLABORATION` 返回 true。
   - 已存在跟进记录的更新/删除又有更严格规则：主要只有记录 owner（或管理员）可以更新/删除。
3. **联系人**
   - Cordys `CustomerContact` 有独立 `owner`；MicroMatrix 当前 Contact 缺少这一字段，必须补齐才能复现协作过滤。
   - 新联系人未指定 owner 时默认为当前操作人。
   - 当用户只有客户 `COLLABORATION`、没有客户本身数据范围时，联系人列表只保留 `contact.owner == 当前用户` 的数据。
   - READ_ONLY 不进入 Cordys `collaborationUserIds`（该集合只收 COLLABORATION），因此超出客户数据范围的 READ_ONLY 协作人不应获得协作联系人写能力。
4. **Cordys 实现不一致点**
   - `CustomerContactService.listByCustomerId` 明确实现了“仅协作人也能按 owner 裁剪联系人”的逻辑；但对应 Controller 的 `@CsPermission(resourceId=customerId)` 通用资源权限层本身不识别协作关系，存在注解路径与 Service 业务意图不完全一致的实现痕迹。
   - 联系人 add/update/delete Controller 主要依赖功能权限位，未在这些入口完整表达客户协作数据范围。
   - MicroMatrix **不复制这一潜在越权/不可达矛盾**，而是统一由 `CustomerAccessService` 做资源级裁决。

### MicroMatrix 最终权限矩阵（按源码业务意图收敛）

| 操作 | 普通客户数据范围 | READ_ONLY | COLLABORATION |
| --- | --- | --- | --- |
| 客户详情/360 | 允许 | 允许 | 允许 |
| 修改/删除/分配客户主体 | 允许（另需功能权限） | 禁止 | 禁止 |
| 查看客户跟进 | 允许 | 允许 | 允许 |
| 新增客户跟进 | 允许 | 禁止 | 允许 |
| 修改/删除已有跟进 | 记录 owner / 管理员 | 禁止 | 仅自己创建的记录 |
| 查看联系人 | 允许 | 不因协作额外放行 | 仅自己负责的联系人（若无普通客户数据范围） |
| 新增联系人 | 允许 | 禁止 | 允许，默认自己为联系人负责人 |
| 修改/删除联系人 | 按普通范围 + 功能权限 | 禁止 | 仅自己负责的联系人 |
| 管理协作设置 | 普通客户数据范围 + `customer:team` | 禁止 | 禁止 |
| 编辑客户集团关系 | 普通客户管理权限 | 禁止 | 允许（另需 `customer:update`） |

该矩阵刻意比 Cordys Controller 的部分宽松注解更严格，避免仅凭已知 ID 绕过资源权限。

### 权限矩阵目标

| 场景 | READ_ONLY | COLLABORATION |
| --- | --- | --- |
| 查看客户详情 | 允许 | 允许 |
| 查看联系人 | 允许 | 允许 |
| 查看跟进 | 允许 | 允许 |
| 修改客户主体 | 禁止，除非原数据范围本身允许 | 按 Cordys 源码规则 |
| 新增 / 修改联系人 | 禁止 | 按 Cordys 源码规则允许 |
| 新增跟进 | 禁止 | 允许 |
| 协作设置管理 | 禁止 | 仅客户本身有管理权限的用户可操作 |

最终矩阵以源码核对结果为准。

### MicroMatrix 设计

新增统一客户访问上下文，不把判断散落到 Controller：

```text
CustomerAccessService
├── resolveAccess(user, customerId)
├── owner/dataScope
├── pool access
├── READ_ONLY collaboration
└── COLLABORATION collaboration
```

联系人、跟进、客户 360 使用同一访问结果。

同时扩展 `Contact`：

```text
ownerId
deptId
```

历史联系人迁移时 owner 为空；对普通客户数据范围仍可见，对仅 COLLABORATION 用户不暴露无 owner 的历史联系人。新建联系人默认 owner 为当前用户。

### 验收

- READ_ONLY 用户不能通过直接调用 API 绕过前端写限制。
- COLLABORATION 用户可完成 Cordys 允许的联系人 / 跟进操作。
- 普通无权限用户继续返回 404/403，不泄露客户存在性。
- customer list / detail / related / contact / follow-up 权限语义一致。

状态：`✅ COMPLETE / 2026-08-17 已通过 Prisma generate + build + typecheck + lint + smoke 验收`

### MicroMatrix 已落地（2026-08-17）

- 新增 `CustomerAccessService`，统一计算：
  - 客户正常 data scope
  - 当前公海可见性
  - 公海管理员
  - READ_ONLY / COLLABORATION
  - `canRead / canManageCustomer / canCollaborateWrite`
- Customers detail / 360 / team read 复用统一访问上下文。
- team add/update/remove 与 customer assign 强制走客户主体管理权限，协作身份不能越权。
- `Contact` 新增 `ownerId / deptId`，并增加 `users -> ownedContacts` 关系与迁移。
- 新联系人默认当前用户为负责人；线索转客户时联系人同步继承客户负责人。
- 联系人：
  - READ_ONLY 超出客户数据范围时不额外获得联系人列表；
  - COLLABORATION 超出客户数据范围时只返回本人负责联系人；
  - COLLABORATION 只能创建/修改/删除本人负责联系人；
  - 普通客户数据范围 / 公海访问继续按其原业务权限工作。
- 跟进：
  - customer 跟进读取要求 `menu:customer` + 客户可读；
  - customer 跟进新增要求 `customer:update` + 普通范围/公海写入能力/COLLABORATION；
  - READ_ONLY 不能新增跟进。
- `CustomerVO.collaborationType`：仅当当前访问真正依赖协作关系时返回，普通数据范围不会因同时存在 READ_ONLY 关系被错误降权。
- Customer Detail / Drawer 已根据 `collaborationType` 隐藏只读协作用户的联系人写入、写跟进与团队管理入口。
- smoke 已加入 READ_ONLY → COLLABORATION 全链路断言以及“协作不能修改客户主体”断言。

未验收项：当前 MCP 无 `node/pnpm`，且 Contact Prisma Client 需要重新 generate，因此当前阶段仍不能标记完成验收。

## 5. W1.3 SavedView 前端与列配置

### 目标

让现有 `SavedViewsService` 从“后端可用”升级为用户可操作功能。

### CordysCRM 源码读取范围

- `UserViewService`
- `UserView` / `UserViewCondition`
- Clue / Customer / Pool UserView Controller
- 对应前端视图管理交互（如项目内可定位）

### 已确认源码事实（2026-08-17）

已读取 `UserViewService`、`CrmViewSelect`、`addOrEditViewsDrawer.vue`、`manageViewsDrawer.vue`、客户/线索表格接入方式与 `view` Pinia Store，确认：

1. Cordys 服务端 `UserView` 保存的是：
   - name
   - resourceType
   - fixed
   - enable
   - pos
   - searchMode
   - conditions
2. 自定义视图 UI 支持：新建、编辑、复制、删除、固定/取消固定、启用/停用、拖拽排序。
3. 固定且启用的视图直接显示为顶部标签；所有启用视图同时出现在下拉列表中，并区分系统视图/个人视图。
4. Cordys 保证至少保留一个固定视图，避免顶部无入口。
5. 当前激活视图按资源类型保存在前端 LocalForage；刷新页面后恢复上次选择。
6. `UserView` **不保存列配置**。表格排序也是按 `tableKey + viewId` 存在前端本地存储，而不是写进 UserView。
7. 切换视图后，表格请求传 `viewId`；高级筛选还可以继续作为临时条件叠加。
8. Customer 的“协作客户”等系统视图与个人 SavedView 属于同一选择体验，但系统视图不可删除/停用。
9. Mapper `selectViewList` 按 `pos desc` 返回，`fixed` 不参与排序；新建视图使用更大的 pos，因此默认排在个人视图前部。

### 设计修正

原计划提出“SavedView 增加列配置 JSON”。根据源码事实修正为：

- SavedView 服务端保持纯筛选视图模型，不增加列配置字段。
- 当前激活视图保存为前端本地偏好：`active-view:{module}`。
- 个人列可见性/顺序如果在本阶段实现，保存为前端本地偏好：`view-columns:{module}:{viewId}`。
- 服务端云同步列偏好以后如有需求，应独立建立 `ViewPreference`，不污染 SavedView/UserView 业务模型。
- MicroMatrix 的“默认视图/我的线索/客户公海/协作客户”等系统入口当前由页面系统 Tab 独立承担，因此不强制个人 SavedView 至少固定一个；即使个人视图全部取消固定，仍有稳定的默认入口。这是 UI 架构差异，不改变个人视图本身的 fixed 语义。

### 第一阶段 UI

- Lead 我的线索视图
- Lead 池内视图
- Customer 我的客户视图
- Customer 公海视图
- Customer 协作客户视图

支持：

- 创建当前筛选为视图
- 切换视图
- 编辑名称与筛选条件
- 删除
- 固定 / 取消固定
- 启用 / 停用
- 排序

### 列配置

不修改全局 `FieldDefinition.showInList`，也不修改 SavedView 数据模型。个人视图的列可见性/顺序使用 `view-columns:{module}:{viewId}` 本地偏好；未配置时回退全局 FieldDefinition 列配置。

### 验收

- 刷新页面后视图仍存在。
- 选择视图后自动应用条件。
- 临时 AdvancedFilter 可继续叠加。
- 视图列配置只影响当前用户 / 当前视图。

状态：`✅ COMPLETE / 2026-08-17 已通过 build + typecheck + lint + smoke 验收`

### MicroMatrix 已落地（2026-08-17）

- SavedView 后端继续保持 Cordys UserView 纯筛选模型，没有新增列配置字段。
- `SavedViewsService.list()` 已对齐 Cordys `pos desc`：按 `sort desc` 返回；`fixed` 不参与排序。
- reorder API 按最终显示顺序写入递减 sort，和新建 `maxSort + 1` 语义一致。
- Customer SavedView module 已拆分为 `customer / customer_pool / customer_collaboration`。
- Lead SavedView module 使用 `lead / lead_pool`。
- 新增公共 `FilterConditionEditor.vue`，AdvancedFilter 与 SavedView 编辑共用同一字段/操作符输入逻辑。
- `AdvancedFilter.vue` 改为受控 `v-model`，可与 SavedView 切换正确协同。
- 新增 `apps/web/src/api/saved-views.ts`。
- 新增通用 `SavedViewBar.vue`，支持默认视图、固定标签、启用视图下拉、从当前筛选创建、新建/编辑/复制/删除、固定/启停和排序。
- 当前激活视图按 `userId + module` 保存在浏览器本地；Lead / Customer 刷新后可恢复。
- Lead / Customer 列表和导出均传 `viewId`。
- SavedView 条件组与临时 AdvancedFilter 按 AND 叠加，SavedView 内部继续尊重 AND/OR。
- per-view 列偏好不入库，按 `userId + module + viewId` 保存浏览器本地，支持可见列和列顺序；未配置时回退企业级 FieldDefinition。
- smoke 已加入 SavedView 创建 → `viewId` 查询 → fixed 切换 → 删除的 API 回归，临时测试视图最终删除。

未验收项：当前 MCP 仍无法解析 `node` / `pnpm`，Vue/TypeScript 编译、lint 与 smoke 尚未实际执行。

## 6. W1.4 客户关系前端

### 目标

把已完成的 GROUP / SUBSIDIARY 后端能力接入客户详情。

### 已确认源码事实（2026-08-17）

已读取 Cordys `customerRelation.vue`、`CustomerRelationService`、`CustomerController.option` 与 `ExtCustomerMapper.getCustomerOptions`，确认：

1. 客户关系是客户详情中的独立区域，而不是单独管理页面。
2. UI 以“整组编辑 → 一次保存”为主：
   - 获取关系列表；
   - 本地添加/删除/修改多行；
   - 点击保存后调用批量 `saveCustomerRelation` 替换当前客户关系；
   - 支持“重置”恢复服务器原值。
3. 一条客户最多只能存在一个 `GROUP`；已有 GROUP 时其它行的类型下拉只允许 `SUBSIDIARY`。
4. 新增行默认 `SUBSIDIARY`。
5. 同一关系表单中禁止：
   - 选择当前客户自身；
   - 重复选择同一个关联客户。
6. Cordys Web 最多允许 11 行关系。
7. READ_ONLY 客户协作下关系组件整体只读。
   - `COLLABORATION` 不会被前端置为只读；Cordys `save/{customerId}` 只校验客户 UPDATE 功能权限，因此关系子域是客户主体写权限之外的协作例外。
8. Cordys 客户选项接口 `/customer/option` 仅要求客户读取功能权限，Mapper 直接按 `organization_id` 返回 `id/name`，**不附加 owner/data-scope**。MicroMatrix 为对齐关系选择体验，提供同样的 tenant 级轻量 options 接口，但仅返回 `id/name`，不暴露客户其它字段。
9. Cordys Service 仍负责“一个子公司仅一个集团”等强校验。MicroMatrix 已额外实现循环关系检测，继续保留。

### API 设计修正

现有单条关系 CRUD 保留兼容，同时新增批量替换接口以对齐 Cordys 的编辑语义：

```text
GET /customers/options?keyword=
PUT /customers/:id/relations
```

`PUT relations` 接收当前客户的完整关系数组，在一个事务中验证并替换；前端不需要按行计算 create/update/delete 差异。

### UI

客户详情新增“集团关系”区域：

- 显示上级集团
- 显示子公司
- 添加关系
- 修改关系
- 删除关系
- 点击关系跳转对应客户详情
- 重置未保存修改
- 一次保存完整关系集合

### 验收

- 不能把自己关联为自己。
- 一个子公司不能出现两个上级集团。
- 循环关系在后端继续强校验。
- UI 正确展示后端错误信息。

状态：`✅ COMPLETE / 2026-08-17 已通过 build + typecheck + lint + smoke 验收`

### MicroMatrix 已落地（2026-08-17）

- 新增 `GET /customers/options?keyword=`：按 Cordys `/customer/option` 语义返回租户内轻量 `id/name`，不暴露客户详情字段。
- 保留现有关系单条 CRUD，同时新增 `PUT /customers/:id/relations` 整组替换接口。
- 整组替换服务端强校验：
  - 最多 11 条；
  - 当前客户不能关联自己；
  - 同一目标客户不能重复；
  - 最多一个 GROUP；
  - 一个子公司只能有一个集团；
  - 保留 MicroMatrix 额外的循环关系检测。
- 替换时忽略当前客户旧关系后做完整验证，再在事务中删除旧关系并创建新关系。
- READ_ONLY 只能读取关系；COLLABORATION 在具备 `customer:update` 时可通过整组保存编辑关系，与 Cordys 主前端路径一致。
- 新增可复用 `CustomerRelationsPanel.vue`：
  - GROUP/SUBSIDIARY 编辑；
  - 新增默认 SUBSIDIARY；
  - 已有 GROUP 时其它行不再允许 GROUP；
  - 当前客户禁选、已选客户禁重复；
  - remote customer options；
  - 最多 11 行；
  - 重置 / 整组保存；
  - 打开关联客户详情。
- 完整 CustomerDetailView 与 CustomerDetailDrawer 共用同一个关系组件。
- smoke 已覆盖 READ_ONLY 禁止、COLLABORATION 可保存、options 搜索、GROUP/SUBSIDIARY 读取。

未验收项：Node/pnpm 仍不可见，因此 Vue/TS 编译和 smoke 未实际执行。

## 7. W1.5 客户合并前端

### 目标

为后端 Customer Merge 提供安全的操作向导，避免“一键误删副客户”。

### 已确认源码事实（2026-08-17）

已读取 Cordys `mergeAccountModal.vue`、`CustomerController.merge/page`、`CustomerService.merge` 与 `ExtCustomerContactMapper.batchMerge`，确认：

1. Cordys 使用独立权限 `CUSTOMER_MANAGEMENT:MERGE`，不等同于普通客户 UPDATE。
2. 合并弹窗支持两种主客户来源：
   - **已选客户**：主客户从当前勾选行中选择；最终负责人只能从已选客户已有负责人中选择。
   - **其它客户**：可搜索当前用户可见客户作为主客户；最终负责人保持该主客户原负责人。
3. 合并是不可逆操作，Cordys 明确二次提示“合并后数据不可回退”。
4. 仅保留主客户基本信息；被合并客户基本信息删除。
5. Cordys 明确迁移：联系人、跟进计划、跟进记录、商机、协作成员；现有 MicroMatrix 还需同步自身直接 FK：Quote / Contract / Attachment。
6. 被合并客户负责人会转为主客户协作人，已有协作成员也合并去重。
7. Cordys 联系人冲突策略取决于联系人字段是否配置 unique：
   - 主客户已有联系人姓名属于 unique 字段时，同名源联系人不迁移；
   - 主客户已有联系人电话属于 unique 字段时，同电话源联系人不迁移。
8. Cordys `/merge/page` 实质是“其它主客户候选分页”，并不是影响范围 preview；弹窗只显示静态合并规则说明。

### MicroMatrix 安全增强

MicroMatrix 当前 Contact 元数据没有 Cordys 的 unique 字段开关，因此不静默猜测唯一策略。新增 merge preview，并要求明确选择联系人冲突策略：

```text
KEEP_ALL         默认，保留并迁移全部联系人
SKIP_DUPLICATES  与主客户已有联系人姓名或电话冲突的源联系人不迁移，随源客户删除
```

preview 返回：

- 主客户 / 被合并客户摘要
- contacts / opportunities / quotes / contracts / followUps / attachments 数量
- collaboration 数量
- 将删除的客户关系数量
- 联系人潜在冲突分组与 `contactsWillSkip`

任何跳过联系人行为必须在最终确认页明确展示，禁止静默删除。

### 权限

新增 `customer:merge` 独立权限码。销售主管默认拥有；普通销售专员默认不拥有。管理员 `*` 自动拥有。

### UI 流程

```text
选择 2+ 客户
  -> 选择主客户
  -> 选择最终负责人
  -> 展示将迁移的关联数据摘要
  -> 二次确认
  -> 执行合并
  -> 跳转主客户详情
```

### 后端补充

新增 merge preview，只返回统计与冲突，不修改数据；正式 merge 和 preview 共用客户范围、负责人和冲突计算逻辑。

重点检查：

- 联系人同名 / 同电话冲突
- 协作人去重
- 客户关系清理
- Quote / Contract 外键
- FollowUp targetId
- Attachment targetId

### 验收

- 合并前可明确看到影响范围。
- 副客户删除后无悬空外键。
- 主客户详情能看到迁移后的联系人、商机、合同、报价、跟进。
- 操作日志能追踪合并来源。
- `SKIP_DUPLICATES` 时 preview 的跳过数量与实际删除数量一致。

状态：`✅ COMPLETE / 2026-08-17 已通过 build + typecheck + lint + smoke 验收`

### MicroMatrix 已落地（2026-08-17）

- 新增独立 `customer:merge` 权限；管理员 `*` 自动拥有，销售主管 seed 默认拥有，普通销售专员不拥有。
- merge controller 已从 `customer:update` 切换到 `customer:merge`。
- `CustomerMergeDto` 新增联系人冲突策略：`KEEP_ALL / SKIP_DUPLICATES`，默认 KEEP_ALL。
- 新增 `POST /customers/merge/preview`，与正式 merge 共用 `prepareMergeContext()`。
- 共用上下文统一校验：
  - 至少一个被合并客户；
  - 主/副客户均在当前用户数据范围；
  - 主客户来自已选集合时，最终负责人必须来自已选客户已有负责人；
  - 主客户来自其它客户时，最终负责人必须保持主客户原负责人；
  - 客户库容；
  - 联系人姓名/电话潜在冲突。
- preview 返回主/副客户与最终负责人，以及 contacts/opportunities/quotes/contracts/followUps/attachments/collaborations/relationsToRemove 影响数量。
- 联系人冲突 preview 返回 `matchedBy=name|phone` 与匹配主联系人 ID。
- `KEEP_ALL`：所有源联系人迁移。
- `SKIP_DUPLICATES`：冲突源联系人不迁入；若该联系人存在附件，附件先转挂到匹配主联系人，再移除冲突源联系人，避免悬空附件。
- 正式合并继续迁移 Opportunity / Quote / Contract / customer FollowUp / customer Attachment / Collaboration，并清理被合并客户关系。
- 新增 `CustomerMergeDialog.vue` 两步安全向导：
  - 列表选择 2+ 客户；
  - 已选客户 / 其它可见客户作为主客户；
  - 按 Cordys 规则选择/锁定最终负责人；
  - 选择联系人冲突策略；
  - 生成真实 impact preview；
  - 显示冲突联系人与处理方式；
  - 不可逆二次确认；
  - 合并成功跳主客户详情。
- CustomersView 仅在“我的客户”且拥有 `customer:merge` 时显示 selection 与合并按钮。
- smoke 已加入同名同电话联系人冲突：preview `contactsWillSkip=1`，执行后副客户 404、主客户仅保留一份冲突联系人。

未验收项：MCP 无 Node/pnpm，因此 TS/Vue 编译与 smoke 尚未实际执行；现有开发库如已 seed，需重新执行 seed 或在角色管理中给需要的角色授予 `customer:merge`。

## 8. W1.6 池隐藏字段与负责人历史 UI

### 目标

完成目前 `hiddenFieldIds` 和 `ResourceOwnerHistory` 的前端消费。

### 已确认源码事实（2026-08-17）

已读取 Cordys `CluePoolService / CustomerPoolService`、Pool option 返回结构、`addOrEditPoolDrawer.vue`、`CustomerOwnerHistoryService / ClueOwnerHistoryService`、Owner Domain 与 Response DTO，确认：

1. `hiddenFieldIds` 在 Cordys 中明确属于“**隐藏的表格字段**”。
   - Pool 配置保存隐藏字段 ID；
   - Pool option 将模块字段映射为 `fieldConfigs[{ fieldId, fieldName, enable, editable }]`；
   - `enable=false` 用于池列表列显示控制；
   - 当前源码没有证据表明池隐藏字段会从 API 行对象中删除或作为数据脱敏处理。
2. 客户/线索名称字段不可在池配置中隐藏（Cordys `editable=false`）；其它可展示字段可以控制显示。
3. 因此 MicroMatrix 本阶段按**视图级列隐藏**实现，不把 `hiddenFieldIds` 升格为安全脱敏机制；字段脱敏仍是独立 Wave 5 能力。
4. Owner History 两模块结构一致，按 `endTime desc` 返回：
   - 原负责人 ID / 名称；
   - 原负责人部门 ID / 名称；
   - `collectionTime`（该负责人开始持有/领取时间）；
   - `endTime`（负责人关系结束时间）；
   - 操作人 ID / 名称；
   - 可选回收/退池原因 ID / 名称。
5. Cordys 仅在配置开启“退池原因”时返回 reason；`system` 自动回收原因不会作为普通退池原因展示。
6. Owner History 在以下路径写入：负责人修改、批量转移、主动退池、自动回收、客户合并导致主客户负责人变化。
7. 历史列表只需要客户/线索读取或对应池读取权限，不要求修改权限。

### MicroMatrix 设计修正

- `ResourcePool.hiddenFieldIds` 继续保存字段 key/id，本阶段只影响 Web pool/sea table columns。
- Pool 设置页必须提供模块字段勾选，名称字段强制始终显示。
- `SavedView` 本地列偏好与 pool hidden fields 组合顺序：

```text
企业默认列 / SavedView 本地列偏好
  -> 再剔除当前 pool.hiddenFieldIds
  -> 保证 name 始终存在
```

- `ResourceOwnerHistory` API 统一转换为前端 VO；`reasonId=system` 不展示普通原因文本。
- 客户详情/快速 Drawer 增加负责人历史 Tab；线索目前没有独立详情页，因此在线索列表提供负责人历史 Drawer 入口。

### 实现

- Pool 配置页可以选择池内隐藏字段。
- Lead / Customer 池列表根据当前 pool 的 `hiddenFieldIds` 隐藏对应列。
- 客户 / 线索详情增加负责人历史时间线。

### 安全要求

隐藏字段不仅前端不展示；若 Cordys 源码确认属于数据脱敏边界，则 API 也必须剔除对应值。若 Cordys 仅属于列展示设置，则只做视图级隐藏。实施前必须先核对源码。

状态：`✅ COMPLETE / 2026-08-17 已通过 build + typecheck + lint + smoke 验收`

### MicroMatrix 已落地（2026-08-17）

- Pool 设置页已增加 `hiddenFieldIds` 字段选择器，并按当前 lead/customer 模块读取元数据字段。
- 名称字段在 UI 中不可隐藏；后端 `ResourcePoolsService` 同时做强制净化：剔除 name、未知字段、全局 hidden 字段，并去重。
- Lead 线索池 / Customer 公海列显示顺序为：企业默认列或 SavedView 本地列偏好 → 剔除当前 Pool hiddenFieldIds → 强制保留 name。
- `hiddenFieldIds` 仅控制池列表列显示，不删除 API 行对象字段，也不承担字段脱敏职责。
- 新增统一 `OwnerHistoryVO`，`ResourcePoolsService.ownerHistory()` 转成稳定 ISO 时间字符串，不再直接透传 Prisma Date。
- Owner History 返回原负责人、负责人部门、操作人、poolId、可选原因、开始持有时间和结束时间。
- `reasonId=system` 不作为普通退池原因暴露。
- Customer owner history 已复用 `CustomerAccessService.assertRead()`，有客户读取权限的协作用户可查看历史。
- 新增 `OwnerHistoryTimeline.vue`；CustomerDetailView / CustomerDetailDrawer 已增加负责人历史 Tab。
- Lead 因暂时没有独立详情页，在池内操作和“更多”菜单增加负责人历史入口，以 Drawer 复用同一组件。
- smoke 已增加池隐藏字段净化、Lead owner history 完整字段、Customer 负责人变更历史断言。

未验收项：MCP 当前仍无法解析 Node/pnpm，因此前端编译、Prisma generate、typecheck/lint/smoke 尚未实际执行。

## 9. W1.7 回归、文档与验收

### 静态审查新增源码事实（2026-08-17）

- Cordys `UserExtendService.hasDuplicateScopeObj()` 不比较原始 Scope ID，而是通过 `getScopeOwnerIds()` 将 USER / ROLE / DEPARTMENT（部门含全部下级）展开成实际用户 ID 集合，再判断两个范围是否有用户交集。
- 因此 MicroMatrix `ResourceCapacity` 的范围唯一性不能只检查相同 token；例如 `dept:销售部` 与 `user:李娜` 如果李娜属于销售部，也必须判定为冲突。
- 本轮 W1.7 将 `ScopeResolverService` 增加“Scope → 实际用户 ID 集合”能力，并让 Capacity create/update 使用实际用户交集校验；当前 MicroMatrix Scope 先覆盖 `* / user:* / dept:* / 裸 user/dept id`，角色 Scope 尚未进入 ResourcePool/Capacity 契约，后续如引入 role token 必须在同一解析器扩展。

### 测试补充

- 条件回收命中 / 未命中
- 多池 Scope 隔离
- READ_ONLY / COLLABORATION API 权限
- SavedView AND / OR / 列配置
- 客户集团关系唯一上级与循环校验
- Customer Merge preview + merge
- 批量领取局部失败
- 库容过滤

### 文档同步

每完成一个子阶段同步：

- `docs/cordys-wave1-execution-plan.md`
- `docs/cordys-wave1-baseline.md`
- `docs/cordys-parity.md`
- 当前阶段执行计划
- API 发生稳定变化时更新 `docs/api.md`

### 本执行计划收口门槛

只有以下全部满足，才允许把本文 W1.1 - W1.7 标记为完成：

```text
W1.1 - W1.6 功能完成
+ Prisma generate
+ pnpm build
+ pnpm typecheck
+ pnpm lint
+ smoke / integration 全绿
+ 文档状态同步
```

验收命令必须使用项目真实 Node/pnpm 环境执行；MCP 默认 PATH 不作为工具链可用性的判断依据。

> 注意：本文只负责本轮明确规划的 W1.1 - W1.7 收口包。批量字段修改/删除、完整导入导出、联系人完整能力、转客户/联系人/商机关系补齐等剩余项由后续阶段执行计划继续推进；本文完成不代表整个 Cordys 对齐工作完成。

状态：`✅ COMPLETE / 2026-08-17 W1.1 - W1.7 收口包已验收`

### 2026-08-17 最终验收结果

- W1.1 - W1.6 已按本文档顺序完成计划内代码落地和阶段文档同步。
- `git diff --check` 已用于阶段性静态检查；本轮后续又对 Docker 配置做了数据库一致性修复并清理尾随空格。
- Wave 新增文件单独扫描未发现尾随空格。
- 新增 Prisma 模型与迁移已做静态对应检查：ResourcePool 系列、SavedView、CustomerRelation、Contact owner/dept 均有 migration 承载。
- Customer 路由顺序已核对；`merge / merge/preview / options / check-duplicate` 等固定路由不会被 `:id` 路由吞掉。
- W1.7 静态审查期间额外修复：
  - 普通公海“可读”不再自动等于联系人/跟进“可写”；详情接口直接返回 `canManageCustomer / canCollaborateWrite`，Web 与后端共享同一资源访问事实。
  - CustomerRelation 整组替换增加“现有关系 + 本次待创建关系”的完整有向图校验，防止批内关系与既有关系组合成环。
  - Pool `name` 强制显示只限定在线索池/客户公海，不限制普通个人 SavedView 的列偏好。
  - CustomerMergeDialog 模板去除 TypeScript 箭头参数注解，降低 Vue 模板编译风险。
  - Capacity Scope 重复校验从“原始 token 相同”升级为 Cordys `hasDuplicateScopeObj` 同类语义：先展开成实际用户 ID，再判断成员交集；`dept:*` 与其中具体 `user:*` 也会冲突。
- `scripts/smoke.mjs` 当前有 **71 条实际断言**（源码中 `check(` 共 72 次，其中 1 次为 `check()` 函数定义），覆盖：
  - 原有登录 / 数据范围 / 元数据 / L2C / 交易链 / 审批 / 标讯 / 报表；
  - 多池 Scope 隔离；
  - 批量领取局部失败；
  - ResourcePool FIXED 自动回收 `run-now` + owner history；
  - READ_ONLY / COLLABORATION；
  - SavedView；
  - 客户关系；
  - Customer Merge preview + SKIP_DUPLICATES；
  - 客户库容过滤与 Scope 实际成员交集防重；
  - 池隐藏字段；
  - Lead / Customer 负责人历史。
- `resource-recycle-condition-evaluator.test.ts` 另有 7 条纯规则单测。
- 实际执行结果：
  - `pnpm build`：通过；
  - `pnpm typecheck`：通过；
  - `pnpm lint`：通过；
  - `pnpm --filter @micromatrix/api test:rules`：7/7 通过；
  - `pnpm smoke`：71/71 通过；
  - 当前 PostgreSQL：14 个 migration 已应用，schema up to date。
- 最终 smoke 收口期间额外修复：
  - ResourceCapacity `filters` 改为嵌套 DTO，避免全局 ValidationPipe `whitelist` 把 `key/op/value` 清空；
  - `isEmpty/notEmpty` 对 Prisma 7 的 NOT NULL 列不再生成非法 `column: null` 条件；
  - fresh seed 增加“8 万以上合同审批”演示流，保证审批链 smoke 可重复；
  - fresh seed 启用内置 `demo` 标讯源和演示关键词，仅用于本地 DemoProvider，不引入商业标讯 API；
  - ESLint 明确排除只读上游 `CordysCRM/`，并清理 MicroMatrix 自身 lint 问题。

### 本机验证口径

2026-08-17 本机真实执行 `pnpm dev` 已确认：pnpm/Node 在用户终端环境中可正常使用，Web 与 Mobile 均能启动。后续又通过运行中的开发进程定位到实际工具链：Node 24.5.0 + pnpm 10.30.3；MCP 只需显式补充 `~/.nvmd/versions/24.5.0/bin` 与 pnpm 路径即可执行真实项目命令。

MCP 默认 PATH 仍是独立受限环境，因此下面结果只代表未补 PATH 时的 MCP 沙箱，不能用于判断用户本机是否安装 Node/pnpm：

MCP 进程中：

```text
command -v node  -> 空
command -v pnpm  -> 空
```

登录 500 排查期间已经重新 generate Prisma Client，并确认真正运行时根因是数据库配置漂移：`apps/api/.env` 原先指向 `crm:crm/micromatrix_crm`，当前 Docker PostgreSQL 实际为 `postgres:postgres/default`。现已对齐配置并将全部 14 个 migration 应用到当前数据库。

启动修复已落地：

- `apps/api` 的 `dev / build / typecheck / test:rules` 现在都会先执行 `prisma generate`；
- 根目录新增 `pnpm prisma:generate / pnpm db:migrate / pnpm db:migrate:dev`；
- 修复 Prisma JSON 写入的 TS2352 强转问题；
- 删除未使用的 `ensureAccessible` 私有方法；
- PostgreSQL 当前 schema 已执行 `prisma migrate status` 确认为 up to date；
- API `typecheck`、7 条回收规则单测、`build` 已真实执行通过；
- 管理员登录真实服务链已验证：正确密码签发 access/refresh token，错误密码返回 401；
- README 增加 Prisma Client 过期的排查与恢复流程。

本收口包的标准验证命令为：

```bash
pnpm prisma:generate
pnpm db:migrate:dev
pnpm --filter @micromatrix/api test:rules
pnpm build
pnpm typecheck
pnpm lint
pnpm smoke
```

2026-08-17 上述门槛已实际通过，因此本文 W1.1 - W1.7 允许标记完成。剩余工作由 `cordys-wave1-remainder-plan.md` 继续推进。

## 10. 本轮执行顺序

严格按以下顺序继续：

1. W1.1 回收条件引擎
2. W1.2 协作细粒度权限
3. W1.3 SavedView 前端与列配置
4. W1.4 客户关系前端
5. W1.5 客户合并前端
6. W1.6 池隐藏字段与负责人历史 UI
7. W1.7 回归、文档与验收

除非源码事实证明存在依赖反转，否则不跳阶段。
