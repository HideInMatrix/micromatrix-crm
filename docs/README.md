# 项目文档索引

| 文档                                                                 | 内容                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [cordys-parity.md](./cordys-parity.md)                               | 当前 CordysCRM 功能一致性总表与迁移状态                                      |
| [cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md)   | Wave 2 执行记录；W2.1-W2.5 已验收，含流程设置版本底座与 Vue Flow 设计器      |
| [cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md) | 用户功能图收口计划；W3.4.0～W3.4.5 已全部验收，当前功能图状态为 `VERIFIED` |
| [cordys-menu-parity.md](./cordys-menu-parity.md)                     | 当前 Cordys 实例经模块开关与角色权限过滤后的实际左侧菜单基线                 |
| [alignment-log.md](./alignment-log.md)                               | 对齐探测与实施证据：公共底座、Wave 2、W3.1～W3.7 与 Docker 发布演进           |
| [architecture.md](./architecture.md)                                 | 架构设计与关键技术决策记录（含踩坑记录）                                     |
| [conventions.md](./conventions.md)                                   | 开发约定：新增业务对象的标准接入手册                                         |
| [api.md](./api.md)                                                   | 接口文档（Swagger）使用指南与导入方式                                        |
| [docker-release.md](./docker-release.md)                             | API/Web 独立 Docker 镜像、release compose 与 `v*.*.*` Tag 自动发布           |
| [cordys-deferred-backlog.md](./cordys-deferred-backlog.md)           | 已发现但暂缓实施的 Cordys 能力与数据模型缺口长期台账                         |
| [project-progress.md](./project-progress.md)                         | 当前 Git/里程碑/执行指针、剩余工作与整体收口路线                             |
| [specs/README.md](./specs/README.md)                                 | 需求、技术设计与实施任务规格索引                                             |

## 快速上下文

- 项目定位：以项目内 `CordysCRM/` 作为功能、业务规则和交互行为参考基准，使用 NestJS + Prisma + Vue 独立实现，先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/冒烟脚本）
- 当前主线：W3.4 用户确认功能图、W3.5 用户个人中心、W3.6 全交易链、**W3.7 高级审批深化**以及独立工程化单元 **CACHE-001 Redis 平台缓存第一批**、**CACHE-002 租户读模型与首页统计缓存**均已完成；DB-010、DB-011、DB-012、CACHE-001、CACHE-002 均为 `VERIFIED`。当前没有已冻结的下一正式 task；下一阶段需基于剩余 parity/backlog 先建立 requirements/design/tasks 后再实现。
- 当前最终基线：隔离空库 **68/68 migrations + 双 Seed**且 `seedCountsStable=true`；DB-010/011/012 最终专项链 exit 0；Advanced Designer Browser **25/25**、Condition Browser **18/18**、Field Permission **21/21**、DB-011 Browser **18/18、17/17、24/24、28/28**、`/system/modules` **47/47**；`pnpm smoke` **227/227**、Rules **150/150**、CACHE-002 相邻专项 **37/37**、workspace typecheck/ESLint/Shared+API+Web production build/Prisma validate/`git diff --check` 基线保持全绿；Web build **4145 modules transformed**。Docker release runtime Smoke 最近一次仍为 CACHE-001 封板批次，已覆盖 **68/68 migrations**、Redis 密码与真实 cache key、改密认证缓存失效、API/Web runtime、Nginx proxy 与 SPA fallback；CACHE-002 本批未重复执行完整 Docker 三镜像 Smoke。
- 当前发布基线：`v0.0.5` 已包含 Web `BUILDPLATFORM` 静态构建优化和 API amd64/arm64 原生 Runner 分架构构建；API production deploy 已退出 legacy 二次联网路径。
- 整体剩余范围与完成标准见 [project-progress.md](./project-progress.md)；DataEase provider/token 继续由 DB-023 deferred，AI/License/MCP/商业标讯等明确排除项不计入当前 CRM 核心完成标准。
- 数据模型唯一真相：`apps/api/prisma/schema.prisma`；不维护会随迁移快速失真的手写数据模型快照
- 启动方式与演示账号见根目录 [README.md](../README.md)
- 文档归档约定：根目录只保留项目入口 `README.md`；其余项目文档统一放在 `docs/`，上游 `CordysCRM/` 自带文档保持原位
