# CordysCRM 界面复刻约定

- `CordysCRM/` 是只读业务与交互参考源码，不进入 MicroMatrix Git 版本库。
- CordysCRM 源代码是当前复刻工作的第一事实来源。现有 MicroMatrix 页面、接口和业务规则只在与 Cordys 源码一致时保留；发生冲突时允许直接删除、替换或重构旧实现，不以“兼容旧页面/旧接口”为优先目标。
- 新增/调整页面时，必须分别阅读 CordysCRM 对应 PC / Mobile 前端源码；页面结构、布局、字段顺序、操作入口、按钮位置、弹窗/抽屉流程、批量交互与功能显隐以 Cordys 源码为准，不再以旧 MicroMatrix 页面作为视觉基准。
- 禁止直接复制 CordysCRM 的图标、图片、iconfont 等静态资源。
- 图标优先选择 Element Plus Icons 或项目已有开源图标中的近似项；无法可靠对应时使用文字按钮/文字标签占位，后续人工替换。
- 不复制 Cordys 的前端框架或后端技术结构，只迁移业务行为与视觉/交互语义。
- 每个任务完成时，回复中必须给出“当前可手工测试内容”，至少包含访问入口、操作步骤、预期结果；不得只汇报自动化测试。
- PC 与 Mobile 统一维护在 `apps/web` 一个 Vite/Vue 工程内：PC 页面在 `src/views`，Mobile 页面在 `src/mobile`；根路由依据当前 viewport 自动选择 PC/Mobile 页面树，不提供 query 参数强制切端。

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
- **TypeScript**：全仓固定 `~6.0.x`（typescript-eslint 生态上限 <6.1）；API 为 CJS（module NodeNext），前端为 ESM（moduleResolution Bundler）
- **共享代码**：跨端类型/常量/纯函数一律放 `packages/shared/src`；`apps/web` 通过 Vite alias 引用源码，API 引用 CJS 产物（改动后需 `pnpm --filter @micromatrix/shared build` 供 API 使用）
- **提交前自检**：`pnpm build && pnpm typecheck && pnpm lint`；功能回归 `pnpm smoke`（API 需运行）
- **数据库变更**：只改 `schema.prisma` → `prisma migrate dev --name <名称>` → **必须手动** `prisma generate`（Prisma 7 不自动生成）→ 提交 migration 目录
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

- PC 页面放 `apps/web/src/views/`；Mobile 页面放 `apps/web/src/mobile/views/`；共用 API 优先放 `src/api/<域>.ts`，仅移动端组合接口可放 `src/mobile/api/`。
- 根路由通过 `src/utils/client-mode.ts` 判断 viewport；桌面进入 PC layout，移动 viewport 进入 Mobile layout。Chrome DevTools 切换设备模式后刷新页面即可验证移动端。
- PC 使用 Element Plus，Mobile 使用 Vant；同一业务模块的两端交互分别以 Cordys 对应端源码为准，不允许为了“组件复用”牺牲布局和功能一致性。
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
