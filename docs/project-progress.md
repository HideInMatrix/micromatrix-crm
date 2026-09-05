# MicroMatrix CRM 当前项目进度与整体收口路线

最近对齐：2026-09-05。

本文只记录“当前事实”和“后续收口路线”，历史实施细节继续以各阶段 `requirements/design/tasks`、专项验收文档和 `alignment-log.md` 为准。

## 1. 当前代码现场

- 分支：`master`
- 当前发布标签：`v0.0.13`
- W3.7 高级审批深化已经完成最终封板：DB-010、DB-011、DB-012 均为 `VERIFIED`，9.5 最终专项/Browser/空库/静态/legacy scan 全绿。W3.7 后两个独立 Redis 工程化执行单元 `CACHE-001 / Redis 平台缓存第一批` 与 `CACHE-002 / 租户读模型与首页统计缓存` 均已完成最终验收；它们没有预设 W3.8 编号，也不改变 Cordys parity 已关闭结论。
- UI-001 PC/Mobile UI 重构已推进到 **T12 VERIFIED**：PC 模块级 Header Top Menu、产品/价格表独立路由、列表两层工具区、Saved View 职责、32×32 图标动作以及产品/价格表 Card 顶部留白均已按 Cordys 规则收口。
- 当前数据库基线：**1 个 pre-release baseline migration**：`20260905084900_baseline`。正式发布前数据库结构变更统一重新合并该 baseline；正式发布后切换为 forward-only migration 历史。

## 2. 已关闭主里程碑

| 阶段                      | 范围                                                                                                                    | 当前结论                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| W2.1～W2.5                | 公共底座、RBAC、导航、跟进计划、消息设置/触发、流程设置基础版本图                                                       | 已完成                                                    |
| W3.1～W3.3                | 企业微信配置、组织同步、统一登录与消息渠道                                                                              | `VERIFIED`                                                |
| W3.4-D                    | API/Web Docker release、Prisma migration、Nginx runtime proxy、Tag→GHCR                                                 | `VERIFIED`，并已完成 v0.0.8 发布链路/镜像与初始化流程基线 |
| W3.4                      | 首页、线索/线索池、客户/联系人/公海、Dashboard 与全图导航                                                               | `VERIFIED`                                                |
| W3.5                      | 个人中心与 API Key                                                                                                      | `VERIFIED`                                                |
| W3.6                      | 商机→报价→合同→回款/发票→订单完整交易链                                                                                 | 已完成最终验收                                            |
| DB-021                    | FollowUpPlan 独立 Field/Blob 与动态字段运行时                                                                           | `VERIFIED`                                                |
| W3.7-9.2 / DB-010         | 通用审批资源快照与 UPDATE/DELETE 变更上下文                                                                             | `VERIFIED`                                                |
| W3.7-9.3 / DB-011         | ApprovalRecord、加签、节点退回、ReturnBackRecord、nodeRound、审批人任务撤回、requireComment、ApprovalInstanceAttachment | `VERIFIED`                                                |
| W3.7-9.4A / DB-012 子单元 | Condition/DEFAULT、条件 DTO、link.sort 分支与 `updateFields` runtime                                                    | 已完成                                                    |
| W3.7-9.4B / DB-012 子单元 | empty/fallback/sameSubmitter、动态方向、多级审批人与 duplicate runtime                                                  | 已完成                                                    |
| W3.7-9.4C / DB-012 子单元 | 节点 HIDDEN/VIEW/EDIT 字段权限、审批详情与审批态字段写入 gate                                                           | 已完成                                                    |
| W3.7-9.4D / DB-012 子单元 | pass/reject 后置字段更新、冻结配置、UPDATE reject restore→post 最终顺序                                                 | 已完成                                                    |
| W3.7-9.4E / DB-012 子单元 | Webhook 安全 client、测试连接、运行时发送、SSRF/超时/响应限制与 delivery 审计                                           | 已完成                                                    |
| W3.7-9.4F / DB-012 子单元 | Vue Flow 高级条件图、节点高级配置、统一 `nodes + links` 写契约与旧线性兼容清理                                          | 已完成；DB-012 `VERIFIED`                                 |
| W3.7-9.5                  | DB-010/011/012 最终专项、Browser、空库、Root/Rules、workspace 与 legacy scan                                            | 已完成；W3.7 正式封板                                     |
| CACHE-001                 | Redis 可降级公共基座、AuthGuard 认证上下文缓存、通知未读/分页缓存                                                       | `VERIFIED`                                                |
| CACHE-002                 | 租户配置/Metadata/Directory 版本缓存、首页 statistic/overview 30 秒聚合缓存、缓存指标                                   | `VERIFIED`                                                |
| EVENT-001                 | Redis Pub/Sub 实时事件总线、通知多实例 SSE 与多标签页状态同步                                                           | `VERIFIED`                                                |
| COORD-001                 | Redis 组织同步 lease、运行态与 6 个 Cron 多实例时间槽协调                                                               | `VERIFIED`                                                |
| ASYNC-001                 | BullMQ durable queue、独立 worker 与真实异步导出中心                                                                    | `VERIFIED`                                                |
| LOG-001                   | 真实客户端 IP、操作日志 180 天默认 retention、分布式清理、Docker 日志轮转                                               | `VERIFIED`                                                |
| LOG-002                   | 操作日志主表/Blob、列表/详情分离、租户 retention 网页策略、手工清理                                                     | `VERIFIED`                                                |
| LOG-003                   | 操作日志“清理过期”与“清空全部”语义拆分、租户级危险清空入口                                                              | `VERIFIED`                                                |
| UI-001                    | PC/Mobile 双应用 UI、Header Top Menu、PC 列表工具区与 Saved View Cordys 对齐                                            | T1～T13 `VERIFIED`                                        |

