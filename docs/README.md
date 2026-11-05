# 微矩阵 CRM（招生 CRM）项目文档索引

当前项目名称为「微矩阵 CRM（MicroMatrix CRM）」，产品定位为通用招生 CRM，Git 仓库标识为 `micromatrix-crm`。

本文档索引只列出当前代码仍在使用的产品能力、工程规范和运行维护文档。历史实施过程、临时审计及已结束的任务清单不作为当前开发依据；需要追溯时使用 Git 历史。

| 文档                                                       | 用途                                             |
| ---------------------------------------------------------- | ------------------------------------------------ |
| [architecture.md](./architecture.md)                       | 当前系统架构、业务边界与关键技术决策             |
| [conventions.md](./conventions.md)                         | 当前开发约定与新增能力接入规则                   |
| [api.md](./api.md)                                         | Swagger / OpenAPI 使用与鉴权约定                 |
| [external-events.md](./external-events.md)                 | 外部事件配置、调用、幂等与审计                   |
| [prisma-migration-policy.md](./prisma-migration-policy.md) | Prisma ORM 8 contract / migration graph 管理规范 |
| [docker-release.md](./docker-release.md)                   | Docker 镜像、Migration 与生产 Compose 发布流程   |
| [specs/README.md](./specs/README.md)                       | 当前领域需求与设计规格索引                       |

## 当前事实源

- 业务主线：线索 → 线索池/分配/跟进 → 客户 → 客户公海/持续跟进。
- 平台能力：动态表单、数据源、首页分析、组织权限、通知公告、企业集成、日志和个人 API Key。
- 独立联系人模块、审批模块及传统销售交易链均不属于当前产品；具体边界见[招生 CRM 规格](./specs/admissions-crm-transformation/requirements.md)。
- PC 与 Mobile 是两个独立 Vue 应用：`apps/web` 使用 Element Plus，`apps/mobile` 使用 Vant 4 + UnoCSS presetWind4；浏览器公共能力位于 `packages/frontend-shared`。
- 数据模型唯一事实源为 `apps/api/src/prisma/contract.prisma`；Prisma ORM 8 migration graph 位于 `apps/api/migrations/`。
- 当前代码、自动化测试和 Prisma contract 是行为事实源；文档不得替代代码，也不得保留已经结束的执行状态清单。

根目录 [README.md](../README.md) 是项目入口，项目维护文档统一放在 `docs/`。
