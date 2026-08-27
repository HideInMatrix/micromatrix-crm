# W3.4.2 线索模块设置补漏源码与实施审计

> 执行单元：W3.4.2 / task 3.7
>
> 日期：2026-08-27
>
> 原因：3.6 最终验收关闭后复核发现“模块设置 → 线索池设置 / 线索库容设置 / 移入线索池原因设置”仍是不可点击占位；W3.4.3 暂停，先补齐本漏项。
>
> 状态：✅ 已实施并通过专项、Browser 与全量回归；W3.4.2 已重新关闭，执行指针恢复到 W3.4.3 task 4.1。

## 1. Cordys 页面入口事实

Cordys 入口不是独立“销售设置”页面，而是：

```text
系统设置
  -> 模块设置
     -> 线索
        -> 线索表单设置
        -> 线索池设置
        -> 线索库容设置
        -> 更多
           -> 移入线索池原因设置
```

源码：

- `frontend/packages/web/src/views/system/module/components/configCard.vue`
- 线索卡片 `groupList` 直接注册 `cluePool`、`capacitySet`。
- `handleSelect()` 在当前页面内打开 `CluePoolDrawer` / `CapacitySetDrawer`，不是跳到通用销售设置页。
- “更多 → 移入线索池原因设置”使用 `MoveLeadReasonDrawer`，原因类型固定为 `CLUE_POOL_RS`。

因此 MicroMatrix 当前 `NavigationModulesView.vue` 中三个无 `path` 的禁用动作不符合 Cordys 页面行为。

## 2. 线索池设置 Drawer

Cordys 页面：

- `frontend/packages/web/src/views/system/module/components/clueManagement/cluePoolDrawer.vue`
- `frontend/packages/web/src/views/system/module/components/addOrEditPoolDrawer.vue`

### 2.1 列表

全屏 Drawer，表格列至少包含：

- 名称
- 状态（可直接启用/禁用）
- 管理员
- 成员
- 自动回收
- 创建时间 / 创建人
- 更新时间 / 更新人
- 操作：编辑、删除

顶部提供“添加线索池”。新增/编辑继续打开 900px Drawer。

### 2.2 新增/编辑内容

`AddOrEditPoolDrawer` 的线索模式包含：

1. 基础信息：名称、管理员、成员。
2. 领取规则：
   - 每日领取是否限制 + 数量；
   - 前负责人是否限制 + 冷却天数；
   - 新数据是否限制 + 冷却天数。
3. 回收规则：是否自动回收；开启后支持 AND/OR 与 `storageTime/followUpTime` 动态/固定时间条件。
4. 列设置：基于真实线索表单字段，`name` 不允许隐藏；保存时把未勾选字段转为 `hiddenFieldIds`。
5. 新增支持“保存并继续”；编辑会提示修改规则会影响当前池。

### 2.3 删除

删除前必须先调用 `/lead-pool/no-pick/{id}`：

- 池中仍有未领取线索：不允许直接删除，提示用户前往线索池处理数据。
- 池为空：二次确认后调用 `/lead-pool/delete/{id}`。

MicroMatrix 当前后端已经存在 `no-pick`，但旧 `SalesSettingsView` 删除按钮没有先执行该检查，需要修正。

## 3. 线索池后端事实

Cordys：

- Controller：`CluePoolController.java`
- Service：`CluePoolService.java`
- 基路径：`/lead-pool`

| 方法 | 路径 | 权限/边界 | 行为 |
| --- | --- | --- | --- |
| POST | `/page` | `MODULE_SETTING:UPDATE` | 管理设置分页 |
| POST | `/add` | `MODULE_SETTING:UPDATE` | 同事务创建 Pool + PickRule + RecycleRule + HiddenFields |
| POST | `/update` | `MODULE_SETTING:UPDATE` | 同事务更新上述数据 |
| POST | `/quick-update` | Pool 管理员 | 业务池页面快捷设置 |
| GET | `/no-pick/{id}` | `MODULE_SETTING:UPDATE` | 删除前检查池内数据 |
| GET | `/delete/{id}` | `MODULE_SETTING:UPDATE` | 删除 Pool 及规则/隐藏字段 |
| GET | `/switch/{id}` | `MODULE_SETTING:UPDATE` | 启用/禁用 |

