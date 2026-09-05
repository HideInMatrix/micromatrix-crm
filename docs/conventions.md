# CordysCRM 界面复刻约定

- `CordysCRM/` 是只读业务与交互参考源码，不进入 MicroMatrix Git 版本库。
- CordysCRM 源代码是当前复刻工作的第一事实来源。现有 MicroMatrix 页面、接口和业务规则只在与 Cordys 源码一致时保留；发生冲突时允许直接删除、替换或重构旧实现，不以“兼容旧页面/旧接口”为优先目标。
- 数据库表与 Prisma 模型必须先读取 Cordys Domain、DDL、Mapper 后设计；字段、枚举、关系、可空性、默认值和约束以 Cordys 为准。当前项目尚未正式发布，发现旧模型偏差时直接修改 `schema.prisma`，并在提交数据库结构变更前重新生成**单一 pre-release baseline migration**；不为旧开发数据增加兼容字段、占位数据、回填或双写逻辑。正式发布并产生需要持续保留的数据后，立即停止 baseline squash，切换为历史 migration 不可修改的 forward-only 模式。
- 新增/调整页面时，必须分别阅读 CordysCRM 对应 PC / Mobile 前端源码；页面结构、布局、字段顺序、操作入口、按钮位置、弹窗/抽屉流程、批量交互与功能显隐以 Cordys 源码为准，不再以旧 MicroMatrix 页面作为视觉基准。
- 禁止直接复制 CordysCRM 的图标、图片、iconfont 等静态资源。
- Web 图标统一使用 `lucide-vue-next`，按需导入组件；禁止新增 emoji、Unicode 符号、Element Plus Icons、Vant 内置图标或复制 Cordys 图标资源。无法可靠对应时使用文字按钮/文字标签。
- 不复制 Cordys 的前端框架或后端技术结构，只迁移业务行为与视觉/交互语义。
- 每个任务完成时，回复中必须给出“当前可手工测试内容”，至少包含访问入口、操作步骤、预期结果；不得只汇报自动化测试。
- PC 与 Mobile 统一维护在 `apps/web` 一个 Vite/Vue 工程内。所有**路由页面**统一放在 `src/views/<业务模块>/`；同一模块的移动端路由页面放在该模块的 `mobile/` 子目录，例如 `src/views/leads/LeadsView.vue` 与 `src/views/leads/mobile/LeadsView.vue`。不再维护 `src/mobile/` 根目录；移动专用 API、组件、Layout、样式分别归入 `src/api`、`src/components`、`src/layouts`、`src/styles`，文件名/组件名使用 `Mobile` 前缀区分。根路由依据当前 viewport 自动选择 PC/Mobile 页面树，不提供 query 参数强制切端。

## 文档正确性与线性维护

- **当前状态只允许一个事实源**：项目当前主线以 `docs/README.md`、`docs/cordys-graph-completion-plan.md` 和对应 `docs/specs/**/tasks.md` 为准；其他审计文档只记录已发生的阶段事实，不得继续声明已经过期的“下一步”或“当前状态”。
- **错误文档直接删除**：当整份文档的大量状态、接口、模型或完成度已经与当前实现相反时，必须删除该文档并同步删除所有引用；禁止仅加“历史/已废弃”提示后继续保留，以免污染全文检索和后续实现判断。
- **历史审计保留事实，不保留过期指令**：历史测试数量、迁移数量、阶段断点可以保留，但必须明确属于当时验收结果；后续阶段已经完成后，旧文档中的“下一执行单元”“当前不可启动”等指令性表述应改成历史流转说明或删除。
- **当前测试数量只写在当前入口**：`docs/README.md` 维护当前回归数量；阶段审计只记录该阶段实际运行结果，不把旧数量更新成新数量，也不让旧数量承担当前状态说明。
- **删除能力必须同步删除文档契约**：代码删除旧 API、兼容路径、模型或页面时，同一任务必须搜索并移除文档中的旧路径、旧状态和旧操作说明；不得让文档继续描述不存在的兼容能力。
- **每个执行单元收尾必须做文档扫描**：至少检查过期的 `下一步/下一执行单元`、错误的 `IN_PROGRESS/VERIFIED`、旧测试数量被误当当前值、已删除 API/模型名称，以及已被新事实替代的整份文档；发现错误当轮修正或删除后才能提交。

## Cordys 对齐执行顺序

每个对齐任务必须按以下顺序推进，禁止只看静态路由或页面名称后直接补菜单、接口或占位功能：

