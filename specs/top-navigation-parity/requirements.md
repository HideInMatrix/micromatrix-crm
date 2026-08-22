# 顶部导航对齐需求

## 范围

本阶段以项目内 `CordysCRM/` 当前 `main` 源码为第一事实来源，完成顶部导航配置的读取、租户级排序、实际 Header 渲染与权限过滤。顶部入口背后的完整业务能力仍按各自模块独立迁移，不用空壳页面伪造完成状态。

## 用户故事与验收标准

### R1 源码事实

- 当实现顶部导航时，系统 shall 先核对 Cordys 模块配置页、Header、Pinia store、API 封装以及 Navigation Controller / Service / Domain / Mapper / migration。
- 当 Cordys 数据模型存在字段但当前页面/API 没有对应操作时，系统 shall 记录该事实，但不得自行扩大为可操作能力。

### R2 配置读取与默认数据

- 当租户首次读取顶部导航配置时，系统 shall 自动补齐 `search / task / event / agent / notify / about / language / help` 八个默认项。
- 当配置返回时，系统 shall 按租户保存的顺序返回，并包含稳定 key、启用状态和排序值。
- 当新增默认项后旧租户再次读取时，系统 shall 只补缺失项，不覆盖已有排序。

### R3 顶部导航排序

- 当管理员具备 `system:module:update` 权限时，系统 shall 允许拖拽八个顶部导航项并持久化完整顺序。
- 当排序载荷缺项、重复或含未知 key 时，系统 shall 在服务端拒绝请求。
- 当普通用户尝试修改排序时，系统 shall 由权限 Guard 拒绝请求。

### R4 Header 渲染

- 当任意登录用户进入 PC 页面时，Header shall 从同一 Pinia 配置源按保存顺序渲染顶部入口。
- 当入口依赖业务权限时，Header shall 在当前用户没有相应权限时隐藏该入口。
- 当入口已有真实能力时，Header shall 复用现有审批、通知、系统信息或帮助能力，不复制第二套实现。
- 当入口依赖尚未迁移的全局搜索、跟进计划、国际化或 Agent 时，系统 shall 在配置页明确标记状态，不创建空壳业务页面，也不在 Header 冒充可用能力。

### R5 回归与记录

- 当本阶段完成时，系统 shall 通过 Prisma generate、typecheck、lint、build、规则测试和全链路 smoke。
- 当实现或源码事实发生变化时，系统 shall 同步更新执行计划、parity、alignment log、文档索引和根 README。

## 非目标

- 不在本阶段实现全局搜索、跟进计划、国际化、Agent 或 Cordys License/About 逻辑。
- 不实现 Cordys 当前源码没有暴露的顶部导航开关 API。
- 不改变已有左侧主导航模块开关、排序与角色权限语义。
