# 微矩阵 CRM（MicroMatrix CRM）

当前 `master` 已收敛为通用招生 CRM：以线索获取、池化分配、跟进、转客户和客户持续跟进为主线，同时保留动态表单、审批、通知、组织权限、企业集成、导入导出和开放 API。

项目内 `CordysCRM/` 只作为业务语义和交互参考，不是运行时依赖，也不再要求恢复已从当前产品删除的完整销售交易链。

## 当前业务范围

- 线索：线索池、领取/分配、负责人、阶段、判重、SLA、导入导出、转客户。
- 客户：客户、公海、联系人、负责人历史、跟进记录与跟进计划。
- 元数据：模块表单、动态字段、字段联动、显隐、唯一性、附件和列表/筛选能力。
- 首页分析：渠道、阶段漏斗、负责人/部门等招生统计。
- 外部事件：API Key 调用、幂等 Inbox、严格字段匹配、Customer 更新或 Lead 自动转换。
- 平台能力：审批、通知/公告、组织/角色/成员、日志、企业设置、企业微信/钉钉/飞书。

商机、产品、报价、合同、回款、发票、订单、标讯等旧交易链已从当前 `master` 的产品入口、生产 API 和 Prisma contract 中退出。

## 技术栈

| 层 | 选型 |
| --- | --- |
| PC | Vue 3 + TypeScript + Vite + Element Plus |
| Mobile | Vue 3 + Vite + Vant 4 + UnoCSS presetWind4 |
| 前端共享 | `packages/frontend-shared` + `packages/shared` |
| API | NestJS 11 + Prisma ORM 8 PostgreSQL runtime |
| 数据库 | PostgreSQL 18 |
| 缓存/实时/队列 | Redis + Pub/Sub + BullMQ |
| 工程 | Node `>=25 <26` + pnpm `11.25.0` + TypeScript `7.0.2` |

## 目录结构

```text
micromatrix-crm/
├── apps/
│   ├── api/                     # NestJS API + worker + Prisma 8 contract/runtime
│   ├── web/                     # PC Vue 应用
│   └── mobile/                  # Mobile Vue/Vant 应用，生产路径 /mobile/
├── packages/
│   ├── shared/                  # 前后端共享类型/权限/纯领域逻辑
│   ├── frontend-shared/         # PC/Mobile HTTP、Token、设备等浏览器公共能力
│   └── migrate/                 # 生产 Migration runtime
├── docs/
├── docker/
├── docker-compose.dev.yml
└── docker-compose.yml
```

Prisma 8 的当前结构：

```text
apps/api/
├── prisma.config.ts
├── migrations/
└── src/
    ├── prisma/
    │   ├── contract.prisma
    │   ├── contract.json
    │   ├── contract.d.ts
    │   ├── db.ts
    │   └── seed*.ts
    ├── prisma.service.ts
    └── prisma.module.ts
```

## 快速开始

```bash
pnpm install
cp apps/api/.env.example apps/api/.env

# 本地 PostgreSQL / Redis
pnpm dev:infra

# 应用当前 Prisma 8 migration graph
pnpm db:deploy

# 初始化基础数据；空库只创建默认企业、根部门、管理员角色和 admin@demo.com；已有用户时仅校准默认 Pro 套餐
pnpm --filter @micromatrix/api run db:seed

# 启动 API / PC / Mobile
pnpm dev
```

默认开发端口：API `3000`、PC `5173`、Mobile `5174`。

数据库模型发生变化时先修改 `apps/api/src/prisma/contract.prisma`，再按 [Prisma ORM 8 Migration 管理规范](./docs/prisma-migration-policy.md) 生成和验证 forward migration。不要重新引入 Prisma 7 `schema.prisma`、generated Client 或 `db push` 工作流。

## 常用验证

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm --filter @micromatrix/api test:rules
pnpm db:verify-migrations
pnpm db:status
pnpm db:verify
```

当前 API rules 基线为 **362/362 pass**。Mobile build/typecheck 会同时执行 Vant + UnoCSS 规范门禁。

## Docker Release

生产发布使用 API、Migration、Web 三类镜像；worker 复用 API 镜像。Web 镜像同时包含 PC `apps/web/dist` 和 Mobile `apps/mobile/dist`。

发布通过 `v*.*.*` Git Tag 触发 GitHub Actions：

```bash
git tag v0.0.1
git push origin v0.0.1
```

本地完整发布 Smoke：

```bash
pnpm smoke:docker-release
```

详细说明见 [Docker 发布文档](./docs/docker-release.md)。

## 文档

- [文档索引](./docs/README.md)
- [当前架构](./docs/architecture.md)
- [开发约定](./docs/conventions.md)
- [Prisma ORM 8 Migration 规范](./docs/prisma-migration-policy.md)
- [招生 CRM 主线规格](./docs/specs/admissions-crm-transformation/requirements.md)
- [当前任务与验收](./docs/specs/admissions-crm-transformation/tasks.md)

历史执行计划、已删除交易链规格和旧 Prisma 迁移阶段文档已从当前文档树清理；需要历史细节时使用 Git 记录追溯。