1. **定位目标源码**：先在 `CordysCRM/frontend` 找到对应页面组件和入口；运行页面只用于确认当前实例启用状态及定位目标，不作为实现依据。
2. **跟踪源码接口**：从页面组件沿 API 封装确认接口路径、参数、响应、错误语义和调用时序，不凭界面文案或前端名称猜测后端能力。
3. **阅读后端实现**：沿接口依次检查 Controller、Service、Domain、DTO、Mapper XML，以及权限、数据范围、日志、通知、审批和定时任务等关联实现；这些源码共同构成功能事实。
4. **划分能力归属**：只服务该页面的能力归入业务模块；被多个页面依赖、影响全局导航/权限/配置的能力归入公共基础能力。
5. **公共底座先行**：发现公共依赖时暂停业务页面扩展，先对齐组织架构、角色权限、模块配置、元数据、流程/消息等对应底座，并完成独立验收。
6. **逐页闭环**：公共依赖可用后，再按“页面源码 → API 封装 → 后端语义 → NestJS/Vue 实现 → 运行验证”的闭环逐个对齐业务模块。

左侧菜单是上述结果的投影：只有当前实例启用、当前角色可见且已有对应能力的入口才展示，不能用 Cordys 全量静态路由清单代替实际菜单。

# 开发约定与新对象接入手册

## 工程约定

- **包管理**：pnpm workspace；新依赖用 `pnpm --filter <pkg> add`；根级工具链依赖加 `-w`
- **本地脚本**：根 `scripts/` 与 `apps/api/scripts/` 仅允许作为本地临时开发/验收目录，整个目录不纳入 Git。可长期复用的启动、迁移、Seed 等操作必须写入根 `README.md` 或正式 `package.json` 命令，不以仓库内脚本文件承载。
- **TypeScript**：全仓固定 `~6.0.x`（typescript-eslint 生态上限 <6.1）；API 为 CJS（module NodeNext），前端为 ESM（moduleResolution Bundler）
- **共享代码**：跨端类型/常量/纯函数一律放 `packages/shared/src`；`apps/web` 通过 Vite alias 引用源码，API 引用 CJS 产物（改动后需 `pnpm --filter @micromatrix/shared build` 供 API 使用）
- **提交前自检**：`pnpm build && pnpm typecheck && pnpm lint`。专项验收脚本只允许本地临时维护，不纳入 Git，也不在各级 `package.json` 注册 `smoke` 指令
- **数据库变更**：先对照 Cordys Domain/DDL/Mapper，再改 `schema.prisma`。项目正式发布前，每次准备提交数据库结构变更时都重新从空模型生成一个完整 baseline，只允许 `prisma/migrations/` 保留 **1 个 baseline 目录 + `migration_lock.toml`**；生成后必须审计并补回 Prisma Schema 无法表达的 PostgreSQL 原生结构，再使用全新空 PostgreSQL 执行 `prisma migrate deploy + seed`，并用 `prisma migrate diff` 确认数据库与 `schema.prisma` 无结构差异。完成后手动 `prisma generate`（Prisma 7 不自动生成）。正式发布后禁止继续 squash，所有新变更改用独立 forward-only migration，历史 migration 不再修改。详细流程见 [Prisma Migration 管理规范](./prisma-migration-policy.md)
- **代码风格**：Prettier（无分号/单引号/100 列）；未使用变量以 `_` 前缀豁免；注释只写"为什么"

## 后端约定（NestJS）

- 业务模块放 `apps/api/src/modules/<name>/`：`*.module.ts` / `*.controller.ts` / `*.service.ts` / `dto/`
- 控制器：类级 `@RequirePermissions('menu:xxx')` 控菜单权限，写操作再加动作权限码 + `@LogOperation(module, action)`
- 服务层强制约定：
  - 所有查询带 `tenantId`；列表/详情/改删合并 `DataScopeService.scopeFilter(user)`（约定表上有 ownerId/deptId）
  - 负责人变更走 `resolveOwner()` 并同步 `deptId`
  - 自定义字段经 `MetadataService.validateCustomData()` 清洗校验；VO 返回时合并 `computeFormulas()` 结果
  - 抛业务异常用 `BadRequestException/NotFoundException` 中文消息（前端 `extractErrorMessage` 直接展示）
- 通知统一走 `NotificationsService.notify()`（type: assign/approval/receivable/pool/system + link 路由）
- 审批挂接：直接生效操作前调 `approvals.flowRequired()` 拦截；生效副作用写在 `ApprovalsService.effectApproved()`

## 前端约定（单 Web 工程：PC + Mobile）

