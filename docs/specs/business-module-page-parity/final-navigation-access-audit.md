# W3.4.5 全图导航与访问边界验收

本文件用于固化 W3.4.5 task 6.1～6.5 的最终证据。验收范围只覆盖本轮 W3.4 功能图：首页、线索/线索池、客户/联系人/客户公海、仪表板，以及这些页面之间由消息、审批、计划、统计和资源 ID 产生的跨页链路。

Cordys 源码仍是行为第一事实来源；MicroMatrix 的现有页面不能反向定义对齐标准。

## 1. 菜单与页内导航源码事实

Cordys `frontend/packages/web/src/config/pathMap.ts` 明确：

- `CLUE_MANAGEMENT` 下包含“线索 / 线索池”；
- `CUSTOMER` 下包含“客户 / 联系人 / 客户公海”；
- `DASHBOARD` 是独立主导航项；
- 首页、客户和线索的子页面切换不应改变所属主导航高亮。

MicroMatrix 最终对应：

| Cordys 语义 | MicroMatrix 路由 | 主导航 |
| --- | --- | --- |
| 首页 | `/dashboard` | 首页 |
| 线索 | `/leads` | 线索 |
| 线索池 | `/leads/pool` | 线索 |
| 客户 | `/customers` | 客户 |
| 联系人 | `/contacts` | 客户 |
| 客户公海 | `/customers/open-sea` | 客户 |
| 客户 360 | `/customers/:id` | 客户 |
| 仪表板 | `/reports` | 仪表板 |

`/contacts` 与 `/customers/open-sea` 已补 `activeMenu: '/customers'`；客户公海路由同时从宽泛 `menu:customer` 收紧为 `customerPool:read`。`CustomerModuleNav` 的联系人和公海页签与后端读取权限使用同一权限事实。

## 2. 资源 ID 与跨页契约

### 2.1 线索 / 线索池

Cordys `clueTable.vue` 通过 `route.query.id` 打开普通线索 Overview；`cluePoolTable.vue` 使用 `id + poolId` 打开池内线索 Overview。

MicroMatrix 已补齐相同语义：

- `/leads?id=<leadId>` → `/lead/get/:id` → 打开 `LeadOverviewDrawer`；
- `/leads/pool?id=<leadId>&poolId=<poolId>` → `/pool/lead/get/:id` → 选择真实 Pool 并打开池内 Overview；
- 合法 query 保留，因此浏览器刷新可恢复同一资源 Drawer；
- 无效资源会清理 `id/name/poolId/transitionType`，不残留坏深链。

### 2.2 客户 / 联系人 / 客户公海

- 客户详情继续使用 `/customers/:id`，并通过返回按钮回 `/customers`；
- 联系人和客户公海是客户模块页内二级页，切换后左侧客户菜单保持激活；
- 没有 `customerPool:read` 的用户既看不到客户公海页签，手工输入 `/customers/open-sea` 也会被路由 Guard 拒绝；
- 客户/联系人/公海此前 task 4.6 已完成普通/公海 query 深链，本轮重新验证导航归属与 Guard 一致。

### 2.3 首页统计

首页统计继续使用一次性 `homeFilter` token：

1. 首页把统计周期、人员/部门范围、时间字段和状态写入 `sessionStorage`；
2. 线索/商机列表消费 token；
3. token 消费后从 URL 移除；
4. 后端列表 total 与首页统计口径一致。

首页专项 Smoke 重新执行 **17/17**，包含 ALL/SELF/DEPARTMENT、无权限 403、线索/商机点击后的列表 total 对齐。

### 2.4 跟进计划

首页单条“我的计划”现在携带资源 ID：

`/follow-plans?id=<planId>&mine=1`

`FollowUpPlansView` 使用 `/follow-up-plans/:id` 读取目标计划并打开真实 `FollowUpPlanDialog`。刷新仍能恢复同一计划。若资源可读但 `canManage=false`，Dialog 退化为只读，不能借深链获得编辑能力。

### 2.5 审批

首页四类审批入口继续使用：

`/approvals?tab=pending|handled|mine|copied`

Browser 已验证 `pending` 能被审批页实际消费为“待我审批”，不是只把 query 挂在 URL。

### 2.6 通知

本轮修正一个历史断链：商机通知曾生成不存在的 `/opportunities/:id`。最终统一使用目标页面已支持的：

`/opportunities?id=<opportunityId>`

