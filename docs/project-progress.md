# MicroMatrix CRM 当前项目进度与整体收口路线

最近对齐：2026-09-03。

本文只记录“当前事实”和“后续收口路线”，历史实施细节继续以各阶段 `requirements/design/tasks`、专项验收文档和 `alignment-log.md` 为准。

## 1. 当前代码现场

- 分支：`master`
- 当前发布标签：`v0.0.5`
- W3.7 高级审批深化已经完成最终封板：DB-010、DB-011、DB-012 均为 `VERIFIED`，9.5 最终专项/Browser/空库/静态/legacy scan 全绿。W3.7 后两个独立 Redis 工程化执行单元 `CACHE-001 / Redis 平台缓存第一批` 与 `CACHE-002 / 租户读模型与首页统计缓存` 均已完成最终验收；它们没有预设 W3.8 编号，也不改变 Cordys parity 已关闭结论。
- 当前数据库基线：**68 migrations**。

## 2. 已关闭主里程碑

| 阶段 | 范围 | 当前结论 |
| --- | --- | --- |
| W2.1～W2.5 | 公共底座、RBAC、导航、跟进计划、消息设置/触发、流程设置基础版本图 | 已完成 |
| W3.1～W3.3 | 企业微信配置、组织同步、统一登录与消息渠道 | `VERIFIED` |
| W3.4-D | API/Web Docker release、Prisma migration、Nginx runtime proxy、Tag→GHCR | `VERIFIED`，并已完成 v0.0.5 多架构性能加固 |
| W3.4 | 首页、线索/线索池、客户/联系人/公海、Dashboard 与全图导航 | `VERIFIED` |
| W3.5 | 个人中心与 API Key | `VERIFIED` |
| W3.6 | 商机→报价→合同→回款/发票→订单完整交易链 | 已完成最终验收 |
| DB-021 | FollowUpPlan 独立 Field/Blob 与动态字段运行时 | `VERIFIED` |
| W3.7-9.2 / DB-010 | 通用审批资源快照与 UPDATE/DELETE 变更上下文 | `VERIFIED` |
| W3.7-9.3 / DB-011 | ApprovalRecord、加签、节点退回、ReturnBackRecord、nodeRound、审批人任务撤回、requireComment、ApprovalInstanceAttachment | `VERIFIED` |
| W3.7-9.4A / DB-012 子单元 | Condition/DEFAULT、条件 DTO、link.sort 分支与 `updateFields` runtime | 已完成 |
| W3.7-9.4B / DB-012 子单元 | empty/fallback/sameSubmitter、动态方向、多级审批人与 duplicate runtime | 已完成 |
| W3.7-9.4C / DB-012 子单元 | 节点 HIDDEN/VIEW/EDIT 字段权限、审批详情与审批态字段写入 gate | 已完成 |
| W3.7-9.4D / DB-012 子单元 | pass/reject 后置字段更新、冻结配置、UPDATE reject restore→post 最终顺序 | 已完成 |
| W3.7-9.4E / DB-012 子单元 | Webhook 安全 client、测试连接、运行时发送、SSRF/超时/响应限制与 delivery 审计 | 已完成 |
| W3.7-9.4F / DB-012 子单元 | Vue Flow 高级条件图、节点高级配置、统一 `nodes + links` 写契约与旧线性兼容清理 | 已完成；DB-012 `VERIFIED` |
| W3.7-9.5 | DB-010/011/012 最终专项、Browser、空库、Root/Rules、workspace 与 legacy scan | 已完成；W3.7 正式封板 |
| CACHE-001 | Redis 可降级公共基座、AuthGuard 认证上下文缓存、通知未读/分页缓存 | `VERIFIED` |
| CACHE-002 | 租户配置/Metadata/Directory 版本缓存、首页 statistic/overview 30 秒聚合缓存、缓存指标 | `VERIFIED` |
| EVENT-001 | Redis Pub/Sub 实时事件总线、通知多实例 SSE 与多标签页状态同步 | `VERIFIED` |

## 3. 当前执行指针

当前执行状态：

> **W3.7、CACHE-001、CACHE-002 与 EVENT-001 均已完成。当前没有已冻结的下一正式执行单元；后续 Redis 平台化继续按独立失败语义立项，优先候选为 COORD-001 / ASYNC-001 / SEQ-001。**

W3.7 的 9.2 / 9.3 / 9.4 / 9.5 已全部在 `docs/specs/process-settings-parity/tasks.md` 关闭。当前 DB-010、DB-011、DB-012 均为 `VERIFIED`。`CACHE-001`、`CACHE-002` 与 `EVENT-001` 已分别在对应 tasks 文档全部关闭；BullMQ、同步/Cron 分布式协调、流水号或验证码仍未被顺带纳入。

当前 deferred backlog 共 23 项：**19 项 VERIFIED、0 项 IN_PROGRESS、0 项 PLANNED、3 项 DISCOVERED（DB-007/008/015）、1 项 DEFERRED（DB-023）**。这个数字只用于说明缺口去向，不把不同工作量的 DB 条目简单换算成“完成百分比”。

## 4. 当前质量基线

- 空库：**68/68 migrations + 双 Seed**，Seed 计数幂等，关键运行时资源检查全部通过。
- Root Smoke：**227/227**。
- Rules：**153/153**；CACHE-001/002 缓存行为与 EVENT-001 多实例通知实时事件测试保持全绿。
- CACHE-002 专项：API typecheck PASS；公共缓存 + ModuleConfig/MessageSettings/Enterprise/Home/OrganizationSync 相邻回归 **37/37 PASS**；缓存数据源写入口审计未发现本批失效边界遗漏。
- EVENT-001 专项：通知双实例/降级/非法消息/去重 **5/5 PASS**；真实 Redis command + Pub/Sub + subscriber `CLIENT KILL` 自动重连/重订阅 PASS；API/Web typecheck、Web build **4145 modules** 全绿。
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
- Docker release Smoke 最新基线：**68/68 migrations**，API/Migration/Web 三镜像实建、Redis 密码/运行时缓存集成、改密认证缓存失效、重复初始化保护、API health、Web/Nginx `/api` proxy 与 SPA fallback：PASS。
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

- 操作日志：继续扩业务对象和时间线 UI。
- 登录日志：补完整筛选和审计维度。
- 导入导出：补 `.xls` 与更完整字段规则。
- 异步导出中心：当前有任务模型，但仍为同步生成；后续切真实异步执行。
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
3. **平台治理闭环**：操作/登录日志、异步导出、成员剩余字段、多部门、数据字典/模块配置扩展、公告/模板。
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
