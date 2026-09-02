# MicroMatrix CRM 当前项目进度与整体收口路线

最近对齐：2026-09-02。

本文只记录“当前事实”和“后续收口路线”，历史实施细节继续以各阶段 `requirements/design/tasks`、专项验收文档和 `alignment-log.md` 为准。

## 1. 当前代码现场

- 分支：`master`
- 当前发布标签：`v0.0.5`
- 当前开发现场已关闭 W3.7-9.4A Condition 与 9.4B 审批人异常策略两个 DB-012 子单元；DB-012 继续 `IN_PROGRESS`，代码与文档按 scoped 本地提交管理；是否 push 继续由用户显式决定。
- 当前数据库基线：**65 migrations**。

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
| W3.7-9.4A / DB-012 子单元 | Condition/DEFAULT、条件 DTO、link.sort 分支与 `updateFields` runtime | 已完成；DB-012 整体仍 `IN_PROGRESS` |
| W3.7-9.4B / DB-012 子单元 | empty/fallback/sameSubmitter、动态方向、多级审批人与 duplicate runtime | 已完成；DB-012 整体仍 `IN_PROGRESS` |

## 3. 当前执行指针

当前唯一已冻结的主执行指针是：

> **W3.7-9.4C / DB-012：节点字段权限和审批详情真实约束**

W3.7 内部剩余顺序已经在 `docs/specs/process-settings-parity/tasks.md` 固化：

1. **9.4C 字段权限**：节点字段权限和审批详情真实约束。
2. **9.4D～F / DB-012 剩余能力**：pass/reject 后置字段更新、Webhook、安全测试连接、Vue Flow 条件图；9.4F 同时删除旧线性 payload 自动推导兼容。
3. **9.5 W3.7 最终封板**：DB-010/011/012 专项 + Root Smoke + Rules + Browser + 空库全 migration/双 Seed + typecheck/lint/build + legacy/deferred scan。

当前 DB-011 状态：`VERIFIED`；DB-012 的 9.4A/9.4B 已完成，整体继续 `IN_PROGRESS`，当前唯一冻结执行单元为 9.4C。

当前 deferred backlog 共 23 项：**18 项 VERIFIED、1 项 IN_PROGRESS（DB-012）、0 项 PLANNED、3 项 DISCOVERED（DB-007/008/015）、1 项 DEFERRED（DB-023）**。这个数字只用于说明缺口去向，不把不同工作量的 DB 条目简单换算成“完成百分比”。

## 4. 当前质量基线

- 空库：**65/65 migrations + 双 Seed**，Seed 计数幂等。
- Root Smoke：**227/227**。
- Rules：**133/133**。
- W3.7-9.4B approver policy HTTP Smoke：PASS（65 migrations）；empty auto-pass + ApprovalRecord、fallback、sameSubmitter、直属/部门方向与三种 duplicate rule 均已真实执行。
- W3.7-9.4A Condition / DEFAULT HTTP Smoke：在 65 migrations 下继续 PASS；Browser 最近基线 **14/14**，高级图只读 fail-closed、API 5xx=0、Runtime exception=0。
- W3.7-9.4A 已验证 link.sort 首命中、DEFAULT fallback、`NOT_EQUAL_ORIGINAL`、历史实例 path 冻结，CONDITION/DEFAULT 不产生 task。
- W3.7-9.3E requireComment / ApprovalInstanceAttachment HTTP Smoke：PASS（63 migrations）。
- W3.7-9.3E PC/Mobile Browser：**28/28**，真实 `/attachments/upload`、API 5xx=0、Runtime exception=0。
- W3.7-9.3B / 9.3C / 9.3D HTTP 回归：PASS；Browser 回归分别 **17/17、17/17、24/24**。
- DB-010 regression：PASS（65 migrations）；DB-011 9.3A～E 相邻 regression 在当前 65 migrations 下保持 PASS。
- `/system/modules` Browser：**47/47**，API 5xx=0、Runtime exception=0。
- workspace typecheck / ESLint / Shared+API+Web production build / Prisma validate：PASS。
- Web production build：**4144 modules transformed**。
- Docker release Smoke 最近一次基线：62 migrations、API runtime、Prisma CLI、Web/Nginx `/api` proxy、SPA fallback：PASS；Migration 63/64 已分别通过业务专项、空库和回归验证，Docker release 未因审批业务子单元重复执行。
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

以下是基于当前 parity/backlog 的建议顺序，**W3.7 已冻结；W3.7 之后的编号尚未固化为正式 tasks**：

1. **先完成 W3.7 高级审批**：这是当前唯一进行中的核心运行时主线。
2. **协同闭环**：跟进记录/计划评论附件 + 通知/定时任务，把高频业务协作链闭合。
3. **元数据/表单/搜索闭环**：动态字段、动态/自定义表单、高级/全局搜索、字段脱敏。
4. **平台治理闭环**：操作/登录日志、异步导出、成员剩余字段、多部门、数据字典/模块配置扩展、公告/模板。
5. **第三方决策轮**：仅在产品决定恢复时实施钉钉/飞书、DataEase 等 deferred provider；明确排除项保持排除，不为了“100% 数字”伪实现。
6. **全项目最终验收**：重新扫描 Cordys 页面/API/Controller/Service/Domain/Mapper/DDL，确保 parity 表所有项最终只能落在“已验证”或“明确不纳入/延期且有产品决策”之一；执行完整空库、升级库、租户/权限矩阵、Root/Rules/Browser、Docker release 和 legacy runtime scan 后封版。

## 7. “整体完成”的判定标准

不能用 Git 提交数量或页面数量判断完成。项目最终关闭应同时满足：

- `cordys-parity.md` 不再存在无去向的 `❌ / 🚧 / 🟡`；每项要么真实完成，要么有明确产品级排除/延期结论。
- `cordys-deferred-backlog.md` 不再存在无人负责、无执行入口的 `DISCOVERED` 项。
- 所有已纳入能力均具备源码证据、数据模型/API/UI/权限/审计和自动化验收。
- 空库与历史升级路径均可重复部署；双 Seed 幂等。
- 多租户、DataScope、角色权限和审批任务 owner 边界 fail-closed。
- Root Smoke、Rules、关键 Browser、workspace typecheck/lint/build、Docker release 全绿。
- 不保留旧 API/旧模型/JSONB 兼容真相源或 label-only 假入口来伪造“已完成”。