线索通知继续使用 `/leads?id=<leadId>`。Browser 使用真实分配通知验证：点击首页通知后分别打开准确的线索 Overview 和商机 Drawer。

## 3. task 6.1 Browser 结果

新增 `scripts/w345-navigation-browser-smoke.mjs`，最终 **29/29**：

- 主菜单严格跟随实时模块开关和排序；
- 普通线索、线索池资源深链及刷新恢复；
- 线索池保持主导航高亮；
- 客户/联系人/公海三页导航及客户主导航高亮；
- Customer 360 资源 ID 和返回路径；
- 跟进计划 ID 深链、刷新保持、首页单条计划跳转；
- 首页统计 `homeFilter` 真实消费；
- 审批 pending tab 消费；
- 线索/商机通知资源 ID 真实打开目标；
- 无客户公海权限时页签隐藏 + 手工 URL 拒绝；
- Runtime exception 0，业务 Console error 0。

## 4. task 6.2 权限 / DataScope / 组织隔离矩阵

| 角色/关系 | 列表/统计 | 详情 | 写动作 | Pool/公海 | 收藏 | 组织隔离 | 最终证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 管理员 | ALL | 全部本租户 | `*` | 管理 | 可 | 仍绑定 tenant | 根 Smoke 223/223、各专项 |
| 销售主管 | DEPT_AND_CHILD | 本部门及下级 | 按动作权限 | Pool Scope + 管理权限 | Dashboard Scope | tenant | 根 Smoke、Pool 专项 |
| 销售专员 | SELF | 本人 DataScope | 仅拥有动作 | 仅命中 Pool；客户公海无权限时不可见 | 只读 Dashboard 可收藏可见资源 | tenant | 根 Smoke、导航 Browser |
| COLLABORATION | 协作可读资源 | 可读授权客户 | 不因协作关系获得管理能力 | 不适用 | 不适用 | tenant | 客户深层 30/30 |
| READ_ONLY | 只读授权 | 只读 | 不可写 | 不适用 | 不适用 | tenant | 客户深层 30/30 + 页面只读链 |
| 多角色 | 功能权限并集 | 同权限码 DataScope 并集 | 只合并拥有该动作权限的角色 | 同权限事实 | 同上 | tenant | 根 Smoke 223/223 |
| 无功能权限 | 菜单/页签隐藏 | Guard 拒绝 | Guard 拒绝 | Guard 拒绝 | 不可越权收藏 | tenant | 根 Smoke、导航 Browser |
| 其他租户 | 无当前租户数据 | 404/拒绝 | 拒绝 | 拒绝 | 不泄漏历史收藏 | 强制组织隔离 | Dashboard 44/44 + 其它专项 |

## 5. 6.2 现场复跑结果

本轮不是引用历史数字，而是重新执行现有专项：

- 首页统计/DataScope：`w341-home-smoke.mjs` **17/17**；
- 线索池/权限/Scope/导出/原子批量：`w342-clue-pool-smoke.mjs` **32/32**；
- 客户 COLLABORATION / READ_ONLY / 关系 / 合并：`w343-customer-deep-api-smoke.mjs` **30/30**；
- 客户公海 Scope/普通详情绕过拒绝/跨池原子性：`w343-customer-pool-smoke.mjs` **36/36**；
- Dashboard Scope/收藏/第二租户：`w344-dashboard-api-smoke.mjs` **44/44**；
- 根级角色/多角色/DataScope/Guard：`pnpm smoke` **223/223**；
- 全图跨页 Guard 与菜单：`w345-navigation-browser-smoke.mjs` **29/29**。

这些结果共同覆盖 task 6.2 指定的管理员、主管、普通成员、协作、只读协作、多角色并集、无权限用户，以及列表、详情、统计、导出、Pool/公海、收藏和跨页手工请求。

## 6. task 6.3 空库、迁移、Seed 与全量自动化

新增 `scripts/w345-empty-db-validation.mjs`，不依赖本机 `createdb/dropdb` 或 Docker CLI，而是复用项目现有 Prisma PostgreSQL adapter 直接连接管理库创建/删除临时数据库。最终 **14/14**：

