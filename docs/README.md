# 项目文档索引

| 文档 | 内容 |
| --- | --- |
| [gap-analysis.md](./gap-analysis.md) | 与 CordysCRM 的功能对照表、差距清单（含优先级） |
| [roadmap.md](./roadmap.md) | 补齐功能的分期实施计划与验收标准 |
| [architecture.md](./architecture.md) | 架构设计与关键技术决策记录（含踩坑记录） |
| [conventions.md](./conventions.md) | 开发约定：新增业务对象的标准接入手册 |
| [data-model.md](./data-model.md) | 数据模型说明与实体关系 |
| [api.md](./api.md) | 接口文档（Swagger）使用指南与导入方式 |

## 快速上下文

- 项目定位：参照 [CordysCRM](https://github.com/1Panel-dev/CordysCRM) 社区版功能自主实现（未使用其代码），先内部使用，架构预留商业化能力
- 已交付里程碑：M1 平台底座 → M2 元数据引擎 → M3 销售核心 → M4 交易链路 → M5 审批流 → M6 标讯 → M7 工作台报表 → M8 移动端 → 收尾（导入导出/开放 API/冒烟脚本）
- 全链路回归：`pnpm smoke`（19 项断言）
- 启动方式与演示账号见根目录 [README.md](../README.md)
