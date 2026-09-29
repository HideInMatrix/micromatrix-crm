# 开发约定

## 1. 产品边界与参考源

- 当前 `master` 的产品边界以招生 CRM 规格、现有代码和自动化测试为准。
- `CordysCRM/` 只用于确认仍保留能力的业务语义、PC/Mobile 交互和查询规则，不作为运行时依赖。
- 不因为 Cordys 存在某个模块就自动恢复该模块。商机、产品、报价、合同、回款、发票、订单、标讯等旧交易链只有在新的产品需求明确重新立项后才能进入当前主线。
- 对 Cordys 行为做迁移时，应同时阅读对应 Controller / Service / Domain / DTO / Mapper / 前端页面；迁移的是业务语义，不复制 Spring/MyBatis 技术结构或静态资源。

## 2. 文档维护

- 当前文档入口是 `docs/README.md`；当前主线任务入口是 `docs/specs/admissions-crm-transformation/tasks.md`。
- 已删除能力必须在同一任务中清理代码入口、类型、测试、部署引用和文档契约。
- 整份文档如果已经与当前架构相反，直接删除并更新引用；不要只加“已废弃”标题继续污染全文检索。
- 已完成专项不再长期保留独立 `tasks.md`；把仍有维护价值的约束合并进稳定领域 `requirements/design`，实施过程与历史验收结果交给 Git 追溯。
- 需要历史实现、旧测试数量或旧迁移过程时优先使用 Git 历史，不新增长期过程日志。

## 3. 工程工具链

- Node.js：`>=25 <26`。
- pnpm：`11.25.0`，使用 workspace。
- TypeScript：`7.0.2`。
- PC：`apps/web`，Vue 3 + Vite + Element Plus。
- Mobile：`apps/mobile`，Vue 3 + Vite + Vant 4 + UnoCSS presetWind4。
- `packages/shared` 只放 API/前端都能消费的纯 TypeScript 类型、枚举、权限和领域逻辑，不引入 DOM/Vue/Axios。
- `packages/frontend-shared` 放 PC/Mobile 共用的浏览器 HTTP、Token、设备判断等能力。
- 提交前按改动范围执行 typecheck、tests、build、ESLint 和 `git diff --check`。

## 4. Prisma ORM 8

- 数据模型唯一事实源：`apps/api/src/prisma/contract.prisma`。
- `prisma contract emit` 产物直接位于 `apps/api/src/prisma/contract.json` 与 `contract.d.ts`。
- 生产运行时唯一 client 创建点：`apps/api/src/prisma/db.ts`。
- `apps/api/src/prisma.service.ts` 只做 NestJS DI / lifecycle wrapper，不自行创建 client。
- 正式 migration graph：`apps/api/migrations/`；结构变化只新增 forward migration。
- 禁止重新引入 `schema.prisma`、Prisma Client class、`extends PrismaClient`、生产 client factory、`src/prisma/generated/` 或 Prisma 7 `db push` 工作流。
- 详细规则见 [Prisma ORM 8 Migration 管理规范](./prisma-migration-policy.md)。

## 5. NestJS 后端

- 业务模块放在 `apps/api/src/modules/<domain>/`；跨域基础能力放在 `src/common`、`src/prisma`、`src/testing` 等明确公共边界。
- 除显式 `@Public` 外统一经过 AuthGuard；功能权限使用 canonical 权限码，写操作同时保留审计日志。
- 所有业务查询必须保持 tenant 隔离；列表、详情、更新、删除同时应用目标权限对应的数据范围。
- 多角色数据范围只能合并真正拥有目标权限的角色，不能用无关角色扩大数据边界。
- 业务异常使用明确的 NestJS HTTP exception；对外错误不得泄露数据库、Secret 或内部堆栈。
- Redis 是缓存、Pub/Sub、协调和 BullMQ transport，不是业务真相源；业务状态和幂等状态存 PostgreSQL。

## 6. 元数据与动态表单

- 模块表单、字段定义、Field/Blob 值、显隐/联动、唯一性和附件生命周期统一复用 Metadata 能力。
- 固定业务列承担 tenant、owner、pool、阶段、状态、索引和关联；可配置扩展值进入统一 Field / FieldBlob 体系。
- 跨模块字段复制只能使用显式 formLink；禁止靠字段同名、`cf_` 前缀或运行时猜测自动复制。
- 新字段必须考虑 PC/Mobile 可见性、列表展示、筛选能力、唯一性范围和导入导出语义。

## 7. PC 前端

- 路由 View 主要负责页面编排；稳定业务区域拆成组件，加载/筛选/表单状态优先抽到 composable。
- API 调用统一进入 `src/api/` 或共享前端 API 层，不在多个 View 重复 HTTP 协议。
- PC 使用 Element Plus；模块配置和页面入口只展示真实存在的路由与业务能力。
- 普通布局、间距和响应式优先使用现有 utility / design token；不要为简单布局新增大量一次性 CSS。
- Cordys UI 参考规则见 [PC UI 设计基线](./cordys-ui-design-guide.md)。

## 8. Mobile 前端

- `apps/mobile` 是独立应用，不再把 Mobile 页面塞回 `apps/web`。
- 使用 Vant 4 + UnoCSS presetWind4；选择、Popup、Dialog、Tabbar 等优先使用 Vant 原生组件。
- 一级页面使用 Mobile Tabbar；详情/新建/编辑等深层页面按当前路由规则隐藏 Tabbar。
- 企业微信容器中的重复 Header、返回按钮等由统一环境判断控制，不能在每个页面复制 UA 判断。
- Mobile 搜索/二级选择/动态表单要复用共享协议，不硬编码字段。
- 详细边界见 [Mobile 重构指南](./cordys-mobile-refactor-guide.md)。

## 9. 新业务能力接入

新增业务能力前先回答三个问题：是否属于当前招生 CRM 产品边界、是否已有可复用的元数据/权限/池/跟进能力、是否会引入新的数据库结构。

一个新的持久化业务资源通常需要同步考虑：

1. Prisma 8 contract + forward migration。
2. shared DTO / enum / 权限码。
3. tenant / owner / department / DataScope。
4. Metadata 表单字段和动态值边界。
5. NestJS module / controller / service / DTO。
6. PC 与 Mobile 是否都需要入口以及各自交互。
7. 导入导出、通知、审批、日志、外部 API 是否需要接入。
8. 数据库 integration test、权限/数据范围测试和 UI smoke。

如果能力只服务线索或客户配置，应优先进入现有“模块配置 → Lead / Customer”，不要另建没有独立业务意义的设置模块。

## 10. 完成标准

- 代码、路由、导航、权限、数据库 contract 和文档必须描述同一产品边界。
- 自动化门禁通过不代表真实客户端验收可以省略；企业微信等 Provider 容器行为仍需要真实客户端 smoke。
- 对 destructive migration，开发库验证不能替代正式环境发布前的只读 precheck。
- 不提交与当前任务无关的历史工作区修改，也不通过回滚覆盖已有未提交工作。
