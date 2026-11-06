# 招生CRM 项目文档索引

当前项目为面向招生团队的通用 CRM，项目名称为「招生CRM」，Git 仓库名为 `micromatrix-crm`。

本目录只维护当前产品行为、长期工程约束和运行维护说明。历史任务过程、临时审计及已完成的实施清单不作为当前开发依据，需要追溯时使用 Git 历史。

| 文档                                                       | 用途                                           |
| ---------------------------------------------------------- | ---------------------------------------------- |
| [architecture.md](./architecture.md)                       | 当前系统边界、架构分层与关键技术事实           |
| [conventions.md](./conventions.md)                         | 开发约定、强制自测验收、文档维护和能力接入规则 |
| [api.md](./api.md)                                         | Swagger、认证方式与 API 契约原则               |
| [external-events.md](./external-events.md)                 | 外部事件配置、调用、字段映射、幂等和审计       |
| [prisma-migration-policy.md](./prisma-migration-policy.md) | Prisma ORM 8 contract 与 migration graph 管理  |
| [docker-release.md](./docker-release.md)                   | Docker 镜像、生产 Compose 与发布流程           |
| [specs/README.md](./specs/README.md)                       | 当前业务与平台领域规格索引                     |

## 当前事实源

- 核心业务流程：线索 → 线索池/分配/跟进 → 客户 → 客户公海/持续跟进。
- 联系人不是独立业务资源；家长姓名、电话等信息保存在对应业务表单中。
- 审批能力保留，但当前不参与招生主流程自动触发；不能成为线索、客户或外部事件的默认前置环节。
- 主导航当前包含首页、线索、客户和系统；顶部导航包含记录/计划与消息通知。
- PC 与 Mobile H5 是两个独立 Vue 应用：`apps/web` 使用 Element Plus，`apps/mobile` 使用 Vant 4 + UnoCSS presetWind4；浏览器公共能力位于 `packages/frontend-shared`。
- 数据模型唯一事实源为 `apps/api/src/prisma/contract.prisma`；Prisma ORM 8 migration graph 位于 `apps/api/migrations/`。
- 当前代码、自动化测试和 Prisma contract 是行为事实源。文档用于解释稳定规则，不替代实现，也不记录容易过期的构建状态、迁移数量或临时环境信息。

根目录 [README.md](../README.md) 是项目入口；项目维护文档统一放在 `docs/`。