MicroMatrix 当前 `/lead-pool/*` API、`CluePool/CluePoolPickRule/CluePoolRecycleRule/CluePoolHiddenField` 直接模型已经存在，本轮不新建第二套 Pool 数据模型。

## 4. 线索库容设置

Cordys 页面：`capacitySetDrawer.vue`。

- 线索模式 Drawer 宽 800px。
- 使用可逐行新增/编辑/删除的 Batch Form，不使用“列表 + 另一个新增弹窗”。
- 每行字段：
  - 部门或成员；
  - 库容上限允许为空；结合 Cordys `PoolClueService.validateCapacity()` 可确认只有 `null` 表示不限制，`0` 是真实的零库容；
- Scope 选择支持组织与角色语义，且不同库容规则不允许覆盖到同一实际对象。
- 客户库容才有“不计入条件”；线索库容没有该过滤条件，不能把客户专属能力复制过来。

后端：

- Controller：`ClueCapacityController.java`
- Service：`ClueCapacityService.java`
- `/lead-capacity/get|add|update|delete/{id}`
- 组织隔离；新增/修改时检查 Scope 重复；按创建时间升序返回。

MicroMatrix 已有 `ClueCapacity` 和 `/lead-capacity/*`，本轮主要完成 Cordys 模块设置入口/UI，并复核 `null/0`、Scope 重复与列表顺序。

源码继续确认 `UserExtendService.getScopeOwnerIds()` 会把用户、部门（含下级部门）和角色都展开为实际用户；`getUserScopeIds()` 也会把用户所属角色加入匹配 Token。MicroMatrix 原 Pool Scope helper 只识别用户/部门，因此本轮同时补齐角色 Scope，不允许出现“页面可选角色、后端实际不命中”的假对齐。

## 5. 移入线索池原因设置

Cordys 页面：

- `clueManagement/moveReasonDrawer.vue`
- 公共 `crm-reason-drawer/index.vue`
- 原因类型固定：`CLUE_POOL_RS`

交互事实：

1. Drawer 标题为“移入线索池原因设置”。
2. 原因最多 50 条。
3. 可新增、改名、删除、拖拽排序。
4. 原因存在后才能启用全局开关。
5. 开启状态下最后一条原因不能删除。
6. 开关、原因数据均按组织隔离。
7. `get config` 会额外追加 `id=system` 的“系统自动回收”，该项不是用户可编辑字典行。

### 5.1 Cordys API

Controller：`DictController.java`，基路径 `/dict`。

| 方法 | 路径 | 线索原因用途 |
| --- | --- | --- |
| GET | `/get/CLUE_POOL_RS` | 原因列表 |
| POST | `/add` | 新增原因 |
| POST | `/update` | 修改原因 |
| GET | `/delete/{id}` | 删除原因 |
| POST | `/switch` | 启用/关闭原因必填配置 |
| POST | `/sort` | 拖拽排序 |
| GET | `/config/CLUE_POOL_RS` | 原因列表 + `system` + enable |

### 5.2 Cordys 数据模型

DDL `V1.1.1_2__ga_ddl.sql`：

- `sys_dict`
  - `id/name/module/type/pos/organization_id/create_time/update_time/create_user/update_user`
  - 原因使用 `module=CLUE_POOL_RS`、`type=TEXT`。
- `sys_dict_config`
  - 联合主键 `(module, organization_id)`；
  - `enabled` 控制是否要求选择原因。
- `clue.reason_id` 保存本次退池原因 ID。

MicroMatrix 当前已有 `Clue.reasonId` 和 Owner History `reasonId`，但没有 `sys_dict/sys_dict_config` 直接模型，也没有 `/dict/*` 领域 API；这是本轮真正的数据模型缺口。

## 6. 业务消费规则

Cordys `ClueService` 在移入线索池时读取 `CLUE_POOL_RS` 配置：

- 原因配置开启时，人工退池必须提供合法原因；
- 原因配置关闭时，可不传原因；
- 自动回收使用系统原因，不写用户字典 ID；
- Owner History 与 Clue 主记录保存 `reasonId`；
- 展示历史时根据 `sys_dict` 解析原因名称，`system` 显示系统自动回收。

因此本轮不能只做一个“设置原因”的孤立 Drawer；还必须把 `moveToPool/batchMoveToPool` 的后端校验和 Owner History `reasonName` 一起接上。

