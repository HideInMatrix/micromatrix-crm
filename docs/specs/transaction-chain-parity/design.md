# W3.6 交易链深度对齐技术设计

## 1. 总体策略

W3.6 延续 W3.4 的“直接模型 + Cordys 契约 + 破坏式调用方迁移”策略。执行顺序固定为：商机 → 产品/价格表 → 报价 → 合同 → 回款/发票 → 订单 → 全交易链验收。

每个大模块必须独立完成源码审计、数据库、后端、前端、`/system/modules` 卡片和测试，完成一个再进入下一个。

## 2. 固定交付模板

### 2.1 证据层

记录 Cordys 页面、requrls/API facade、Controller、Service/Job/Listener、Domain/DTO/Mapper、最终 DDL/ALTER migration，以及当前 MicroMatrix 差异。

### 2.2 数据层

- 使用 Cordys 直接主表和 Field/Blob 表；
- 组织字段映射现有 tenant 事实，但业务表/字段保持 Cordys 语义；
- owner/customer/contact/contract 等关联先做租户和访问边界校验；
- 只新增 forward migration，不修改历史 migration。

### 2.3 API 与页面

- 先实现 Cordys Controller，再迁移所有内部调用方，同一任务删除旧自定义 Controller；
- Web facade 使用目标路径，不用长期 adapter 伪装旧路径；
- 主列表、详情、批量动作、User View、导入导出、深链作为一个页面单元验收；
- Board/Stage/Status 使用同一后端数据事实；Mobile 存在对应入口时同步迁移 API。

### 2.4 `/system/modules` 检查点

每个大模块代码完成后立即：重读 Cordys `configCard.vue`；列出 MicroMatrix 同卡片 action；标记 `REAL / PLACEHOLDER / MISSING`；当前模块缺口当场补齐；增加模块设置 API/Browser Smoke；全部 REAL 后才能关闭模块。

## 3. 商机设计

### 3.1 直接模型

目标表：`opportunity`、`opportunity_field`、`opportunity_field_blob`、`opportunity_stage_config`、`opportunity_rule`。

当前 `opportunities`、`opportunity_stages`、`opportunity_stage_logs` 与 `Opportunity.customData` 是旧实现。迁移前先做调用方审计，随后一次性切换；Cordys 没有独立阶段历史表时，不继续把 `opportunity_stage_logs` 当领域真相。

### 3.2 阶段

- `AFOOT`：进行中；`END`：完结；
- 完结 `rate=100` 为成功、`rate=0` 为失败；
- `lastStage` 支持回退；
- `afootRollBack/endRollBack` 是组织级语义；
- 最多 15 个阶段，至少一个 AFOOT。

### 3.3 关闭规则与失败原因

- `ownerId/scopeId/condition` 使用 Cordys JSON 文本契约，Scope 支持用户/部门/角色展开；
- 同负责人多规则按 `createTime desc` 选择最佳匹配，`operator=AND/OR`；
- 自动任务只消费 `enable=true && auto=true`，命中后进入组织失败 END 阶段，`lastStage` 保留原阶段，`failureReason=system`；
- 手工失败复用 `DictionariesModule` 的 `OPPORTUNITY_FAIL_RS`，开关开启时必须是有效原因。

### 3.4 系统模块 UI

新增 `OpportunityStageSettingsDrawer`、`OpportunityCloseRuleSettingsDrawer`、`OpportunityFailureReasonSettingsDrawer`。商机表单和报价表单继续接模块表单页；报价直接字段完成后再次复验报价表单。

## 4. Migration 修复纪律

禁止修改已执行 migration；差异统一新增 forward repair migration，并同时验证现有库 `migrate deploy` 与隔离空库全量复放，Seed 连续运行两次必须幂等。
