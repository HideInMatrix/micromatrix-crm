# 招生CRM

招生CRM 是面向招生团队的通用 CRM，以线索获取、分配、跟进、转化客户和客户持续跟进为核心流程。学校、课程、报名和缴费等具体业务信息通过动态表单与外部系统集成承载，不固化为 CRM 的销售交易模型。

当前项目名称为「招生CRM」，Git 仓库名为 `micromatrix-crm`。

## 产品范围

- **线索**：线索创建、负责人分配、线索池、判重、跟进超时、导入导出和转化客户。不再使用固定系统阶段/状态字段。
- **客户**：客户资料、负责人、客户公海、跟进记录和跟进计划；客户完结条件由管理员配置的字段及命中值判断。
- **动态表单**：线索、客户及跟进表单的动态字段、数据源、显隐联动、唯一性、列表和筛选配置。
- **招生分析**：线索与客户统计、渠道来源、转化趋势、负责人/部门表现及自定义字段分析。
- **外部事件**：通过 API Key 接收外部业务事件，按已配置的目标模块、动作和字段映射执行，并提供幂等保护与审计。
- **平台能力**：组织、成员、角色权限、通知、公告、日志、企业设置、企业微信/钉钉/飞书集成和个人 API Key。

联系人不再作为独立业务模块，家长姓名和电话等信息属于线索字段。审批能力保留，但当前不参与招生主流程自动触发；不得成为线索、客户或外部事件的默认前置环节。商机、产品、报价、合同、回款、发票、订单和标讯等传统销售交易链不属于当前产品范围。

## 技术栈

| 层级       | 技术                                                   |
| ---------- | ------------------------------------------------------ |
| PC         | Vue 3、TypeScript、Vite、Element Plus                  |
| Mobile H5  | Vue 3、Vite、Vant 4、UnoCSS presetWind4                |
| 前端共享   | `packages/frontend-shared`、`packages/shared`          |
| API        | NestJS 11、Prisma ORM 8                                |
| 数据库     | PostgreSQL 18                                          |
| 缓存与任务 | Redis、Pub/Sub、BullMQ、独立 Worker                    |
| 工程       | Node.js `>=25 <26`、pnpm `11.25.0`、TypeScript `7.0.2` |

## 目录结构

```text
micromatrix-crm/
├── apps/
│   ├── api/                 # NestJS API、Worker、Prisma contract/runtime
│   ├── web/                 # PC 管理端
│   └── mobile/              # 独立 Mobile H5，生产路径 /mobile/
├── packages/
│   ├── shared/              # 前后端共享类型、权限与领域逻辑
│   ├── frontend-shared/     # PC/Mobile 共用浏览器能力
│   └── migrate/             # 生产 Migration runtime
├── docs/                    # 项目与领域文档
├── docker/                  # Dockerfile、Nginx 与发布脚本
├── docker-compose.dev.yml
└── docker-compose.yml
```

Prisma ORM 8 的主要文件：

```text
apps/api/
├── prisma.config.ts
├── migrations/
└── src/prisma/
    ├── contract.prisma     # 数据模型唯一事实源
    ├── contract.json       # contract emit 产物
    ├── contract.d.ts       # contract emit 产物
    ├── db.ts               # 进程级数据库 client
    └── seed*.ts
```

## 本地开发

环境要求：Node.js 25、pnpm 11.25.0、Docker。

```bash
pnpm install
cp apps/api/.env.example apps/api/.env

# 启动本地 PostgreSQL / Redis
pnpm dev:infra

# 应用 Prisma ORM 8 migration graph，并初始化基础数据
pnpm db:deploy
pnpm --filter @micromatrix/api run db:seed

# 启动 API、PC 与 Mobile
pnpm dev
```

默认端口：API `3000`、PC `5173`、Mobile `5174`。本地数据库连接参数应与 `apps/api/.env` 和 `docker-compose.dev.yml` 保持一致。

数据库模型变更先修改 `apps/api/src/prisma/contract.prisma`，再按 [Prisma ORM 8 Migration 规范](./docs/prisma-migration-policy.md)生成并验证 forward migration。不要重新引入 Prisma 7 `schema.prisma`、generated Client 或 `db push` 工作流。

## 常用验证

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm prisma:emit
pnpm db:verify-migrations
pnpm db:status
pnpm db:verify
```

Mobile 的 typecheck/build 会同时执行 Vant + UnoCSS 规范检查。

## Docker 发布

生产发布使用 API、Migration、Web 三类镜像；Worker 复用 API 镜像，Web 镜像同时包含 PC 与 Mobile 静态产物。

```bash
VERSION=1.0.0
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"
```

Git Tag 触发 GitHub Actions 构建并推送镜像，不会自动更新生产容器。生产环境仍需在 Compose/1Panel 中指定发布版本、拉取镜像并重建服务。详见 [Docker 发布文档](./docs/docker-release.md)。

## 文档

- [文档索引](./docs/README.md)
- [系统架构](./docs/architecture.md)
- [开发约定](./docs/conventions.md)
- [API 使用指南](./docs/api.md)
- [外部事件](./docs/external-events.md)
- [Prisma ORM 8 Migration 规范](./docs/prisma-migration-policy.md)
- [Docker 发布](./docs/docker-release.md)
- [领域规格索引](./docs/specs/README.md)