## 3. 当前执行指针

当前执行状态：

> **LOG-003 与 UI-001 T12 均已完成并封板为 `VERIFIED`。UI-001 最新状态为 PC 列表工具区 / 视图操作 Cordys 对齐完成；当前没有新的正式执行单元处于 `IN_PROGRESS`。**

W3.7 的 9.2 / 9.3 / 9.4 / 9.5 已全部在 `docs/specs/process-settings-parity/tasks.md` 关闭。当前 DB-010、DB-011、DB-012 均为 `VERIFIED`。`CACHE-001`、`CACHE-002`、`EVENT-001`、`COORD-001`、`ASYNC-001`、`LOG-001`、`LOG-002` 与 `LOG-003` 均已在各自 tasks 文档完成封板。数据库迁移历史已按未发布阶段策略从 71 个开发 migration 合并为 1 个 `20260905084900_baseline`；LOG-003 将 Rules 基线推进到 192/192。TOOLCHAIN-001 的工具链状态继续由其独立文档追踪，不把历史验收结论混入 LOG-002。

当前 deferred backlog 共 23 项：**19 项 VERIFIED、0 项 IN_PROGRESS、0 项 PLANNED、3 项 DISCOVERED（DB-007/008/015）、1 项 DEFERRED（DB-023）**。这个数字只用于说明缺口去向，不把不同工作量的 DB 条目简单换算成“完成百分比”。

## 4. 当前质量基线

