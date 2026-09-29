# ADMISSIONS-001 通用招生 CRM 演进任务

> 状态：边界阶段

## T0 边界冻结

- [x] 明确招生主业务链路。
- [x] 明确保留、抽象、隐藏和删除候选边界。
- [x] 明确 Contact 不随交易链删除。
- [x] 明确 Customer Pool / 客户公海作为正式业务能力保留。
- [x] 明确签到使用可配置 Stage/Event。
- [x] 明确缴费/报名事实由外部财务系统产生，CRM 不建立 Conversion Result/Payment 财务模型。
- [x] 明确财务事件命中 Lead 时必须复用既有 Lead → Customer 转换逻辑。
- [x] 明确财务结果写入用户自定义 Customer 字段，不固化缴费/报名字段。
- [x] 明确外部 API 不使用预配置组合身份字段，由第三方每次请求自行组合 where 条件。
- [x] 明确 API 资源“唯一”是当前 API Key 可见范围内查询结果恰好 1 条。
- [x] 明确 0 条返回 NOT_FOUND，多条返回 NON_UNIQUE_MATCH，不自动选择。
- [x] 明确不同部门、不同资源池可以合法并行跟进同一个真实学生，不能默认做组织级 Lead 去重。
- [x] 明确 Lead 重复/身份判断必须带业务作用域，并且不能通过重复提示泄露其它不可见池的数据存在性。
- [x] 明确“线索判重设置”为 Lead 模块级配置，与线索表单/线索池/线索库容设置同级，不放入具体线索池。
- [x] 明确线索判重设置只控制入库 unique 校验范围，不负责给外部 API 定义查询字段组合。
- [x] 明确事件幂等与动态字段条件定位是两个独立边界。
- [x] 明确外部事件必须支持幂等、审计和失败重试。
- [x] 建立 ADMISSIONS-001 requirements/design/tasks。
- [x] 用户确认边界定义，进入 T1。

## T1 模块与调用方依赖审计

- [x] 审计 `opportunities/products/quotes/contracts/orders/bidding` 的 Web/Mobile/API/Prisma 调用方。
- [x] 审计首页、客户 360、搜索、快捷创建对交易链的引用。
- [x] 审计权限、Metadata、通知、审批、导入导出和 Seed 引用。
- [x] 输出每个删除候选模块的“可直接删 / 先抽公共能力 / 暂不能删”清单。

审计结果见 [legacy-module-dependency-audit.md](./legacy-module-dependency-audit.md)。

## T2 第一阶段产品结构收敛

- [x] 调整主导航默认模块，只保留招生主流程入口。
- [x] 从全局搜索、首页快捷创建、移动端入口移除传统交易模块。
- [x] 自定义表单能力保留并调整到系统配置语义。
- [x] 客户公海保留为正式业务入口：PC 客户顶部导航、客户列表移入公海、Mobile 公海 Tab 和全局搜索均保留。
- [x] T2 阶段 PC 与 Mobile 先通过 `productEnabled` 守卫统一关闭旧交易页；T6 已进一步物理删除这些页面与路由，客户/联系人/客户公海按权限正常开放。

当前实现只做产品入口和默认配置收敛，不在 T2 物理删除交易链 API/Prisma 模型。

## T3 招生核心通用化

