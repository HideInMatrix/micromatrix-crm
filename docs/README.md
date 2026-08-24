# 项目文档索引

| 文档                                                               | 内容                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [cordys-parity.md](./cordys-parity.md)                             | 当前 CordysCRM 功能一致性总表与迁移状态                                         |
| [cordys-wave1-baseline.md](./cordys-wave1-baseline.md)             | Wave 0 + Wave 1 首轮源码事实、API/Model/Rule 与已落地底座                       |
| [cordys-wave1-execution-plan.md](./cordys-wave1-execution-plan.md) | Wave 1 后续严格执行计划：回收引擎、协作权限、SavedView、客户关系/合并与验收门槛 |
| [cordys-wave1-remainder-plan.md](./cordys-wave1-remainder-plan.md) | Wave 1 R1-R6 执行记录；2026-08-21 已全部验收                                    |
| [cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md) | Wave 2 执行记录；W2.1-W2.4 已验收，当前完成业务消息真实触发链路                 |
| [cordys-menu-parity.md](./cordys-menu-parity.md)                   | 当前 Cordys 实例经模块开关与角色权限过滤后的实际左侧菜单基线                    |
| [gap-analysis.md](./gap-analysis.md)                               | 早期页面探测形成的历史差距基线，不再作为主实施依据                              |
| [alignment-log.md](./alignment-log.md)                             | 对齐探测与实施证据：运行实例基线、公共底座、顶部导航、跟进计划与 W2.3/W2.4 消息 |
| [architecture.md](./architecture.md)                               | 架构设计与关键技术决策记录（含踩坑记录）                                        |
| [conventions.md](./conventions.md)                                 | 开发约定：新增业务对象的标准接入手册                                            |
| [data-model.md](./data-model.md)                                   | 数据模型说明与实体关系                                                          |
| [api.md](./api.md)                                                 | 接口文档（Swagger）使用指南与导入方式                                           |
| [cordys-deferred-backlog.md](./cordys-deferred-backlog.md)         | 已发现但暂缓实施的 Cordys 能力与数据模型缺口长期台账                            |
| [specs/README.md](./specs/README.md)                               | 需求、技术设计与实施任务规格索引                                                |

## 快速上下文

- 项目定位：以项目内 `CordysCRM/` 作为功能、业务规则和交互行为参考基准，使用 NestJS + Prisma + Vue 独立实现，先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/冒烟脚本）
- 当前主线：[cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md)；W2.1-W2.4 均已闭环，35 个目录事件中 32 个已有真实触发链路
- 全链路回归：`pnpm smoke`（当前 **214 条实际断言**）+ `pnpm --filter @micromatrix/api test:rules`（27 条规则与公共底座单测）；W2.4 已使用本地 PostgreSQL 真实链路执行验收
- 启动方式与演示账号见根目录 [README.md](../README.md)
- 文档归档约定：根目录只保留项目入口 `README.md`；其余项目文档统一放在 `docs/`，上游 `CordysCRM/` 自带文档保持原位
