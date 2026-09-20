# 项目文档索引

| 文档                                                                 | 内容                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [cordys-parity.md](./cordys-parity.md)                               | 当前 CordysCRM 功能一致性总表与迁移状态                                        |
| [cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md)   | Wave 2 执行记录；W2.1-W2.5 已验收，含流程设置版本底座与 Vue Flow 设计器        |
| [cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md) | 用户功能图收口计划；W3.4.0～W3.4.5 已全部验收，当前功能图状态为 `VERIFIED`     |
| [cordys-menu-parity.md](./cordys-menu-parity.md)                     | 当前 Cordys 实例经模块开关与角色权限过滤后的实际左侧菜单基线                   |
| [cordys-ui-design-guide.md](./cordys-ui-design-guide.md)             | CordysCRM PC / Mobile 视觉、布局、交互与 Vant 4 移动重构设计基线               |
| [alignment-log.md](./alignment-log.md)                               | 对齐探测与实施证据：公共底座、Wave 2、W3.1～W3.7 与 Docker 发布演进            |
| [architecture.md](./architecture.md)                                 | 架构设计与关键技术决策记录（含踩坑记录）                                       |
| [conventions.md](./conventions.md)                                   | 开发约定：新增业务对象的标准接入手册                                           |
| [prisma-migration-policy.md](./prisma-migration-policy.md)           | Prisma 开发期单 baseline 合并与正式发布后 forward-only 迁移规范                |
| [specs/prisma8-migration/](./specs/prisma8-migration/)               | PRISMA8-001：Prisma 8 contract/runtime、migration handoff 与最终验收记录        |
| [specs/prisma8-post-migration-cleanup/](./specs/prisma8-post-migration-cleanup/) | PRISMA8-002：Prisma 8 compatibility cleanup、时间/类型治理与 canonicalization 验收 |
| [specs/prisma8-generated-contract-verification/](./specs/prisma8-generated-contract-verification/) | PRISMA8-003：Prisma 8 generated contract / traditional client assumption 核实 |
| [api.md](./api.md)                                                   | 接口文档（Swagger）使用指南与导入方式                                          |
| [docker-release.md](./docker-release.md)                             | API/Migration/Web 镜像、生产 Compose、独立导出 worker 与 `v*.*.*` Tag 自动发布 |
| [cordys-deferred-backlog.md](./cordys-deferred-backlog.md)           | 已发现但暂缓实施的 Cordys 能力与数据模型缺口长期台账                           |
| [project-progress.md](./project-progress.md)                         | 当前 Git/里程碑/执行指针、剩余工作与整体收口路线                               |
| [specs/README.md](./specs/README.md)                                 | 需求、技术设计与实施任务规格索引                                               |

## 快速上下文

- 项目定位：以项目内 `CordysCRM/` 作为功能、业务规则和交互行为参考基准，使用 NestJS + Prisma + Vue 独立实现，先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/本地验收）
- 当前主线：既有 Cordys 功能主线与 **TOOLCHAIN-001 / UI-001 / DB-007 / DB-008 / DB-015A / DB-015B / PRISMA8-001 / PRISMA8-002 / PRISMA8-003** 均已完成；PRISMA8-003 官方架构复核确认当前 contract runtime 即 Prisma 8 正式形态，不实施 traditional generated-client 回退；DB-023 继续 `DEFERRED`。
- 当前 Prisma 8 migration graph 以 `apps/api/migrations/` 为 canonical：`20260918T0338_baseline`（672 operations）+ `20260918T0826_timestamp_absolute_instants`（126）+ `20260918T0923_varchar_text_length_constraints`（952）+ `20260920T0347_canonical_check_constraint_names`（476），合计 **2226 operations**；后续结构变化只新增 forward migration。
- 当前发布基线：`v0.0.13` 指向 `63e846f`；项目 packageManager 已统一为 pnpm 11.25.0，TOOLCHAIN-001 已完成本地/CI/Docker 三端迁移与完整 Docker release smoke，并正式封板为 `VERIFIED`。
- 整体剩余范围与完成标准见 [project-progress.md](./project-progress.md)；DataEase provider/token 继续由 DB-023 deferred，AI/License/MCP/商业标讯等明确排除项不计入当前 CRM 核心完成标准。
- 数据模型唯一真相：`apps/api/prisma/contract.prisma`；Prisma 8 generated contract 位于 `apps/api/src/prisma/generated/`，migration graph 位于 `apps/api/migrations/`。
- 启动方式与演示账号见根目录 [README.md](../README.md)
- 文档归档约定：根目录只保留项目入口 `README.md`；其余项目文档统一放在 `docs/`，上游 `CordysCRM/` 自带文档保持原位
