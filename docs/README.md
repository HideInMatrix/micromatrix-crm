# 项目文档索引

| 文档                                                                 | 内容                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [cordys-parity.md](./cordys-parity.md)                               | 当前 CordysCRM 功能一致性总表与迁移状态                                        |
| [cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md)   | Wave 2 执行记录；W2.1-W2.5 已验收，含流程设置版本底座与 Vue Flow 设计器        |
| [cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md) | 用户功能图收口计划；当前执行 W3.4.2 线索与线索池，起点为 task 3.1 源码证据矩阵 |
| [cordys-menu-parity.md](./cordys-menu-parity.md)                     | 当前 Cordys 实例经模块开关与角色权限过滤后的实际左侧菜单基线                   |
| [alignment-log.md](./alignment-log.md)                               | 对齐探测与实施证据：运行实例基线、公共底座、Wave 2 与 W3.1-W3.3 企业微信能力   |
| [architecture.md](./architecture.md)                                 | 架构设计与关键技术决策记录（含踩坑记录）                                       |
| [conventions.md](./conventions.md)                                   | 开发约定：新增业务对象的标准接入手册                                           |
| [api.md](./api.md)                                                   | 接口文档（Swagger）使用指南与导入方式                                          |
| [docker-release.md](./docker-release.md)                             | API/Web 独立 Docker 镜像、release compose 与 `v*.*.*` Tag 自动发布             |
| [cordys-deferred-backlog.md](./cordys-deferred-backlog.md)           | 已发现但暂缓实施的 Cordys 能力与数据模型缺口长期台账                           |
| [specs/README.md](./specs/README.md)                                 | 需求、技术设计与实施任务规格索引                                               |

## 快速上下文

- 项目定位：以项目内 `CordysCRM/` 作为功能、业务规则和交互行为参考基准，使用 NestJS + Prisma + Vue 独立实现，先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/冒烟脚本）
- 当前主线：[cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md)；W3.4.1 首页、企业设置 W3.4-S/前端目录收口以及插入的 **W3.4-D Docker 发布链路**均已完成，当前恢复执行 **W3.4.2 线索与线索池 task 3.1**
- 当前回归基线：`pnpm smoke`（**219/219**）+ `pnpm smoke:enterprise-settings`（**23/23**）+ `pnpm smoke:w341-home`（17/17）+ `pnpm smoke:w341-home-browser`（12/12）+ `pnpm smoke:wecom-sync`（23/23）+ `pnpm smoke:wecom-sso-message`（19/19）+ `pnpm --filter @micromatrix/api test:rules`（**114/114**）
- 数据模型唯一真相：`apps/api/prisma/schema.prisma`；不维护会随迁移快速失真的手写数据模型快照
- 启动方式与演示账号见根目录 [README.md](../README.md)
- 文档归档约定：根目录只保留项目入口 `README.md`；其余项目文档统一放在 `docs/`，上游 `CordysCRM/` 自带文档保持原位
