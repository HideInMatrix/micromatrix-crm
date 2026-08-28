# 项目文档索引

| 文档                                                                 | 内容                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [cordys-parity.md](./cordys-parity.md)                               | 当前 CordysCRM 功能一致性总表与迁移状态                                      |
| [cordys-wave2-execution-plan.md](./cordys-wave2-execution-plan.md)   | Wave 2 执行记录；W2.1-W2.5 已验收，含流程设置版本底座与 Vue Flow 设计器      |
| [cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md) | 用户功能图收口计划；W3.4.4 Dashboard 已全部闭环，当前进入 W3.4.5 task 6.1 全图验收 |
| [cordys-menu-parity.md](./cordys-menu-parity.md)                     | 当前 Cordys 实例经模块开关与角色权限过滤后的实际左侧菜单基线                 |
| [alignment-log.md](./alignment-log.md)                               | 对齐探测与实施证据：运行实例基线、公共底座、Wave 2 与 W3.1-W3.3 企业微信能力 |
| [architecture.md](./architecture.md)                                 | 架构设计与关键技术决策记录（含踩坑记录）                                     |
| [conventions.md](./conventions.md)                                   | 开发约定：新增业务对象的标准接入手册                                         |
| [api.md](./api.md)                                                   | 接口文档（Swagger）使用指南与导入方式                                        |
| [docker-release.md](./docker-release.md)                             | API/Web 独立 Docker 镜像、release compose 与 `v*.*.*` Tag 自动发布           |
| [cordys-deferred-backlog.md](./cordys-deferred-backlog.md)           | 已发现但暂缓实施的 Cordys 能力与数据模型缺口长期台账                         |
| [specs/README.md](./specs/README.md)                                 | 需求、技术设计与实施任务规格索引                                             |

## 快速上下文

- 项目定位：以项目内 `CordysCRM/` 作为功能、业务规则和交互行为参考基准，使用 NestJS + Prisma + Vue 独立实现，先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/冒烟脚本）
- 当前主线：[cordys-graph-completion-plan.md](./cordys-graph-completion-plan.md)；W3.4.4 task 5.1～5.6 已全部完成，Dashboard 目录/资源/收藏/安全 iframe 与 `/reports` 页面均闭环。当前进入 **W3.4.5 task 6.1：全图菜单和跨页导航验收**。DataEase provider 由 DB-023 deferred。
- 当前回归基线：Dashboard API **44/44** + Dashboard Browser **28/28** + `pnpm smoke` **223/223** + rules **114/114** + 客户公海主体 **36/36** + 客户模块设置 API **25/25** + Browser **17/17** + 客户协作/关系/合并 **30/30** + 客户 API/360 **22/22** + 联系人 API **18/18** + 线索模块设置 API **22/22** + Browser **17/17** + 线索连续生命周期 **17/17** + 普通 API **18/18** + 转换 **21/21** + 多 Pool **32/32** + 线索 Browser **20/20**
- 数据模型唯一真相：`apps/api/prisma/schema.prisma`；不维护会随迁移快速失真的手写数据模型快照
- 启动方式与演示账号见根目录 [README.md](../README.md)
- 文档归档约定：根目录只保留项目入口 `README.md`；其余项目文档统一放在 `docs/`，上游 `CordysCRM/` 自带文档保持原位