- [x] 渠道来源配置边界：渠道复用 Lead 动态字段；默认 `cf_source` 为可编辑 select，不创建招生专用渠道表；工作台统计后续通过配置选择渠道维度字段。
- [x] 可配置 Stage：Lead 阶段定义存放在 `formProp.leadStages`，支持租户级名称、顺序、类型、启停；旧 `NEW/FOLLOWING/INTERESTED/SUCCESS/FAIL` 仅作为默认配置兼容已有数据。
- [x] Business Event contract 与写入链：新增 `LeadStageEvent` contract，记录组织、Lead、前后阶段、发生时间、操作者、当时负责人和 source；新建 Lead 与阶段切换均与事件写入处于同一事务，不依赖 OperationLog。
- [x] 生成并审计 Prisma 8 `LeadStageEvent` migration package：`20260928T0247_add_lead_stage_event` 仅包含新增事件表、4 个索引和长度约束，全部为 additive；已执行 `db migrate --advance-ref db` 并通过 `db verify`。
- [x] SLA 条件与自动回收动作解耦：复用 Pool 的 `storageTime / followUpTime + AND/OR` 条件；关闭自动回收仍可保存 SLA 条件，不新增招生专用规则表。
- [x] 工作台“超时未跟进”统计复用 `ResourceRecycleConditionEvaluator`：新增 `LeadPoolSlaService` 和 `/home/statistic/lead/overdue`，只要求池启用且配置有效 SLA 条件，不受 `auto` 回收开关影响。
- [x] 超时提醒调度复用同一个 `LeadPoolSlaService / ResourceRecycleConditionEvaluator`：每天 09:00 执行一次，使用 `DistributedCoordinatorService` 的 DAILY 调度槽保证多实例不重复执行，事件为 `CLUE_FOLLOW_UP_OVERDUE`，通知当前 owner。
- [x] Owner/组织绩效维度边界：复用 Member/User + owner、部门树和现有 HomeDepartmentScope；不创建招生老师模型，具体绩效指标留到 T5。
- [x] Lead → Customer/Contact 转化边界复验：转换链只创建/复用 Customer、Contact 并迁移 Follow/附件，不再创建 Opportunity，也不再返回 opportunityId。
- [x] 设计并实现 Lead 模块级“线索判重设置”入口，与“线索表单设置 / 线索池设置 / 线索库容设置”同级，统一位于系统“模块配置”中的 Lead 模块下。
- [x] 线索判重设置复用表单字段现有 `unique` 标志，不新增“组合判重字段”配置。
- [x] unique 字段支持 `RESOURCE_POOL / ORGANIZATION` 入库校验范围；默认 `RESOURCE_POOL`，不同目标线索池允许相同 unique 值。
- [x] 覆盖新建直接入池、Excel 预检/导入、手工移入池和批量移入池路径。
- [x] 验证重复错误不会泄露其它不可见资源池的数据存在性：`RESOURCE_POOL` 模式只查询目标池候选，不可见其它池的相同 unique 值不会产生冲突提示；同池重复仍返回通用字段重复错误。

当前实现将判重范围存放在 Lead 表单 `formProp.leadUniqueScope`，不新增数据库表；Customer/Contact/其它资源的既有 unique 语义保持不变。

当前 Stage 实现继续复用 `Clue.stage` 保存“当前阶段”，不做历史数据迁移；新建 Lead 使用第一个启用阶段，手工切换只能进入启用阶段，停用阶段仍可用于历史筛选。仍被线索使用的阶段 key 不能直接删除。

当前 SLA 实现把“是否超时”和“是否自动回收”分离：`CluePool.enable + recycleRule.condition` 定义 SLA，`CluePool.auto` 只决定是否执行自动回收动作。首页超时统计与自动回收均复用 `ResourceRecycleConditionEvaluator`。

SLA 提醒每天 09:00 按服务运行时本地时区触发，使用 `lead-sla-reminder + DAILY` 分布式调度槽。提醒事件进入现有消息设置、站内通知及企业消息投递链，不新增招生专用通知表；关闭自动回收不会关闭 SLA 提醒。

## T4 外部财务状态同步

- [x] 审计现有 Lead → Customer 转换服务及其全部副作用，抽出明确 Lead 的 prepare / transaction / notify 应用服务入口。
- [x] 机器到机器 External Event API 只允许 `X-Access-Key / X-Secret-Key`；新增 `@ApiKeyOnly()`，普通 JWT 调用返回 401。
- [x] 实现通用 `where` / `set` 动态字段更新契约。
- [x] where 只允许受支持系统字段和 Metadata 自定义字段，并固定使用 AND 精确匹配。
- [x] 复用 API Key 创建用户的角色、权限和数据范围执行查询；Resolver 在 0/1/多条判断前应用 owner/Data Scope。
- [x] 实现 Customer 优先、Customer 0 条后查询 Lead 的资源解析流程。
- [x] 实现 NOT_FOUND / NON_UNIQUE_MATCH 契约，多条命中时不得自动选择。
- [x] 调用方可通过增加任意允许查询字段缩小结果，无需预配置身份字段组合。
- [x] 验证重复校验和 External Event API 都不会泄露其它不可见部门/资源池的数据存在性。
- [x] 首版不新增外部字段映射表：where/set 直接接受当前 Metadata field key 或 field id；只允许写入已存在且可写的 Customer 动态字段。
- [x] 实现 `organizationId + source + externalEventId` 唯一幂等键、requestHash 防载荷复用、并发 PROCESSING 去重和 FAILED/stale 安全重试。
- [x] 新增 ExternalEventInbox/Audit 最小模型；它只保存幂等/定位/错误摘要，不是 Payment/ConversionResult 财务模型。
- [x] Lead 转 Customer、Customer 动态字段写入和 Inbox SUCCESS 处于同一事务；失败时业务事务回滚并单独记录 FAILED。
- [x] 增加重复事件、并发事件、幂等键不同 payload、字段/转换失败回滚和安全重试测试。
- [x] 增加动态 where 0/1/多条匹配、API Key Data Scope、动态字段类型校验和追加过滤条件测试。
- [x] 增加不同不可见资源池相同 unique 值可入库、同隔离范围内 unique 冲突和批量入库测试。
- [x] 财务回调禁止直接创建 Customer 或绕过 Metadata；Lead 命中必须走 resolved Lead conversion primitive。

