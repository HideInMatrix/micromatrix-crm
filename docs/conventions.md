# CordysCRM 界面复刻约定

- `CordysCRM/` 是只读业务与交互参考源码，不进入 MicroMatrix Git 版本库。
- 新增/调整页面时，优先对齐 CordysCRM 的页面结构、字段顺序、操作入口、弹窗/抽屉流程和列表批量交互。
- 禁止直接复制 CordysCRM 的图标、图片、iconfont 等静态资源。
- 图标优先选择 Element Plus Icons 或项目已有开源图标中的近似项；无法可靠对应时使用文字按钮/文字标签占位，后续人工替换。
- 不复制 Cordys 的前端框架或后端技术结构，只迁移业务行为与视觉/交互语义。

# 开发约定与新对象接入手册

## 工程约定

- **包管理**：pnpm workspace；新依赖用 `pnpm --filter <pkg> add`；根级工具链依赖加 `-w`
- **TypeScript**：全仓固定 `~6.0.x`（typescript-eslint 生态上限 <6.1）；API 为 CJS（module NodeNext），前端为 ESM（moduleResolution Bundler）
- **共享代码**：跨端类型/常量/纯函数一律放 `packages/shared/src`；web/mobile 通过 Vite alias 引用源码，API 引用 CJS 产物（改动后需 `pnpm --filter @micromatrix/shared build` 供 API 使用）
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

## 前端约定（Web）

- 页面放 `apps/web/src/views/`，API 封装放 `src/api/<域>.ts`（返回 `http.get<VO>` 泛型）
- 动态能力直接复用 `components/form-engine/`：`DynamicForm`（表单）、`formatFieldValue`（列表列）、`AdvancedFilter`（筛选）
- 权限渲染：`auth.hasPerm('code')` 控制按钮；路由 `meta.perm` + 菜单 `router/menu.ts` 同步维护
- 表单模型与载荷转换模式：扁平 model → `modelToPayload`（cf_* 收进 customData）；行→model 用 `rowToModel`

## 新增业务对象标准接入清单（以"工单 ticket"为例）

1. **Schema**：`schema.prisma` 加模型（必带 `tenantId/ownerId/deptId/customData Json?` + 索引）→ migrate + generate
2. **共享类型**：`packages/shared/src` 加 `TicketVO`；权限树 `permissions.ts` 加 `menu:ticket` + 动作码；`MODULE_LABELS` 注册
3. **系统字段模板**：`apps/api/src/modules/metadata/system-fields.ts` 的 `MODULE_SYSTEM_FIELDS` 加 `ticket: [...]`（key 对应实体列；纯扩展字段用 `cf_` 前缀）
4. **后端模块**：复制既有模块骨架（推荐参照 `modules/leads`），实现 CRUD + 数据范围 + 元数据校验 + 公式 VO；注册进 `app.module.ts`
5. **前端页面**：复制 `views/LeadsView.vue` 骨架改造（动态列 + DynamicForm + AdvancedFilter）；`api/` 加封装；路由与菜单登记
6. **可选接入**：
   - 跟进：`FollowUpRecord.targetType` 加枚举值 + `touchTarget` 分支
   - 审批：`APPROVAL_MODULE_LABELS` 注册 + `targetInfo/setBizStatus/effectApproved` 加分支 + 表加 `approvalStatus`
   - 导入导出：参照 leads 的 `exportCsv/bulkImport`
7. **收尾**：角色种子加权限码；`scripts/smoke.mjs` 补断言；`docs/cordys-parity.md` 更新状态

## 标讯范围

商业标讯 API（剑鱼/千里马等）**不做、不排期**。现有 `DemoBiddingProvider` + 手动录入 + 转线索即最终范围。不要新增商业 Provider。

## CordysCRM 迁移约定

1. `CordysCRM/` 是功能和业务规则参考目录，不作为 MicroMatrix CRM 的生产运行时依赖。
2. 新增或重构业务模块前，必须同时阅读对应的 Controller、Service、Domain、DTO、Mapper XML，不能只根据页面或接口名称推断功能。
3. 迁移对象是业务语义：状态机、校验、事务、权限、数据范围、日志、通知、审批、定时任务和查询行为；不要机械保留 Spring/MyBatis 的类结构。
4. 现有 NestJS 模块优先做差异重构，禁止为了“对照 Cordys”再建立一套平行实现。
5. 复杂列表、统计和高级筛选必须检查 Mapper XML，因为很多真实业务条件不在 Java Domain 类里。
6. 每个模块完成后必须更新 `docs/cordys-parity.md`，并通过 build/typecheck/lint 与对应 smoke/integration test。
7. Cordys 自身的产品授权与版本区分机制不属于 MicroMatrix CRM 的业务需求。
