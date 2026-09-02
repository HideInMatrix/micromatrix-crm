# W3.7 高级审批深化执行计划

## 1. 目标

W3.7 在 W2.5 流程设置底座和 W3.6 交易链审批运行时之上，继续对齐 Cordys DB-010～DB-012。目标不是重写审批中心，而是把当前“交易链专用硬编码 + 高级设置占位”演进为可扩展、可验证的通用审批运行时。

源码审计证据见：[W3.7.0 高级审批源码与运行时差异审计](./w370-advanced-approval-audit.md)。

## 2. 固定实施顺序

### W3.7-9.1 源码审计与规格冻结

- 重核 DB-010～012 Cordys Domain / Service / API / UI；
- 修正 W2.5 后已被 W3.6 改变的旧 deferred 描述；
- 固化本执行计划、requirements/design 扩展和 tasks；
- 不在本任务开放任何高级运行时开关。

### W3.7-9.2 DB-010 通用资源快照与变更上下文

目标：移除 ApprovalsService 对 Quote/Contract/Invoice/Order snapshot capture/restore 的业务硬编码，使新增审批业务不需要继续扩审批引擎 switch。

实施要点：

1. Prisma 建立通用审批资源快照模型，至少包含 tenant/form/resource/snapshot/audit 时间与必要唯一索引；实际字段以 Cordys 语义和项目多租户规范共同约束，不机械复制无租户字段。
2. `ApprovalInstance` 补 `updateFields` 与实例级 comment 上下文；不得覆盖任务审批意见。
3. 建立明确的 resource handler/adapter 注册边界，为 quotation/contract/invoice/order 实现 capture + restore + approval status/snapshot sync 所需职责。
4. UPDATE 提审保存编辑前快照；重复提审覆盖旧未消费快照；reject/cancel 恢复后清理；通过及实例终态按实际生命周期清理无用快照。
5. DELETE 继续保持“审批通过后实际删除”，不得改成先删后恢复。
6. 等价迁移四业务后删除 `ApprovalsService` 中四套 snapshot interface/capture/restore 硬编码；确认无第二真相源后再决定是否移除 `approval_instances.business_snapshot`。
7. 专项 Rules + API Smoke 覆盖四业务 UPDATE reject/cancel rollback 与 DELETE，并验证跨租户隔离和快照清理。

关闭门槛：DB-010 只有在四业务使用同一通用资源边界、旧硬编码退出、空库 migration 与现库 upgrade 均通过后才可 `VERIFIED`。

### W3.7-9.3 DB-011 高级任务与动作运行时

实施顺序：

1. 扩展 task runtime 所需 nodeRound/type/action 语义；
2. 建立独立 ApprovalRecord，避免把所有历史动作压在当前任务状态上；
3. 实现 BEFORE/AFTER 加签及嵌套加签顺序；
4. 实现节点退回与 return-back record；
5. 实现审批人任务撤回，与提交人 cancel 明确分离；
6. 接入 requireComment；
7. 如 Cordys 当前 UI/API 确认附件属于本动作主链，再建立实例/动作附件关系并接入；
8. 最后开放 allowAddSign / allowWithdraw / allowBatchProcess 等对应设置。

每个动作必须校验任务 owner、实例状态、节点状态和租户边界，并有并发/重复请求保护。

### W3.7-9.4 DB-012 高级节点与后置动作

实施顺序：

1. Condition / DEFAULT 节点和真实分支 Link；
2. 条件 DSL/DTO 对齐，先覆盖 Cordys 当前实际操作符；
3. 接入 `updateFields` 条件；
4. 空审批人、fallback、sameSubmitter、动态审批方向；
5. duplicate approver rule 真实运行时；
6. 节点字段权限；
7. pass/reject 后置字段更新；
8. Webhook 配置、测试连接、运行时发送和安全审计；
9. Vue Flow 从受控线性图升级为受控条件图，并保持前端只提交业务契约；随后迁移现有调用方到统一 `nodes + links` 图写契约，删除 9.4A 过渡期保留的旧线性 payload 自动推导入口，避免长期双 truth。

当前执行状态（2026-09-02）：步骤 1～5 已由 9.4A/9.4B 完成；下一执行单元从步骤 6“节点字段权限”开始。9.4B 已确认项目没有发布历史数据，因此 Migration 65 不增加旧配置 backfill 或旧实例兼容分支，直接以最终模型前进。

Webhook 必须增加 SSRF/内网目标、超时、响应大小、敏感 header/body 日志等安全边界；不得直接照搬 Cordys 的任意 URL 请求实现。

### W3.7-9.5 最终验收与封板

- Prisma validate/generate/migrate；
- 隔离空库全 migrations + 双 Seed；
- DB-010/011/012 专项 Rules/API Smoke；
- 流程设置 Browser + 审批中心 Browser；
- Root Smoke；
- workspace typecheck/lint/build；
- runtime legacy/deferred scan；
- `/system` 流程设置高级开关逐项确认 REAL；
- 更新 parity/alignment/deferred backlog；
- `git diff --check` 与 scoped 本地提交；不 push，除非用户明确要求。

## 3. 数据迁移原则

- 只使用 forward migration；不得修改已发布历史 migration。
- 先加新模型/新字段并双向验证，再迁移调用方，最后删除旧字段/硬编码；中间阶段的双存储只能是受控迁移步骤，不能作为长期兼容层。
- W3.6 已经通过的 quotation/contract/invoice/order 审批行为是回归基线；W3.7 不得改变 approved 事实位和业务审批状态语义。
- 空库 replay 总 migration 数以实施时仓库实际数量为准，文档不得写死旧计数。

## 4. API 与 UI 原则

- 优先复用现有 `/approvals` 与 `/approval-resource` 主链，不创建第二套高级审批 namespace。
- Controller 只暴露 Cordys 源码确认且当前运行时真正实现的动作。
- 前端 disabled 高级选项只有在对应 API/runtime 专项验收通过后才开放。
- 流程设计器升级必须与服务端节点图校验同步；不可让 Vue Flow 可画出后端无法执行的图。

## 5. 回归基线

进入 W3.7 时最近封板基线：

- Root Smoke：227/227；
- API Rules：119/119；
- workspace typecheck/lint/build：exit 0；
- 当前 Prisma migration：57；
- DB-021 已 `VERIFIED`；
- 工作树在 DB-021 本地提交 `1dfe02e` 后干净，未 push。

上述数字只作为进入阶段的基线，不作为 W3.7 最终验收结果；每个关闭任务必须记录当时实际运行结果。