External Event 正式入口：`POST /external-events/customer-sync`。Prisma migration `20260928T0309_add_external_event_inbox` 已应用并通过 `db verify`。

## T5 工作台与分析

- [x] 重构首页指标服务：新增统一 `HomeAnalyticsService / POST /home/statistic/analytics`，Dashboard 不再请求旧 Opportunity 首页统计接口。
- [x] 转化漏斗：优先使用 `LeadStageEvent` 统计“曾进入阶段”的唯一 Lead，迁移前无事件数据回退当前 `Clue.stage`。
- [x] 趋势：近 6 个月新增 Lead 趋势；配置 Customer 结果时间字段后同步展示业务结果趋势。
- [x] 渠道统计：渠道维度由 Lead 动态字段配置，默认可使用 `cf_source`，支持点击渠道进入真实筛选列表。
- [x] 人员绩效：按当前 Scope 的 Owner 聚合 Lead、已转 Customer 和配置化业务结果数量。
- [x] 首页分析字段配置归入“模块配置”：Lead 模块配置渠道统计字段，Customer 模块配置结果字段、命中值、结果时间字段和金额字段，不写死缴费/报名语义。
- [x] 点击指标进入真实筛选列表：Lead Stage / converted / overdue 使用专用 HomeFilter 语义；渠道和 Customer 结果复用安全动态字段 filter。

T5 focused tests 21/21 通过，覆盖 Stage Event 漏斗去重、迁移前 fallback、SLA overdue 跳转条件、Customer 首页范围、首页分析 formProp PATCH、渠道/结果/时间/金额字段类型与结果值校验；shared build、API typecheck、Web typecheck 与 `git diff --check` 均通过。

## T6 旧业务模块物理删除

- [x] 只有 T1～T5 完成并依赖清零后才执行。
- [x] 删除确认无引用的 Web/Mobile 页面与 API Client。
- [x] 删除确认无引用的 Nest Module/Controller/Service。
- [x] 删除确认无引用的 Prisma 模型：Opportunity / Product / ProductPrice 及其阶段、规则、动态字段模型均已从 contract 移除。
- [x] 生成、审计并应用 Prisma 8 forward migration `20260928T0849_remove_legacy_sales_chain`；39 个 destructive operations 已按 FK 拓扑重排并重新 attest，开发库 `db` ref 已前移到 `244779...`。
- [x] 清理权限码、Metadata、Seed 和当前 API/规格文档；历史 dependency audit 保留原始审计结论用于追溯。

当前已从 `contract.prisma` 删除 Opportunity / Product / ProductPrice 及其字段表、规则表、阶段表模型，并进一步删除 Lead 旧 `products` 固定列及 DTO/筛选语义；生产代码、generated contract 与当前开发库均已完成物理收口。Workbench 的 nvmd shim 仍注册到 Node 24.5.0，但本机实际已安装 Node 25.7.0；本轮通过受控的 25.7.0 实体执行 workspace 内 Prisma 8 CLI，未修改全局 Node 配置。

最终 migration graph 已收敛为单线 `dee42 → d6d0 → 9d7e → 8d201 → 244779`；`0849_remove_legacy_sales_chain` 直接从当前 DB ref `8d201` 删除 Contract/Quote/Order、Opportunity、Product/ProductPrice 全链及 `clue.products` 固定列。

2026-09-28 当前开发库只读 precheck：schema 实况与 `db ref=8d201` 一致，`lead_stage_event` / `external_event_inbox` 已存在、Bidding 三表已删除，而 `contract` / `opportunity_quotation` / `sales_order` 仍存在，说明 `0614_remove_contract_order_quote` 尚未应用。0614 的 26 张 drop-table 目标共 18 行非空数据：`contract=2`、`contract_stage_config=8`、`opportunity_quotation=1`、`sales_order_stage_config=7`，其余均为 0；这些数据只属于 `demo`、`contract-*`、`invoice-*`、`payment-*` 测试租户或孤儿测试数据。后续 Opportunity/Product destructive precheck 为 `opportunity=3`、`opportunity_stage_config=9`，其余 9 张目标表均 0，`clue.products` 非空为 0；其中正常存在的租户数据仅 `demo` 1 条商机 + 7 条阶段，其余为孤儿测试数据。正式环境部署前仍必须对目标环境独立执行同样的只读 precheck。

