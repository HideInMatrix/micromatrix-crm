# 项目文档索引

当前 `master` 已从完整销售 CRM 收敛为通用招生 CRM。文档只保留对当前代码、部署、数据库迁移和仍在运行的专项能力有维护价值的内容；已物理删除的交易链、旧 Prisma 迁移阶段和已结束的执行计划不再保留。

| 文档                                                                           | 用途                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| [architecture.md](./architecture.md)                                           | 当前系统架构、数据边界与关键技术决策                |
| [conventions.md](./conventions.md)                                             | 当前开发约定与新增能力接入规则                      |
| [prisma-migration-policy.md](./prisma-migration-policy.md)                     | Prisma ORM 8 contract / migration graph 管理规范    |
| [docker-release.md](./docker-release.md)                                       | API / Migration / Web 镜像与生产 Compose 发布流程   |
| [api.md](./api.md)                                                             | Swagger / 开放 API 使用说明                         |
| [cordys-ui-design-guide.md](./cordys-ui-design-guide.md)                       | PC 端视觉、布局与交互参考基线                       |
| [cordys-mobile-refactor-guide.md](./cordys-mobile-refactor-guide.md)           | Mobile / 企业微信容器页面设计与实现约束             |
| [specs/README.md](./specs/README.md)                                           | 仍对应当前代码能力的需求与设计规格索引              |
| [specs/admissions-crm-transformation/](./specs/admissions-crm-transformation/) | 当前招生 CRM 主线需求、设计、验收与外部财务集成边界 |

## 当前事实源

- 当前业务主线：线索 → 客户，保留联系人、线索池、客户公海、跟进记录/计划、动态表单、首页分析、审批、通知和企业集成。
- 已从 `master` 物理删除旧销售交易链：商机、产品、报价、合同、回款、发票、订单、标讯等不再属于当前产品入口或数据库 contract。
- PC 与 Mobile 是两个独立 Vue 应用：`apps/web` 使用 Element Plus；`apps/mobile` 使用 Vant 4 + UnoCSS presetWind4；浏览器公共能力位于 `packages/frontend-shared`。
- 数据模型唯一事实源为 `apps/api/src/prisma/contract.prisma`；`contract emit` 生成 `apps/api/src/prisma/contract.json` 与 `contract.d.ts`。
- Prisma ORM 8 应用 client 只由 `apps/api/src/prisma/db.ts` 创建一次；NestJS 通过 `apps/api/src/prisma.service.ts` / `prisma.module.ts` 注入。
- 正式 migration graph 位于 `apps/api/migrations/`，不得把旧 Prisma 7 `schema.prisma` / `prisma/migrations` 工作流重新引入。
- 当前任务状态只以 [ADMISSIONS-001 tasks](./specs/admissions-crm-transformation/tasks.md) 为准；已完成专项不再保留独立 `tasks.md`，长期文档统一收敛为领域 `requirements/design`，实施过程通过 Git 历史追溯。

根目录只保留项目入口 [README.md](../README.md)；项目级维护文档统一放在 `docs/`。
