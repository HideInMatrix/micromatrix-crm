# W3.4.4 仪表板源码与 API 审计

> 状态：task 5.1 已完成源码证据固化；下一执行单元为 task 5.2 Dashboard API 命名空间释放。
>
> 原则：本文件记录 Cordys 的真实实现事实；涉及组织隔离、URL 安全、iframe / `postMessage`、token 生命周期的弱边界不原样复制，按本项目 R10/R11 的更严格要求实现。

## 1. 本轮读取范围

### 1.1 Cordys 后端

- `backend/crm/src/main/java/cn/cordys/crm/dashboard/controller/DashboardController.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/controller/DashboardModuleController.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/service/DashboardService.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/service/DashboardModuleService.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/service/DashboardSortService.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/domain/Dashboard.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/domain/DashboardModule.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/domain/DashboardCollection.java`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/mapper/ExtDashboardMapper.xml`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/mapper/ExtDashboardModuleMapper.xml`
- `backend/crm/src/main/java/cn/cordys/crm/dashboard/mapper/ExtDashboardCollectionMapper.xml`
- `backend/crm/src/main/resources/migration/1.1.0/ddl/V1.1.0_2__ga_ddl.sql`
- `backend/crm/src/main/resources/migration/1.3.0/ddl/V1.3.0_2__ga_ddl.sql`

### 1.2 Cordys DataEase 集成

- `integration/common/request/DeThirdConfigRequest.java`
- `integration/dataease/DataEaseClient.java`
- `integration/dataease/service/DataEaseService.java`
- `integration/dataease/service/DataEaseSyncService.java`
- `integration/dataease/constants/DataScopeVariable.java`
- `system/controller/OrganizationSettingsController.java`

### 1.3 Cordys 前端

- `frontend/packages/lib-shared/api/requrls/dashboard.ts`
- `frontend/packages/lib-shared/api/modules/dashboard.ts`
- `frontend/packages/lib-shared/models/dashboard.ts`
- `frontend/packages/web/src/router/routes/modules/dashboard.ts`
- `frontend/packages/web/src/views/dashboard/index.vue`
- `frontend/packages/web/src/views/dashboard/link.vue`
- `frontend/packages/web/src/views/dashboard/module.vue`
- `frontend/packages/web/src/views/dashboard/fullPage.vue`
- `frontend/packages/web/src/views/dashboard/components/tree.vue`
- `frontend/packages/web/src/views/dashboard/components/table.vue`
- `frontend/packages/web/src/views/dashboard/components/dashboard.vue`
- `frontend/packages/web/src/views/dashboard/components/addDashboardModal.vue`

### 1.4 MicroMatrix 当前实现