## 7. 当前 MicroMatrix 差异

| 项目 | 当前状态 | 本轮动作 |
| --- | --- | --- |
| 模块设置 → 线索池设置 | 禁用占位 | 改为真实 Cordys Drawer |
| 模块设置 → 线索库容设置 | 禁用占位 | 改为真实 Cordys Drawer |
| 模块设置 → 移池原因 | 禁用占位 | 新建原因 Drawer + API/直接模型 |
| `/lead-pool/*` | 已有 | 复用并补删除前 `no-pick` UI 语义 |
| `/lead-capacity/*` | 已有 | 复用并补 Cordys Batch Form 交互 |
| `/dict/*` | 缺失 | 建立 `sys_dict/sys_dict_config` 直接模型和 API |
| 退池原因必填 | 缺失 | Service 按配置后端强校验 |
| Owner History 原因名 | 始终 null | 接 `sys_dict` 名称解析 |
| 旧 `SalesSettingsView` | 混合多模块管理 | 线索 Pool/Capacity 不再以此作为正式入口；不越界重做客户域 |

## 8. 实施拆分

### 3.7.1 数据与 API

- 新增 Cordys `sys_dict`、`sys_dict_config` Prisma 直接模型与 migration。
- 新增 `/dict` Controller/Service，仅先开放 Cordys 已确认字典模块边界；本任务集成 `CLUE_POOL_RS`。
- 补原因唯一性、排序、最后一条删除保护、配置开关、组织隔离与操作日志。
- `moveToPool/batchMoveToPool` 在原因开关开启时校验合法 `reasonId`。
- Owner History 返回 `reasonName`，自动回收返回“系统自动回收”。

### 3.7.2 模块设置 UI

- 在 `NavigationModulesView` 的线索卡片内直接打开三个 Drawer，不新增跳转到 `/system/sales-settings` 的正式入口。
- 新建 `LeadPoolSettingsDrawer`：表格、添加、编辑、启停、删除前 no-pick。
- 抽取/复用当前 Pool 表单逻辑，避免与业务池 quick setting 产生第三套规则实现。
- 新建 `LeadCapacitySettingsDrawer`：逐行新增/编辑/删除。
- 新建 `LeadPoolReasonSettingsDrawer`：开关、最多 50、增删改、拖拽排序、最后一条保护。

### 3.7.3 自动化验收

- API Smoke：Pool 创建→编辑→启停→no-pick 拒删→清空→删除；Capacity 新增→重复 Scope 拒绝→修改→删除；Reason 新增→排序→开关→人工退池原因必填→Owner History 名称→删除保护。
- Browser Smoke：从 `/system/modules` 的线索卡片真实点击三个入口并完成关键操作，不直接访问隐藏 URL。
- 回归 W3.4.2：`smoke:w342-clue-domain/api/transition/pool/page-browser`、根 `pnpm smoke`、rules、typecheck、lint、build、Prisma validate/generate、`git diff --check`。

## 9. 关闭标准

只有以下全部成立，W3.4.2 才重新视为真正关闭：

- 模块设置三个入口均可用且与 Cordys Drawer 行为一致；
- Pool/Capacity 创建、编辑、启停/删除可从模块设置完成；
- 原因直接模型/API/UI/业务消费完整闭环；
- 删除有数据 Pool 不会误删；
- Browser 从真实模块设置入口走通；
- 专项与全量回归全绿；
- 文档、DB-022 与执行指针回写后本地 Git 提交，工作区干净。

## 10. 实施结果与最终验收

### 10.1 数据、API 与业务闭环

- 新增 Cordys 直接模型 `SysDict/SysDictConfig`，分别映射 `sys_dict/sys_dict_config`；migration 为 `20260827173000_w342_clue_module_settings`，应用后本地 migration 总数为 **35**。
- 新增 `DictionariesModule` 与 `/dict/get|add|update|delete|switch|sort|config`，`CLUE_POOL_RS` 按组织隔离并保持 `system` 为只读系统项。
- 人工单条/批量退池在配置开启时必须提供当前组织、当前模块的有效原因；配置关闭时允许不传。非法或跨租户 `reasonId` 不能绕过后端校验。
- Owner History 按 `sys_dict` 解析原因名；原因配置关闭时 `reasonId/reasonName` 一并隐藏。自动回收的 `system` 只保留在当前 Clue，不伪造成用户退池原因历史。
- Pool Scope helper 补齐角色 Token 与角色成员展开；Pool 成员/管理员和 Capacity 均可使用用户、部门、角色 Scope，重复 Capacity 按最终实际成员集合判断，而不是只比较原始 Token。