- 真正创建独立 PostgreSQL 数据库，不复用开发库 schema；
- 从空库顺序应用当前全部 **35 个 migration**；
- Seed 连续执行两次，管理员/销售主管 `admin123`、销售专员 `demo123` 状态保持幂等；
- 目标直接表 **32/32** 存在；
- 被 W3.4 破坏式替换的旧表 **14/14** 均不存在；
- 关键索引 **23/23** 存在；
- 动态字段、五类 User View、多线索池/客户公海、Capacity、Owner History、协作/关系、转换关系、Dashboard Seed 样例全部存在；
- 使用正式 build 产物和 `apps/api` 工作目录在隔离数据库上启动 API；
- Web 使用独立 Vite runtime proxy 指向隔离 API 后可启动并登录 Seed 管理员；
- `/lead/page`、`/account/page`、`/dashboard/page`、`/module-configs` 在新库可直接使用；
- 旧 `/leads`、`/customers`、`/contacts`、`/dashboard/summary` 均真实 404；
- 验收结束后 API/Web 子进程和临时数据库均自动清理。

最终全仓门槛重新执行：

- `pnpm smoke`：**223/223**；
- `pnpm --filter @micromatrix/api test:rules`：**114/114**；
- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm build`：Shared/API/Web production build 全部通过。

全仓 ESLint 在最终复跑时额外抓到 `w343-customer-module-settings-browser-smoke.mjs` 已废弃的未使用 `clickText` helper；已删除纯测试死代码后重新全绿，未改变任何业务断言。

## 7. task 6.4 桌面与既有 Mobile 浏览器回归

最终逐域 Browser 重新执行：

| 范围 | 结果 |
| --- | ---: |
| 首页 Browser | **12/12** |
| 线索/线索池 Browser | **20/20** |
| 客户/联系人/客户公海 Browser | **23/23** |
| Dashboard Browser | **28/28** |
| W3.4.5 全图导航 Browser | **29/29** |
| Mobile Home + Mobile Leads 总验收 | **10/10** |

客户域最终 Browser 比 task 4.7 的历史 21 项增加两条夹具/Pool 归属自证，并在高负载下发现一个真实竞态：客户公海初始 `loadData()` 与用户搜索可能并发，较慢的旧请求晚返回后会覆盖较新的搜索结果。`CustomerPoolView` 现与线索页采用同一请求 generation 策略：

1. 同参数正在执行时复用同一 Promise，避免重复请求；
2. 每个新参数请求递增 generation；
3. 只有最新 generation 可以更新 `items/total/loading`；
4. Pool 清空时主动使旧 generation 失效。

修复后客户 Browser **23/23** 稳定通过，搜索请求真实带 `poolId + keyword`，旧初始响应不能再覆盖搜索结果。

Mobile 总验收使用 390×844 真实手机视口验证：

- `/home` 选择 `MobileTabbarLayout + mobile/HomeView`，底部工作台/线索/客户/审批/我的导航存在；
- Mobile Home 真实请求 `/home/overview/summary`，刷新后仍保持移动工作台；
- `/leads` 选择 Mobile Leads，普通列表真实请求 `/lead/page`；
- 切换线索池真实请求 `/pool/lead/options` 与 `/pool/lead/page`；
- 刷新后仍保持 Mobile Leads；
- Runtime exception 0、业务 Console error 0。

静态负向检查确认本轮 W3.4 页面目录不存在“待开发”占位文本；本轮验收页面的数据均来自实际 API/Seed/专项夹具，不以静态数组冒充业务结果。

## 8. task 6.5 最终结论

W3.4.5 task 6.1～6.4 的菜单、跨页资源 ID、权限组合、DataScope、租户隔离、空库 migration/Seed/runtime、桌面与既有 Mobile Browser 均已形成可重复自动化证据；R1～R12 在本轮 W3.4 功能图范围内均已有实现与验收对应项。

因此 **W3.4 图中业务模块逐页复查可标记 `VERIFIED`**：

- W3.4.0 公共直接模型与列表底座：完成；
- W3.4.1 首页：完成；
- W3.4.2 线索/线索池：完成；
- W3.4.3 客户/联系人/客户公海：完成；
- W3.4.4 Dashboard：完成；
- W3.4.5 全图最终验收：完成。

`VERIFIED` 仅代表用户确认的这张 W3.4 功能图，不等于整个 CordysCRM 所有模块 100% 复刻。DataEase provider/token 仍按产品决定登记在 DB-023 deferred；商机高级配置、合同/发票高级流程、自定义表单等图外能力继续由现有 deferred/parity 台账跟踪，不以 W3.4 完成状态掩盖。