- `apps/api/src/modules/dashboard/dashboard.controller.ts`
- `apps/api/src/modules/dashboard/dashboard.service.ts`
- `apps/web/src/api/dashboard.ts`
- `apps/web/src/views/home/ReportsView.vue`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260825180000_w34_cordys_direct_models/migration.sql`

## 2. 领域结论：Cordys 的 Dashboard 不是首页统计

Cordys `/dashboard` 是一个独立的“仪表板资源目录”领域，核心实体为：

1. `dashboard_module`：多级目录；
2. `dashboard`：一个可嵌入/打开的仪表板 URL 资源；
3. `dashboard_collection`：用户收藏关系。

当前 MicroMatrix 的 `/api/dashboard/summary|funnel|ranking|trend|conversion` 实际是首页/销售统计 API，`/reports` 是固定 ECharts 报表。它们与 Cordys Dashboard 语义不同。因此 task 5.2 必须先释放 `/api/dashboard`，旧统计逻辑迁回 Home 领域；task 5.5 再用真实资源目录替换 `/reports`，不保留旧报表兼容入口。

## 3. Cordys API 契约矩阵

### 3.1 Dashboard 资源

| Method | Path | 权限 | 关键请求/行为 |
| --- | --- | --- | --- |
| POST | `/dashboard/add` | `DASHBOARD:ADD` | `name/resourceUrl/dashboardModuleId/scopeIds/description`；同目录名称唯一；目录必须存在；分配稀疏 `pos` |
| GET | `/dashboard/detail/{id}` | `DASHBOARD:READ` | 返回目录名、Scope 展开成员、URL、描述 |
| POST | `/dashboard/update` | `DASHBOARD:UPDATE` | 更新名称、URL、目录、Scope、描述及审计字段 |
| POST | `/dashboard/rename` | `DASHBOARD:UPDATE` | 仅重命名，仍执行同目录名称唯一 |
| GET | `/dashboard/delete/{id}` | `DASHBOARD:DELETE` | 删除 Dashboard，并清理收藏 |
| POST | `/dashboard/page` | `DASHBOARD:READ` | `current/pageSize/keyword/dashboardModuleIds/sort`；目录过滤可包含子目录 |
| GET | `/dashboard/collect/{id}` | `DASHBOARD:READ` | 收藏；重复收藏报错 |
| GET | `/dashboard/un-collect/{id}` | `DASHBOARD:READ` | 取消收藏 |
| POST | `/dashboard/collect/page` | `DASHBOARD:READ` | 我的收藏分页 |
| POST | `/dashboard/edit/pos` | `DASHBOARD:UPDATE` | `moveId/targetId/dashboardModuleId/moveMode`，支持跨目录后排序 |

### 3.2 DashboardModule 目录

| Method | Path | 权限 | 关键请求/行为 |
| --- | --- | --- | --- |
| POST | `/dashboard/module/add` | `DASHBOARD:ADD` | `parentId/name`；同父目录名称唯一 |
| POST | `/dashboard/module/rename` | `DASHBOARD:UPDATE` | 同父目录名称唯一 |
| POST | `/dashboard/module/delete` | `DASHBOARD:DELETE` | body 为目录 ID 数组；目录包含仪表板时拒绝删除 |
| GET | `/dashboard/module/tree` | `DASHBOARD:READ` | 目录 + 当前用户可见 Dashboard 合成树 |
| GET | `/dashboard/module/count` | `DASHBOARD:READ` | 递归目录数量 + `myCollect` 收藏数 |
| POST | `/dashboard/module/move` | `DASHBOARD:UPDATE` | `dragNodeId/dropNodeId/dropPosition`；目录移动与稀疏排序 |

前端 `requrls/dashboard.ts` 与上述 Controller 一一对应，没有第二套 Dashboard REST 契约。

## 4. 数据模型与 DDL

### 4.1 `dashboard_module`

- `id VARCHAR(32)`
- `organization_id VARCHAR(32)`
- `name VARCHAR(255)`
- `parent_id VARCHAR(32) DEFAULT 'NONE'`
- `pos BIGINT DEFAULT 0`
- 创建/更新人及毫秒时间戳
- Cordys 索引：organization/name/pos/parent

### 4.2 `dashboard`

最终模型字段：

- `id`
- `name VARCHAR(255)`
- `resource_url VARCHAR(500)`
- `dashboard_module_id`
- `organization_id`
- `pos`
- `scope_id TEXT`
- `description VARCHAR(1000)`
- 创建/更新审计字段

历史 DDL 1.1.0 使用 `resource_id VARCHAR(50)`，1.3.0 明确迁移为 `resource_url VARCHAR(500)`；最终实现必须以 `resource_url` 为准。

### 4.3 `dashboard_collection`

- `id`
- `user_id`
- `dashboard_id`
- 创建/更新审计字段
- Cordys 只有 `user_id` 普通索引，业务层阻止重复收藏。

MicroMatrix 在 W3.4.0 已落 `DashboardModule / Dashboard / DashboardCollection` Prisma 直接模型和 migration，字段已经以 Cordys 最终 `resource_url VARCHAR(500)` 为基准，因此 **5.x 不需要再造另一套 Dashboard 表**。后续只补 Service/API/约束和必要的唯一索引/安全约束。

## 5. Scope 可见性事实

Cordys `ExtDashboardMapper.list/selectDashboardNode` 的非管理员可见条件为：

1. `scope_id` JSON 数组包含当前 `userId`；或
2. `scope_id = '[]'`，表示所有人可见；或
3. `scope_id` 包含当前部门向上的祖先部门 ID；或
4. 当前用户是资源 `create_user`。

管理员 `admin` 跳过上述 Scope 条件。

页面添加/编辑仪表板时 `scopeIds` 使用组织成员选择器；后端详情再通过 `UserExtendService.getScope(...)` 展开为成员名称。

### 5.1 MicroMatrix 必须加固的 Scope 边界

Cordys 的列表/树有 Scope SQL，但 `getDetail(id)`、`delete(id)`、`collect(id)` 等路径没有在 Mapper 查询里重复组织/Scope 条件。MicroMatrix 不复制这一弱点：

- 列表、树、详情、收藏、取消收藏、更新、删除、排序均必须重新执行 `tenantId + Dashboard Scope`；
- 目录读取和写入也必须执行 `organizationId` 隔离；
- 创建者可见规则可保持 Cordys 行为，但不能突破 tenant；
- 收藏不能成为绕过 Scope 的读入口。

## 6. 排序与目录移动

Cordys 有两套排序底座：

1. `DashboardSortService`：Dashboard 资源稀疏 `pos`；计算前后节点中点，间距耗尽时批量刷新位置；
2. `MoveNodeService`（`DashboardModuleService` 继承）：目录树移动、换父级和同级稀疏排序。

Dashboard 跨目录拖动时先变更 `dashboard_module_id`，再执行 `moveNode` 排序。目录移动时如父级变化，会先做目标父级同名检查，再排序。

MicroMatrix task 5.3 在保持交互语义的同时必须补强：禁止目录移动到自身或自身后代、禁止孤儿 parent、所有目标节点必须同 tenant；任何换父级 + 排序必须同事务提交。

## 7. 收藏行为

- 收藏是用户级关系，不改变 Dashboard Scope；
- `collect` 重复调用在 Cordys 中报 `dashboard_collect_exist`；
- `un-collect` 按 `dashboardId + userId` 删除；
- 树节点与分页列表都补 `myCollect`；
- `/dashboard/module/count` 额外返回 `myCollect` 数量；
- 删除 Dashboard 时同步清理收藏。

本项目 5.4 应在数据库层或事务层保证 `(userId, dashboardId)` 幂等唯一；重复收藏可返回成功或稳定业务错误，但不能产生重复行。

## 8. 前端页面调用链

Cordys 路由：

- `/dashboard` → `/dashboard/index`
- `/dashboard/link`：资源目录管理页
- `/dashboard/module`：DataEase 仪表板模块嵌入页

`link.vue` 为典型左树右内容：

- 左：目录、全部、收藏、Dashboard 节点；支持目录 CRUD、移动、收藏；
- 右侧目录节点：资源分页表；
- 右侧 Dashboard 节点：iframe 预览；
- `addDashboardModal.vue`：名称、URL、目录、成员范围、描述；
- 表格名称点击会 `window.open(resourceUrl, '_blank')`；
- Dashboard 预览支持收藏和全屏。

现有 MicroMatrix `/reports` 的固定 ECharts 三块统计不属于该调用链，5.5 必须删除并重建。

## 9. DataEase 配置事实

Cordys `DeThirdConfigRequest` 包含：

- `agentId`
- `appSecret`
- `deAccessKey`
- `deSecretKey`
- `redirectUrl`
- `deOrgID`
- `deAutoSync`
- `deBoardEnable`

Dashboard 首页只在第三方配置 `deBoardEnable=true` 时展示 DataEase 入口。

`GET /organization/settings/de-token?isModule=...` 需要 `DASHBOARD:READ`，通过 `DataEaseService.getEmbeddedDeToken`：

1. 从组织第三方配置的 `DE_BOARD` 详情读取 DataEase 配置；
2. 使用 `agentId/appSecret` 为当前 CRM 用户 ID 生成 HMAC256 JWT；
3. JWT claims 为 `account` 与 `appId`，返回 `{token, url: redirectUrl}`。

源码中的 `isModule` 参数目前没有改变后端 token 内容，只是前端调用保留该参数。

## 10. DataEase 服务端 API 与数据范围同步边界

`DataEaseClient` 面向外部 DataEase `/de2api/*`，使用：

- Header `accessKey`
- AES 生成 `signature`
- HMAC256 生成 `x-de-ask-token`

连接测试通过 `GET user/personInfo`。

`DataEaseSyncService` 还会为 DataEase 用户同步 CRM 数据权限系统变量。当前变量至少覆盖：

- `ACCOUNT_DATA_SCOPE_TYPE`
- `LEAD_DATA_SCOPE_TYPE`
- `OPPORTUNITY_DATA_SCOPE_TYPE`

并绑定对应部门范围变量。这里属于“外部 DataEase 用户/变量同步”，不是 Dashboard 目录 Scope 本身，两者不能混为一个权限系统。

W3.4 只实现 R10 指定的 DataEase **配置 / token / 嵌入适配边界和可诊断失败状态**，不复制 Cordys License 系统，也不捆绑 DataEase 服务端；完整 DE 用户/角色/变量同步不应成为仪表板页面上线的前置条件。

## 11. 嵌入协议事实

### 11.1 DataEase 模块页

`module.vue`：

- 请求 `getDEToken(true)`；
- iframe `${url}/#/chart-view`；
- 收到 `event.data.msgOrigin === 'de-fit2cloud'` 后向 iframe 发送：
  - `type: 'DashboardPanel'`
  - `embeddedToken`
  - `de-embedded: true`

### 11.2 单个 DataEase Dashboard

`components/dashboard.vue` 在没有 `resourceUrl` 时请求 `getDEToken()`，发送：

- `busiFlag: 'dashboard'`
- `dvId: dashboardId`
- `type: 'Dashboard'`
- `embeddedToken`
- `de-embedded: true`

存在 `resourceUrl` 时则直接将该 URL 作为 iframe `src`。

## 12. 必须偏离 Cordys 的安全实现

源码事实不能覆盖本项目 R10/R11 安全要求：

1. Cordys `addDashboard` 调用 `SSRFValidator.validateAgainstWhitelist(resourceUrl)`，但 `updateDashboard` 未看到同等 URL 校验；MicroMatrix **新增和更新必须共用同一 URL validator**。
2. Cordys iframe 消息仅判断 `msgOrigin` 字段，随后 `postMessage(params, '*')`；MicroMatrix 必须校验 `event.origin`，并使用配置得到的精确 target origin，禁止 `*`。
3. 外部资源 URL 在 Cordys 表格中可直接 `window.open`、iframe 直接加载；MicroMatrix 只允许 HTTPS，开发环境仅显式允许 localhost HTTP，并拒绝 `javascript: / data: / file:` 等协议。
4. Provider token 不得拼入 URL query；通过内存/postMessage 传递，禁止日志记录 Secret/token。
5. DataEase 配置缺失、配置禁用、token 失败、URL 被策略拒绝、iframe/provider 加载失败必须是不同可诊断状态。
6. 嵌入页需配置 CSP `frame-src` / origin allowlist；第三方 origin 只能来自已验证配置。
7. Cordys JWT 未设置显式 `exp/aud`；MicroMatrix 的 provider token adapter 应支持短生命周期/过期语义，具体能力受真实 DataEase 协议约束，但不能把长期凭据暴露给浏览器。

## 13. 当前 MicroMatrix 差距矩阵

| 项目 | 当前状态 | 5.x 处理 |
| --- | --- | --- |
| Dashboard Prisma 直接表 | 已存在并与 Cordys 最终 DDL 基本一致 | 复用，不重建 |
| `/api/dashboard` | 被首页统计 `summary/funnel/ranking/trend/conversion` 占用 | 5.2 迁回 Home 并释放 |
| `/reports` | 固定 ECharts 报表 | 5.5 破坏式替换 |
| DashboardModule CRUD/tree/count/move | 5.3 已完成并通过真实 API Smoke | 已闭环 |
| Dashboard CRUD/page/sort | 5.3 已完成并通过真实 API Smoke | 已闭环 |
| Scope | 5.3 已统一用于 page/detail/tree/count/update/delete/move | tenant + Scope + 创建人兜底已闭环 |
| 收藏 | 表存在，API 未落地 | 5.4 |
| URL 安全 | Dashboard 资源链路未落地 | 5.4 共用 allowlist validator |
| DataEase 配置/token adapter | 现有企业配置能力需复核复用点 | 5.4，只做适配边界 |
| iframe/origin/CSP | 未实现 | 5.4/5.5 |
| 桌面 Browser 闭环 | 未实现 | 5.6 |

## 14. task 5.2～5.6 实施锁定

### 14.1 task 5.2：释放命名空间

- 旧统计 Service/DTO/API 从 Dashboard 领域迁入 Home；
- 删除 `/dashboard/summary|funnel|ranking|trend|conversion`；
- `/api/dashboard` 仅保留本文件第 3 节 Cordys 资源契约；
- `/reports` 在 5.5 直接切换新页面，不增加兼容代理。

### 14.2 task 5.3：资源和目录 Service

- 先做 tenant-safe Repository/access helper，再写 Controller；
- 目录 CRUD/tree/count/move；资源 CRUD/page/rename/sort；
- 同级/同目录重名、目录环、孤儿、跨 tenant、排序事务全部由后端强制；
- Dashboard Scope 按“空数组=全员、user/department Scope、创建者可见”实现，并应用到所有读取和写入目标解析。

### 14.3 task 5.4：收藏与通用安全嵌入

- 收藏/取消收藏/收藏分页/计数；
- URL validator 同时用于 add/update/open/embed；
- 精确 origin + CSP/frame allowlist，禁止 `postMessage('*')`；
- DataEase 配置、token adapter、CRM→DE 变量同步按当前产品决策延后，单独进入 deferred backlog，不阻塞 Dashboard 目录/资源/收藏/通用 iframe 主链。

### 14.4 task 5.5：Vue 页面

- `/reports` 重建左树右内容；
- 目录节点显示资源表，Dashboard 节点显示预览；
- 新增/编辑、收藏、拖拽、全屏、新窗口全部走真实 API；
- 缺配置、策略拒绝和 provider 错误不使用同一个泛化空态。

### 14.5 task 5.6：专项验收

- API/DB Smoke：tenant、Scope、目录环/重名、收藏幂等、跨目录排序、URL allowlist、旧统计路径 404；
- Browser：目录→资源→Scope→收藏→移动→嵌入→删除；
- provider 使用可控测试 endpoint，不要求运行真实 DataEase 服务端；
- 根级 smoke/typecheck/lint/build/diff 全量回归后本地提交。

## 15. task 5.1 结论

Dashboard 的源码事实、API、三表 DDL、Scope、收藏、目录/资源排序、DataEase 配置/token/嵌入协议及安全偏离点已经固化。**5.1 不需要改业务代码；下一步直接执行 5.2，先解决 `/api/dashboard` 与旧首页统计的命名空间冲突。**

## 16. task 5.2 实施结果

5.2 已完成破坏式命名空间释放：

1. 原 `apps/api/src/modules/dashboard/dashboard.service.ts` 的五类销售统计迁入 `HomeOverviewService`，Controller 固定为 `/home/overview/*`；首页统计数据范围算法保持原行为。
2. 原 `DashboardController` 与旧统计 Service 删除；`DashboardModule` 暂时保留为空模块，作为 5.3 注册 Cordys Dashboard 资源 Controller/Service 的唯一入口。
3. Web 临时 `/reports` 从 `dashboardApi` 切换到 `homeOverviewApi`；Mobile 首页 `dashboardSummary()` 同步改为 `/home/overview/summary`，没有残留端继续访问旧路径。
4. `scripts/smoke.mjs` 继续验证工作台简报/商机漏斗，并新增五条旧 `/dashboard/summary|funnel|ranking|trend|conversion` 全部 404 的门槛。
5. 验收：根级 Smoke **221/221**；根级 typecheck、受影响文件 ESLint、production build 全绿。

task 5.2 关闭；下一执行指针为 **W3.4.4 task 5.3：实现 DashboardModule 与 Dashboard Service**。

## 17. task 5.3 实施结果

5.3 已完成 DashboardModule 与 Dashboard 资源主体：

1. 新增 `DashboardAccessService`，统一解析 Dashboard `scope_id`。普通成员只在空 Scope、本人用户 ID、本人当前部门/祖先部门命中或自己为创建人时可见；管理员 `*` 可见全部。损坏的 Scope JSON 对普通成员 fail-closed，不能退化成空 Scope。
2. 新增 `DashboardModuleController/Service`：支持 add/rename/delete/tree/count/move。新增/移动强制同级名称唯一、父目录存在、tenant 一致；目录不能移动到自身或后代；删除目录时如果仍有 Dashboard 或未一并删除的子目录则拒绝，防止孤儿节点。
3. 新增 `DashboardResourceController/Service`：支持 add/detail/update/rename/delete/page/edit-pos。资源名称在同目录唯一；Scope ID 必须是当前租户真实用户或部门；跨目录移动与 BEFORE/AFTER/APPEND 均在事务内重排 `pos`。
4. 资源 page/detail/tree/count/update/delete/move 使用同一 tenant + Scope 事实，不复制 Cordys `detail/delete/collect` 按裸 ID 访问的弱边界。第二租户即使拥有管理员 `*`，访问当前租户资源仍返回 404。
5. 权限树新增 `dashboard:read/create/update/delete`：销售专员默认 `read`，销售主管增加 `create/update/delete`；关键 create/update/rename/delete/move/module 动作全部使用 `@LogOperation('dashboard', ...)` 写真实操作日志。
6. 专项 `scripts/w344-dashboard-api-smoke.mjs` 最终 **31/31**；覆盖三角色权限、空/user/department Scope、创建人兜底、第二租户隔离、目录重名/无效父节点/防环/防孤儿、资源 update/rename/delete、跨目录 APPEND、BEFORE 排序和操作日志。
7. 根级 Smoke 增加明确前缀的历史测试线索清理，防止反复执行后占满 Seed 的 80 条线索库容；回归：API rules **114/114**、根级 Smoke **222/222**、根级 typecheck、受影响文件 ESLint、production build 全绿。

task 5.3 关闭；下一执行指针为 **W3.4.4 task 5.4：收藏与安全嵌入适配**。

## 18. task 5.4 实施结果

5.4 按产品决策收缩为“收藏 + 通用外链安全边界”，**DataEase 暂不实现**：

1. 新增 `/dashboard/collect/{id}`、`/dashboard/un-collect/{id}`、`/dashboard/collect/page`；重复收藏稳定返回 409，重复取消保持幂等。
2. 收藏目标、收藏分页与 `module/count.myCollect` 全部复用 tenant + Dashboard Scope；即使数据库存在历史收藏，资源失去 Scope 后也不会进入收藏列表或数量。
3. `resourceUrl` 新增与更新共用同一 validator：生产语义仅 HTTPS；开发环境只额外允许 localhost/127.0.0.1/::1 HTTP；拒绝 URL 内嵌账号密码及其它协议。
4. 新增 `/dashboard/embed/policy/{id}`，只返回该资源的精确 `origin/postMessageOrigin/frameSrc/CSP/sandbox`，不返回 `*`，为 5.5 iframe 页面提供统一策略事实。
5. DataEase 配置、token、provider adapter、CRM→DE Scope 变量同步全部转入 deferred backlog；本阶段没有新增 Prisma 模型或 migration。
6. Dashboard API Smoke **44/44**；根级 Smoke **223/223**、rules **114/114**、typecheck/ESLint/production build 全绿。根 Smoke 同步增加明确前缀的历史客户夹具清理，避免反复执行占满 Seed 的客户库容。

task 5.4 关闭；下一执行指针为 **W3.4.4 task 5.5：替换 `/reports` Vue 页面**。