### 10.2 模块设置页面闭环

- `NavigationModulesView` 的线索卡片三个占位动作已改为真实 Drawer：`线索池设置`、`线索库容设置`、`更多 → 移入线索池原因设置`，不再要求进入旧 `/system/sales-settings`。
- `LeadPoolSettingsDrawer` 完成列表、添加、编辑、启停、审计列和删除；删除前先执行 `no-pick`，后端仍保留池内数据禁止删除的第二道边界。
- `LeadPoolConfigDrawer` 完成管理员/成员、领取规则、自动回收、列设置及“保存并继续”；业务池页面的 quick setting 保留，但正式创建/删除入口位于模块设置。
- `LeadCapacitySettingsDrawer` 完成新增、编辑、删除和 Scope 规则，保持 Cordys `null=不限制、0=真实零库容`。
- `LeadPoolReasonSettingsDrawer` 完成开关、最多 50 条、新增/改名/删除、拖拽排序和最后一条删除保护；`LeadMoveToPoolDialog` 将原因配置真正接回普通/批量退池操作。

### 10.3 Browser 验收发现的真实 UI race

首次 Browser Smoke 在“添加线索池”中稳定复现了一个真实交互 race：Drawer 打开后先等待成员/部门/角色引用数据加载，异步结束时再执行整表 `reset()`，因此用户如果在引用数据加载完成前已输入名称或规则，后续初始化会覆盖其输入。

修正为：

1. Drawer 打开立即按当前新增/编辑对象初始化表单；
2. 引用数据异步加载完成后只规范化 `scopeIds/managerIds`；
3. 不再执行第二次整表 reset。

最终 Browser Smoke 使用真实 CDP 文本输入、按当前 Select 的 `aria-controls` 精确选择对应下拉项，并硬断言从 Drawer 发出一次真实 `POST /api/lead-pool/add`，避免把自动化脚本自身的 DOM 假交互误判为业务通过。

### 10.4 Seed 可重复性修正

全量 `pnpm smoke` 复跑时发现 demo Seed 对已存在成员只更新部门/直属上级，虽然每次重新计算默认密码 Hash 并打印“管理员 admin123 / 其余 demo123”，实际却没有更新 `passwordHash/defaultPwd`，导致本地数据库状态可与 Seed 输出漂移。

本轮修正 `upsertUser` 的 existing-user 分支，使重复执行 Seed 会同步恢复默认密码 Hash 与 `defaultPwd=true`。重新 Seed 后已实际验证 `zhangwei@demo.com`、`lina@demo.com` 均可使用 `demo123` 登录，根 Smoke 随后恢复 **219/219**。该修正不改变生产认证契约，只恢复 Seed 的幂等与可重复验收语义。

### 10.5 最终自动化结果

| 验收项 | 结果 |
| --- | ---: |
| 模块设置 API Smoke | **22/22** |
| 模块设置 Browser Smoke | **17/17** |
| 线索连续生命周期 | **17/17** |
| 普通线索 API | **18/18** |
| 三条转换 | **21/21** |
| 多线索池 | **32/32** |
| 线索页面 Browser | **20/20** |
| W3.4.1 首页回归 | **17/17** |
| API rules | **114/114** |
| 根全链路 Smoke | **219/219** |

工程门槛：Shared/API/Web typecheck、全仓 ESLint、Shared/API/Web production build、Prisma validate、Prisma Client generate、`git diff --check` 全部通过。Web build 仍只有既有 `ReportsView` 约 **565.90 kB** 的 chunk size warning，不属于本任务失败项。

结论：本审计第 9 节全部关闭条件均已满足。线索域现同时覆盖普通业务页、线索池业务页以及 Cordys 模块设置中的 Pool / Capacity / Move Reason 配置入口，W3.4.2 再次正式关闭；下一执行单元为 **W3.4.3 task 4.1：固化客户域源码证据矩阵**。