- 当前 Prisma migration 基线为 **1 个 `20260905084900_baseline`**。该 baseline 已在全新空 PostgreSQL 上通过 `prisma migrate deploy` 与 Seed，随后 `prisma migrate diff` 返回 `No difference detected.`；两条 Prisma Schema 无法表达的 partial unique index 也已在数据库中逐条确认存在。此前 30/56/68/69/70/71 migration 的验收数字继续作为历史阶段证据保留，不再代表当前 migration 目录结构。
- UI-001 T12：本地真实 API/Web `3000/5173` 下 CDP Browser **79/79 PASS**；root typecheck/build PASS；lint **0 error / 8 个既有 warning**；相关 Prettier 与 staged/unstaged `git diff --check` PASS。
- Root Smoke：**227/227**。
- Rules：**192/192**；CACHE-001/002 缓存、EVENT-001 多实例通知、COORD-001 lease/Cron/组织同步协调、ASYNC-001 durable export、LOG-001 IP/retention、LOG-002 Blob/租户策略与 LOG-003 clear-all 回归保持全绿。
- CACHE-002 专项：API typecheck PASS；公共缓存 + ModuleConfig/MessageSettings/Enterprise/Home/OrganizationSync 相邻回归 **37/37 PASS**；缓存数据源写入口审计未发现本批失效边界遗漏。
- EVENT-001 专项：通知双实例/降级/非法消息/去重 **5/5 PASS**；真实 Redis command + Pub/Sub + subscriber `CLIENT KILL` 自动重连/重订阅 PASS；API/Web typecheck、Web build **4145 modules** 全绿。
- COORD-001 专项：coordinator **4/4 PASS**、6 个 Cron wrapper **1/1 PASS**、OrganizationSync 协调相关 **4 个新增断言 PASS**；真实 Redis lease/renew/safe-release/reacquire/slot claim PASS；API typecheck 与 `git diff --check` 全绿。
- ASYNC-001 专项：新增/相邻专项 **10/10 PASS**；完整 Rules **172/172 PASS**；`smoke:async-export` 在隔离 PostgreSQL/Redis 下执行 **69/69 migrations + bootstrap**，验证 producer PENDING、缺失 BullMQ job `recovered=1`、XLSX HTTP 200、worker 停机保持 PENDING、重启 `kept=1` 后 SUCCESS、queue worker health 可观测，7 项断言全部为 true；Compose config 与 `git diff --check` PASS。
- LOG-001 专项：IP/config + retention **8/8 PASS**；标准 Rules **179/179 PASS**；全仓 `pnpm typecheck` PASS；生产 Compose 确认 `TRUST_PROXY_HOPS=1`、OperationLog 默认 `180 天 / 1000 条每批 / 20 批每轮`，长期容器启用 Docker `json-file` 默认 `20m × 5` 轮转；lint 0 error、Compose config 与 `git diff --check` PASS。
- LOG-002：主表 `detail` 已退出运行模型，新增一对一 `operation_log_blobs` 与租户级 `operation_log_settings`；列表轻量 select、详情懒加载、30～3650 天/永久保留、最近清理状态与过期日志清理均已落地。最终 Rules **190/190 PASS**、全仓 typecheck/build PASS、Web **4145 modules transformed**、lint **0 error / 8 个既有 warning**、Prisma 71/71 up to date、Prettier 与 `git diff --check` PASS。
- LOG-003：新增 `POST /logs/clear-all`，只按当前 `tenantId` 删除全部操作日志并返回真实 count；接口不使用 `@LogOperation`，网页要求输入“清空”强确认，完成后刷新列表/策略。Rules **192/192 PASS**，root typecheck/build PASS，lint 仍为 0 error / 8 个既有 warning。
- W3.7-9.5 最终专项链：DB-010、DB-011 9.3A～E、DB-012 9.4A～E 全部重新执行 exit 0；Prisma generate/validate、default DB 68 migrations status/deploy、空库双 Seed、workspace typecheck/lint/build 与 `git diff --check` 全绿。
- W3.7-9.4F Advanced Designer Browser：**25/25**；Vue Flow 高级图、字段权限、后置字段、Webhook 安全测试、duplicate rule、统一 PUT 图契约和完整 round-trip 全绿，API 非预期 5xx=0、Runtime exception=0。
- W3.7-9.4E Webhook HTTP Smoke：PASS（68 migrations）；连接测试 GET/POST、private target/危险 header/redirect/response limit/timeout gate、审计脱敏、冻结版本、field-before-webhook、reject placeholder、ALL 单次、AUTO_PASS 及 runtime failure non-blocking 全部真实验证。
- W3.7-9.4D post-field HTTP Smoke：PASS（68 migrations）；Flow round-trip/reference/duplicate/enabled-value/safe-field gate、冻结版本、manual pass/reject、disabled noop、ALL 完成点单次执行、AUTO_PASS、系统字段、实例展示同步及 UPDATE reject restore→post 最终顺序均保持。
- W3.7-9.4C field permission HTTP Smoke：PASS（68 migrations）；Flow round-trip/reference/edit eligibility、HIDDEN/VIEW/EDIT detail、owner/view/sign write gate、系统/自定义字段写入与版本冻结均保持；PC/Mobile Browser **21/21**。
- W3.7-9.4B approver policy HTTP Smoke：PASS（68 migrations）；empty auto-pass + ApprovalRecord、fallback、sameSubmitter、直属/部门方向与三种 duplicate rule 均保持。
- W3.7-9.4A Condition / DEFAULT HTTP Smoke：在 68 migrations 下继续 PASS；9.4F 收口后 Browser 已升级为真实可编辑条件图验收 **18/18**，CONDITION 编辑、统一 nodes+links PUT、版本/links round-trip、API 5xx=0、Runtime exception=0。
- W3.7-9.4A 已验证 link.sort 首命中、DEFAULT fallback、`NOT_EQUAL_ORIGINAL`、历史实例 path 冻结，CONDITION/DEFAULT 不产生 task。
- W3.7-9.3E requireComment / ApprovalInstanceAttachment HTTP Smoke：PASS（63 migrations）。
- W3.7-9.3E PC/Mobile Browser：本轮相邻回归 **28/28**，真实 `/attachments/upload`、API 5xx=0、Runtime exception=0。
- W3.7-9.3B / 9.3C / 9.3D HTTP 回归：PASS；Browser 回归分别 **18/18、17/17、24/24**。
- DB-010 regression：PASS；DB-011 9.3A～E、DB-012 9.4A～D 相邻 HTTP regression 在当前 **68 migrations** schema 基线下保持 PASS。
- `/system/modules` Browser：**47/47**，API 5xx=0、Runtime exception=0。
- workspace typecheck / ESLint / Shared+API+Web production build / Prisma validate：PASS。
- Web production build：**4145 modules transformed**。
- 完整 Docker release 三镜像 Smoke 最近一次基线仍为 **68/68 migrations**：API/Migration/Web 实建、Redis 密码/运行时缓存集成、改密认证缓存失效、重复初始化保护、API health、Web/Nginx `/api` proxy 与 SPA fallback均 PASS。本轮 ASYNC-001 没有伪称重跑完整镜像 Smoke；新增的是 69 migration 的真实 API/独立 worker/Redis/PostgreSQL Smoke 与 Compose config 验证。
- API Docker：amd64、arm64 均已原生实建；production deploy 为 369 packages reuse、0 download。