中断前的 `0614_remove_contract_order_quote` 是从 `8d201` 分叉的未提交旁支，已由最终 `0849_remove_legacy_sales_chain` 合并替代并删除。0849 `from=8d201...`、`to=244779...`，最终 migration hash `0d4bdb872b3f4cb7231cc6e36f1116afddf872da0e5e8bef9a4cf8590b7d0ad1`。初始 planner 的字母序 drop 在 `business_title` 处被 PostgreSQL FK 拒绝；本轮基于数据库 30 条内部 FK / 0 条外部 FK 生成子表优先拓扑顺序，重新 self-emit/attest 后 `migration check` PASS，39/39 operations 已成功应用。`migration status` Up to date，`db verify` 确认 marker/schema 与 `244779...` contract 一致。

## T7 验收

- [x] 空库 migration + Seed（随机临时数据库从 `empty` 应用 8 条 migration / 2277 operations 到 `244779...`，Seed 后 106 张 public 表、1 tenant、4 users、1 marker；验收后临时库已删除）。
- [x] Prisma generate（Prisma 8 `contract emit`，storage hash `244779402c6406785cb7478c93e39b89747a96ac9d904795e728dd9b40253db7`）。
- [x] API rules（362/362 pass，0 fail / 0 skip）。
- [x] shared/API/Web/Mobile typecheck（全部通过；Mobile UI 规范检查同步通过）。
- [x] lint/build（lint 0 errors / 79 existing warnings；API/Web/Mobile build 全部通过）。
- [x] 招生主链真实数据库 Smoke（Lead/Customer production Prisma 路径定向测试通过）。
- [x] 外部财务事件：Customer 直更、Lead 自动转换后更新、重复事件幂等、并发幂等、失败重试 Smoke（定向数据库测试 25/25 pass）。
- [x] PC Browser Smoke：配置入口纠偏后已由用户人工验收通过；随后继续删除未实现的主导航/顶部导航定义，`NavigationModuleKey` 与 `TopNavigationKey` 也同步收敛到真实入口，ModuleConfig 定向测试 4/4、Shared/API/Web typecheck 与 Web build 均通过。
- [x] Mobile Browser Smoke（登录页无 demo 预填；首页/线索/客户/我的四栏及核心列表正常）。
- [ ] 企业微信真实客户端 Browser Smoke：2026-09-29 本地复验中 WeCom SSO service/controller 定向测试 2/2 通过；`/api/health` 为 200，带 `wxwork` UA 的 Workbench entry 返回 302、写入 HttpOnly nonce cookie 且授权 scope 为 `snsapi_base`；并发重复 callback 会复用同一结果，成功后 `auth.acceptLoginResult()` 写入 `mmx_access_token/mmx_refresh_token`。生产 Nginx 已确认 `/login/wecom/callback` 与 `/mobile/*` 同源，`wxwork` 下统一布局关闭 `MobileHeader`，业务页无额外页面级 NavBar；通知代码不存在“全部已读”动作。生产 Compose 同时移除 `WEB_PUBLIC_URL=http://localhost:8080` 默认值，空公开地址的 Compose 解析通过，避免真实 OAuth 静默生成 localhost 回调。剩余仅真实企微客户端中确认：工作台入口静默授权后直接进入 `/mobile/home`、无登录循环/`state_used`、移动 Header 隐藏；部署环境必须把 `WEB_PUBLIC_URL` 或 `WECOM_OAUTH_REDIRECT_URI` 指向真实 CRM Web 域名。
- [x] 确认旧交易模块不存在残留入口和后台调用（生产源码旧模块/API/权限/事件路径静态扫描 0 命中）。

## T8 Prisma ORM 8 NestJS 集成收口