- 路由页面必须按业务模块归档到 `apps/web/src/views/<module>/`，禁止继续把 `*View.vue` 散放在 `src/views` 根目录；移动端路由页放同模块 `mobile/` 子目录。系统设置等大模块可继续按子域细分，例如 `src/views/system/enterprise-settings/SettingsView.vue` + `components/`。
- 共用 API 优先放 `src/api/<域>.ts`；移动端专用组合接口同样放在 `src/api/`，文件名体现 `mobile` 语义。跨页面可复用的响应式状态、加载流程、监听/副作用和 UI 行为必须优先抽成 `src/composables/useXxx.ts`；页面只保留页面编排与业务交互，不重复实现相同品牌加载、主题应用、筛选同步等逻辑。
- 前端布局与视觉样式优先使用项目已配置的 UnoCSS + presetWind4 utility；除全局样式、第三方组件无法通过 utility 覆盖的底层规则外，不新增页面级 scoped CSS 来维护普通布局、尺寸、间距、颜色和响应式样式。
- 根路由通过 `src/utils/client-mode.ts` 判断 viewport；桌面进入 PC layout，移动 viewport 进入 Mobile layout。Chrome DevTools 切换设备模式后刷新页面即可验证移动端。
- PC 使用 Element Plus，Mobile 使用 Vant；同一业务模块的两端交互分别以 Cordys 对应端源码为准，不允许为了“组件复用”牺牲布局和功能一致性。
- PC 与 Mobile 的业务图标统一从 `lucide-vue-next` 按需导入，默认使用 `size=20`、`stroke-width=1.8`；仅组件库自身的状态反馈图标可保留。
- 动态能力直接复用 `components/form-engine/`：`DynamicForm`（表单）、`formatFieldValue`（列表列）、`AdvancedFilter`（筛选）
- 权限渲染：`auth.hasPerm('code')` 控制按钮；路由 `meta.perm` + 菜单 `router/menu.ts` 同步维护
- 表单模型与载荷转换模式：扁平 model → `modelToPayload`（cf_* 收进 customData）；行→model 用 `rowToModel`

## 新增业务对象标准接入清单（以"工单 ticket"为例）

1. **Schema**：`schema.prisma` 加模型（必带 `tenantId/ownerId/deptId/customData Json?` + 索引）→ migrate + generate
2. **共享类型**：`packages/shared/src` 加 `TicketVO`；权限树 `permissions.ts` 加 `menu:ticket` + 动作码；`MODULE_LABELS` 注册
3. **系统字段模板**：`apps/api/src/modules/metadata/system-fields.ts` 的 `MODULE_SYSTEM_FIELDS` 加 `ticket: [...]`（key 对应实体列；纯扩展字段用 `cf_` 前缀）
4. **后端模块**：先阅读 Cordys 对应模块的 Controller / Service / Domain / DTO / Mapper XML，再按当前 NestJS 技术栈实现相同业务语义；不要先复制现有 MicroMatrix 模块再反推功能。
5. **前端页面**：同时确认 Cordys PC 与 Mobile 是否存在对应实现；PC 按 Vue 3 + Element Plus、Mobile 按 Vue 3 + Vant 分别复刻其结构与交互。现有 MicroMatrix 页面仅作为可复用底层组件来源，不作为产品行为依据。
6. **可选接入**：
   - 跟进：`FollowUpRecord.targetType` 加枚举值 + `touchTarget` 分支
   - 审批：`APPROVAL_MODULE_LABELS` 注册 + `targetInfo/setBizStatus/effectApproved` 加分支 + 表加 `approvalStatus`
   - 导入导出：优先复用 R2 `SpreadsheetService / ExportTasksService / CrmImportDialog / CrmExportDrawer`，行为以 Cordys 源码为准
7. **收尾**：角色种子加权限码；`scripts/smoke.mjs` 补断言；`docs/cordys-parity.md` 更新状态

## 标讯范围

商业标讯 API（剑鱼/千里马等）**不做、不排期**。现有 `DemoBiddingProvider` + 手动录入 + 转线索即最终范围。不要新增商业 Provider。

## CordysCRM 迁移约定

1. `CordysCRM/` 是功能和业务规则参考目录，不作为 MicroMatrix CRM 的生产运行时依赖。
2. 新增或重构业务模块前，必须同时阅读对应的 Controller、Service、Domain、DTO、Mapper XML，不能只根据页面或接口名称推断功能。
3. 迁移对象是业务语义：状态机、校验、事务、权限、数据范围、日志、通知、审批、定时任务和查询行为；不要机械保留 Spring/MyBatis 的类结构。
4. 现有 NestJS 模块仅在与 Cordys 行为一致时复用；如果旧实现为了早期页面演示而简化、命名或接口边界不一致，应直接重构或删除，禁止为了兼容旧实现而偏离 Cordys。
5. 复杂列表、统计和高级筛选必须检查 Mapper XML，因为很多真实业务条件不在 Java Domain 类里。
6. 每个模块完成后必须更新 `docs/cordys-parity.md`，并通过 build/typecheck/lint 与对应 smoke/integration test。
7. Cordys 自身的产品授权与版本区分机制不属于 MicroMatrix CRM 的业务需求。
