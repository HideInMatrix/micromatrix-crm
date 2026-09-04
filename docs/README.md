# 项目文档索引

| 文档                                                                 | 内容                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [cordys-parity.md](./cordys-parity.md)                               | 当前 CordysCRM 功能一致性总表与迁移状态                                        |
| [cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md)   | Wave 2 执行记录；W2.1-W2.5 已验收，含流程设置版本底座与 Vue Flow 设计器        |
| [cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md) | 用户功能图收口计划；W3.4.0～W3.4.5 已全部验收，当前功能图状态为 `VERIFIED`     |
| [cordys-menu-parity.md](./cordys-menu-parity.md)                     | 当前 Cordys 实例经模块开关与角色权限过滤后的实际左侧菜单基线                   |
| [alignment-log.md](./alignment-log.md)                               | 对齐探测与实施证据：公共底座、Wave 2、W3.1～W3.7 与 Docker 发布演进            |
| [architecture.md](./architecture.md)                                 | 架构设计与关键技术决策记录（含踩坑记录）                                       |
| [conventions.md](./conventions.md)                                   | 开发约定：新增业务对象的标准接入手册                                           |
| [api.md](./api.md)                                                   | 接口文档（Swagger）使用指南与导入方式                                          |
| [docker-release.md](./docker-release.md)                             | API/Migration/Web 镜像、生产 Compose、独立导出 worker 与 `v*.*.*` Tag 自动发布 |
| [cordys-deferred-backlog.md](./cordys-deferred-backlog.md)           | 已发现但暂缓实施的 Cordys 能力与数据模型缺口长期台账                           |
| [project-progress.md](./project-progress.md)                         | 当前 Git/里程碑/执行指针、剩余工作与整体收口路线                               |
| [specs/README.md](./specs/README.md)                                 | 需求、技术设计与实施任务规格索引                                               |

## 快速上下文

- 项目定位：以项目内 `CordysCRM/` 作为功能、业务规则和交互行为参考基准，使用 NestJS + Prisma + Vue 独立实现，先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/冒烟脚本）
- 当前主线：W3.4 用户确认功能图、W3.5 用户个人中心、W3.6 全交易链、**W3.7 高级审批深化**以及独立工程化单元 **CACHE-001**、**CACHE-002**、**EVENT-001**、**COORD-001**、**ASYNC-001**、**LOG-001**、**LOG-002**、**LOG-003**均已完成。LOG-003 已把“清理过期日志”和“清空全部操作日志”拆成两个明确动作，并为全量清空增加 `system:log:update`、输入“清空”强确认和 tenantId 删除边界。
- 当前数据库基线：**71 migrations**；当前日志治理封板基线为 API Rules **192/192**、全仓 typecheck PASS、lint **0 error / 8 个既有 warning**、production build PASS、Web **4145 modules transformed**、Prisma status 与 Prettier/`git diff --check` 全绿。
- 当前发布基线：`v0.0.13` 指向 `63e846f`；项目 packageManager 已切换 pnpm 11.25.0，Release/Docker 工具链整改由 TOOLCHAIN-001 文档单独追踪，不与 LOG-002 的业务日志改造混为同一验收单元。
- 整体剩余范围与完成标准见 [project-progress.md](./project-progress.md)；DataEase provider/token 继续由 DB-023 deferred，AI/License/MCP/商业标讯等明确排除项不计入当前 CRM 核心完成标准。
- 数据模型唯一真相：`apps/api/prisma/schema.prisma`；不维护会随迁移快速失真的手写数据模型快照
- 启动方式与演示账号见根目录 [README.md](../README.md)
- 文档归档约定：根目录只保留项目入口 `README.md`；其余项目文档统一放在 `docs/`，上游 `CordysCRM/` 自带文档保持原位
