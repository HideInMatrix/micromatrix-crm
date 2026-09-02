# W3.7-9.4F DB-012 高级流程设计器与统一图写契约审计

审计日期：2026-09-02

## 1. 范围

本单元关闭 DB-012 最后一个子项：

- 把当前只支持顺序审批节点的 Vue Flow 画布升级为可编辑 `START / APPROVER / CONDITION / DEFAULT / END` 图；
- 在审批节点配置区开放 9.4B～9.4E 已有真实运行时支撑的高级设置；
- 在条件节点配置区开放 AND/OR 条件；
- 前端保存始终提交显式 `createNodes + createLinks`；
- API 删除 9.4A 过渡期保留的旧 `createNodes-only` 自动线性图推导；
- 迁移仓库内所有审批流写调用方到统一图契约；
- 新增 Browser / API 专项后关闭 DB-012。

`allowBatchProcess` 仍没有批量任务运行时，本单元不把该开关伪装成 REAL；它继续保持禁用，不阻塞 DB-012 节点能力关闭。

## 2. Cordys 前端源码事实

Cordys 当前流程设计器并不是简单的“审批节点数组”。核心事实如下：

1. 新流程默认骨架是 `START -> APPROVER -> END`。
2. 条件组在前端表现为 if/else 分支，序列化到后端时转成同一前驱下的多个 `CONDITION` 与一个 `DEFAULT` 节点。
3. `CONDITION / DEFAULT` 不是纯展示态；前端序列化时会生成真实 node/link，分支结束后可重新汇入公共后继。
4. 审批节点配置分为审批人设置、表单权限、审批后动作三个区域；已确认字段包括：
   - approver type / level / direction / multi-approver mode；
   - empty approver / fallback / same submitter；
   - fieldPermissions；
   - pass/reject field updates；
   - pass/reject webhook。
5. 条件分支顺序由连接顺序/sort 决定；DEFAULT 是条件全部未命中的唯一兜底分支。
6. Flow transform 明确把前端结构序列化为平铺 nodes + links，而不是依赖后端猜测线性连接。

## 3. MicroMatrix 9.4E 结束时现场

后端已具备完整 DB-012 runtime：

- CONDITION / DEFAULT + link.sort；
- empty/fallback/sameSubmitter、动态层级与方向；
- duplicate approver rule；
- HIDDEN / VIEW / EDIT 字段权限；
- pass/reject 字段更新；
- Webhook test/runtime/security/audit。

但前端仍存在三个过渡状态：

1. `ApprovalFlowCanvas.vue` 只渲染审批节点数组，并自动生成顺序边；
2. `ApprovalFlowDrawer.vue` 遇到 CONDITION / DEFAULT 后把画布锁成只读，禁止保存；
3. API `ApprovalFlowConfigService.createGraph()` 在 `createLinks` 缺失时仍调用 `createLinearGraph()`，形成第二套写协议。

此外，部分 Browser/API Smoke 仍通过只传审批节点数组创建/更新流程。9.4F 必须同时迁移这些调用方，否则删掉服务端兼容后会出现测试夹具与真实 UI 使用不同契约。

## 4. 9.4F UI 边界

### 4.1 图编辑

MicroMatrix 继续使用已安装的 Vue Flow，不引入第二套流程 DSL。图编辑以显式 nodes/links 为唯一前端 truth：

- START / END 固定各一个，不允许删除；
- APPROVER / CONDITION / DEFAULT 可在画布新增；
- 节点通过 Handle 建立连线；
- 连线创建时先做轻量 fail-closed 约束：禁止自环、重复边、START 入边、END 出边；普通节点不允许并行普通后继；条件分支只能由 CONDITION / DEFAULT 构成；
- 保存前在前端执行与服务端同语义的完整图校验，最终仍以服务端校验为权威；
- 节点拖动只影响画布布局，不进入业务 payload。

### 4.2 条件配置

- CONDITION 支持 `AND / OR`；
- 字段来源使用当前 approval form 对应 metadata；系统字段提交 `field.key`，自定义字段提交 `field.id`；
- 支持当前后端已实现的 EQUALS/NOT_EQUALS/IN/NOT_IN/BETWEEN/GT/LT/GE/LE/CONTAINS/NOT_CONTAINS/EMPTY/NOT_EMPTY/NOT_EQUAL_ORIGINAL；
- DEFAULT 不保存 conditionConfig；
- 分支优先级使用入边 `sort`，允许在节点配置区调整，并在同父节点内归一为唯一非负整数。

### 4.3 审批节点高级设置

只开放已有真实 runtime 的能力：

- USER / ROLE / DIRECT_LEADER / DEPT_LEADER / MULTIPLE_*；
- 层级 1～10 与 BOTTOM_UP / TOP_DOWN；
- ANY / ALL；
- emptyApproverAction / fallbackApprover；
- sameSubmitterAction；
- ccUserIds；
- fieldPermissions；
- pass/reject fieldUpdateConfigs；
- pass/reject webHookConfig + 安全测试连接。

流程级 `allowWithdraw / allowAddSign / requireComment / duplicateApproverRule` 同样解除历史 disabled 状态，因为对应 DB-011/012 runtime 已完成。`allowBatchProcess` 继续禁用。

## 5. 统一图写契约

9.4F 后写接口只接受显式图：

- `createNodes` 必须同时包含 START 与 END；
- 每个节点必须有稳定 clientId；
- `createLinks` 必填；
- 服务端不再创建 START/END、不再推断审批节点顺序、不再自动补 link；
- 更新时按完整图内容比较，只有节点/连接业务内容变化才新建 FlowVersion；只改名称、说明、启停或流程级设置不得制造无意义版本。

仓库内旧调用方统一通过显式 graph helper 或 detail round-trip 保留所有节点、link 与高级配置，禁止把高级图重新过滤成 approver-only。

## 6. 验收重点

1. API 明确拒绝 `createNodes-only` legacy payload。
2. 线性流程也必须由 UI/Smoke 显式提交 START/APPROVER/END + links。
3. Browser 能创建条件图、编辑 CONDITION、DEFAULT、审批节点高级配置并真实 PUT 保存。
4. Browser 能再次打开并完整回显 field permissions、post fields、Webhook 与异常策略。
5. 同一图仅修改流程说明不增加 FlowVersion；节点/连接变化才增加版本。
6. 9.4A 原“高级图只读保护”测试改为“高级图真实可编辑”。
7. legacy scan 不再出现 production `createLinearGraph`、`createNodes-only` 兼容路径或高级图只读锁。

## 7. 结论

9.4F 不再增加新的审批业务模型或 migration，核心任务是把 9.4A～9.4E 已经落地的后端能力完整暴露给真实流程设计器，并删除过渡双写协议。完成后 DB-012 可以从 `IN_PROGRESS` 切换为 `VERIFIED`，随后只剩 W3.7-9.5 总封板。