- [x] 审计当前 Prisma ORM 8 client 创建、NestJS DI 包装与生命周期管理方式。
- [x] 将应用运行时 client 收敛为 `src/prisma/db.ts` 导出的进程级单例 plain object；`PrismaService` 只负责 DI 包装和生命周期，不再在 `onModuleInit()` 中创建 client。
- [x] 按 Prisma ORM 8 NestJS 结构收敛目录：`contract.prisma / contract.json / contract.d.ts / db.ts / Seed` 全部归入 `src/prisma/`；`PrismaService / PrismaModule` 位于 `src/` 根层；删除旧 `apps/api/prisma/`、空 `apps/api/generated/` 与 `src/prisma/generated/`。
- [x] 生产运行时和 Seed 使用同一个 `db` plain object；仅数据库隔离/多连接测试在 `src/testing/prisma-test-db.ts` 创建独立 test client，不再保留生产 `prisma-client.ts` factory 层。
- [x] 保留 `apps/api/migrations/` 作为 Prisma 8 正式 migration graph；审计全部 8 个 migration 的 from/to contract 与 snapshots，当前 snapshots 全部属于可达迁移链，没有孤儿 snapshot 可删除。
- [x] API 主进程启用 NestJS shutdown hooks，使 `PrismaService.onModuleDestroy()` 可以在进程关闭时统一 `db.close()`；Worker 已保持同样行为。
- [x] 运行 Prisma focused tests、API typecheck/build、全量 rules 与数据库 smoke，确认单例收口不改变事务、raw query、worker 和测试隔离语义。

T8 验证结果：Prisma focused tests 5/5、API rules 362/362、API typecheck、API build、`prisma contract emit`、`prisma db verify`、`prisma migration status`（Up to date）与真实 Nest API `/api/health` 启动 smoke 均通过；`contract emit` 的 outDir 已是 `apps/api/src/prisma`，storage hash 保持 `244779402c6406785cb7478c93e39b89747a96ac9d904795e728dd9b40253db7`。生产源码不存在 `extends PrismaClient` 或 `prisma-client.ts`，运行时 client 只由 `src/prisma/db.ts` 创建一次。

代码收口复验：Shared build/typecheck、frontend-shared typecheck、API/Web/Mobile typecheck、API/Web/Mobile build、Mobile UI 规范检查均通过；全仓 ESLint 为 0 errors / 79 existing warnings；旧 `menu:opportunity/product/contract/order/bidding` 与对应 API module class 在生产源码扫描为 0；`git diff --check` 通过。

## T9 文档与任务资产清理

- [x] 代码与验收收口后，对 `docs/`、规格任务、历史 audit/acceptance/plan 和专项 Smoke 脚本完成用途审计。
- [x] 删除已经失去运行、维护、迁移或决策追溯价值的过期文档，以及仅描述已物理删除模块、一次性迁移阶段或旧执行过程的重复文档。
- [x] 保留生产部署、Prisma 8 migration、开放 API、安全边界、企业集成、Redis/BullMQ、审批、动态表单等仍对应当前代码的文档，并修正过时路径、模块范围和状态描述。
- [x] 重建根文档索引和规格索引，删除已完成专项的历史 `tasks.md`；最终扫描结果为 Markdown 相对链接 `BROKEN=0`、已删除历史文档引用 `STALE=0`、`git diff --check` 通过；当前只保留 `ADMISSIONS-001/tasks.md` 作为项目主线任务源。

T9 最终清理结果：`docs/` 从审计前 224 个 Markdown 收敛为 30 个当前文档。第一轮删除旧完整销售链、旧 Prisma8/工具链迁移、旧 UI/导航执行规格以及一次性 audit/acceptance/plan；第二轮进一步把仍带 `*-parity`、Wave、VERIFIED/阶段验收语义的完成规格重组为 8 个长期领域：Platform Foundation、Form Engine、Follow-up、Approval Engine、Enterprise Platform、Infrastructure Runtime、Messaging、Operation Log。除 `ADMISSIONS-001/tasks.md` 外不再保留专项任务日志；历史实施过程统一由 Git 追溯。3 个已经完成且无持续维护价值的专项 Browser Smoke 脚本已删除，`scripts/` 只保留仍对应现存能力的 6 个 Smoke/Mock 工具。

2026-09-28 配置入口纠偏：删除独立“业务设置”菜单、路由与页面；线索判重、线索阶段、线索池/库容/移池原因和首页渠道统计全部归入“模块配置 → Lead”，客户/联系人/公海/库容/移入公海原因/跟进计划及首页结果统计归入“模块配置 → Customer”。随后继续收敛导航产品边界：主导航只保留 `home / lead / customer / system`，顶部导航只保留 `task / event / notify / about / help`；历史数据库配置行由 API 过滤，不再暴露退出产品的 key。