## 5. W3.7 完成后仍未关闭的 Cordys 差异

`cordys-parity.md` 当前核心销售业务已经全部为 ✅，剩余工作主要集中在“协同/平台能力”，不是再重做交易链。

### A. 协同深度能力

- 跟进记录：评论、@成员、附件、字段、日志、视图。
- 跟进计划：评论/评论计数，以及 CUSTOMER/BUSINESS/CLUE 三套 FormDesign 上下文布局。
- 站内通知：邮件及仍未接入的 provider/模板能力。
- 定时任务：统一任务注册、回收、提醒、清理策略。

### B. 元数据、表单与搜索

- 动态字段剩余字段类型：LOCATION、图片、附件、公式、数据源字段等。
- 动态表单：布局、显隐、联动、子表、数据源。
- 自定义表单：当前尚未实施。
- 高级搜索：组合条件、数据范围、字段掩码。
- 全局搜索：跨模块搜索当前尚未实施。
- 字段脱敏：当前尚未实施。

### C. 审计、导入导出与平台管理补齐

- 操作日志：LOG-002 已完成主表/Blob、列表/详情和租户 retention；LOG-003 已补齐“清理过期日志”与“清空全部操作日志”的明确管理动作。后续差异只剩继续扩业务对象和时间线 UI。
- 登录日志：补完整筛选和审计维度。
- 导入导出：补 `.xls` 与更完整字段规则。
- 成员：工作城市、入职日期、会话失效、多部门。
- 用户视图、模块配置、数据字典：当前主业务已覆盖，剩余随未迁移模块扩展。
- 公告、消息模板/多语言：分别由 DB-007、DB-008 跟踪。

### D. 第三方 provider 与产品决策项

- DB-015 钉钉/飞书：配置、组织映射、SSO、消息 sender 仍未迁移；当前产品决策是暂不做，因此不应阻塞近期核心主线。
- DB-023 DataEase：明确 deferred，不阻塞 Dashboard `VERIFIED`。
- Cordys License、AI/MaxKB/SQLBot、Cordys MCP/Skills、商业标讯 API：明确不纳入当前 CRM 核心复刻完成标准。

## 6. 建议的整体收口波次

以下是基于当前 parity/backlog 的建议顺序，**W3.7 已完成；W3.7 之后的编号尚未固化为正式 tasks**：

1. **协同闭环**：跟进记录/计划评论附件 + 通知/定时任务，把高频业务协作链闭合。
2. **元数据/表单/搜索闭环**：动态字段、动态/自定义表单、高级/全局搜索、字段脱敏。
3. **平台治理闭环**：操作/登录日志、成员剩余字段、多部门、数据字典/模块配置扩展、公告/模板；异步导出中心已由 ASYNC-001 封板，不再列为待实现项。
4. **第三方决策轮**：仅在产品决定恢复时实施钉钉/飞书、DataEase 等 deferred provider；明确排除项保持排除，不为了“100% 数字”伪实现。
5. **全项目最终验收**：重新扫描 Cordys 页面/API/Controller/Service/Domain/Mapper/DDL，确保 parity 表所有项最终只能落在“已验证”或“明确不纳入/延期且有产品决策”之一；执行完整空库、升级库、租户/权限矩阵、Root/Rules/Browser、Docker release 和 legacy runtime scan 后封版。

## 7. “整体完成”的判定标准

不能用 Git 提交数量或页面数量判断完成。项目最终关闭应同时满足：

- `cordys-parity.md` 不再存在无去向的 `❌ / 🚧 / 🟡`；每项要么真实完成，要么有明确产品级排除/延期结论。
- `cordys-deferred-backlog.md` 不再存在无人负责、无执行入口的 `DISCOVERED` 项。
- 所有已纳入能力均具备源码证据、数据模型/API/UI/权限/审计和自动化验收。
- 空库与历史升级路径均可重复部署；双 Seed 幂等。
- 多租户、DataScope、角色权限和审批任务 owner 边界 fail-closed。
- Root Smoke、Rules、关键 Browser、workspace typecheck/lint/build、Docker release 全绿。
- 不保留旧 API/旧模型/JSONB 兼容真相源或 label-only 假入口来伪造“已完成”。
