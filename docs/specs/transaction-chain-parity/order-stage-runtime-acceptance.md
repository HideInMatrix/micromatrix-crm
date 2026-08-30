# W3.6.5 订单状态流 runtime 专项验收

> 验收日期：2026-08-30。范围：W3.6.5 task 6.2C。本文只确认订单 stage CRUD/sort/rollback、NORMAL/ADVANCED circulation、字段条件、业务 `update/stage`、billboard `pos` 以及共享状态流修复的合同回归；CREATE/UPDATE/DELETE 审批闭环留在 6.2D。

## 1. Stage API 与 runtime

订单状态流已接入真实 runtime：

- `GET /order/stage/get`
- `POST /order/stage/add`
- `GET /order/stage/delete/:id`
- `POST /order/stage/update`
- `POST /order/stage/update-rollback`
- `POST /order/stage/sort`
- `GET /order/stage/circulation-type/:type`
- `POST /order/stage/advanced/config`

业务 `POST /order/update/stage` 不再直接写 stage，而是先经过当前租户订单状态流配置校验；成功流转后同步返回真实 `stage / stageName / pos`，并保存业务快照。

## 2. Stage CRUD / sort / delete guard

- 新增阶段支持指定目标阶段与插入位置。
- 更新阶段名称后 GET 可读回。
- 排序会重写连续 `pos`，billboard 位置与状态流排序保持一致。
- `stageHasData` 由当前租户 `sales_order.stage` 实时计算。
- 已被订单使用的阶段禁止删除；专项 Smoke 已验证返回 400。
- Smoke 创建的临时订单、临时阶段会在结束时删除，并恢复原排序。

## 3. NORMAL circulation

NORMAL 流转不再使用“只比较前后位置”的简化判断，而是按 Cordys `StageAdvancedConfigService` 的 `afootRollBack / endRollBack` 四种组合语义执行：

- 两者均开：允许回退。
- 两者均关：只允许向后流转。
- 仅 `endRollBack`：向后允许；回退到非 AFOOT 允许；AFOOT -> AFOOT 回退拒绝。
- 仅 `afootRollBack`：END 起点禁止回退；AFOOT 起点可回到 AFOOT/END，其他情况拒绝。

订单与合同共用的 NORMAL 判断已同步修正，避免两个交易模块出现状态流语义漂移。

## 4. ADVANCED circulation 与字段条件

ADVANCED 模式使用通用 `stage_advanced_config`，模块类型为订单：

- 只有显式启用的 `originId -> targetId` 才允许流转。
- 目标可配置 `circulationFieldValues` 字段条件。
- 条件支持真实订单 metadata `fieldId`。
- `required=true` 时，业务 `update/stage` 未带字段值会拒绝；携带字段值后允许流转并写入 direct field/blob。

专项 Smoke 使用 `orderConsignee` 动态字段验证：未传值流转返回 400；传入字段值后成功进入目标阶段，detail 可再次读取该值。

## 5. DTO whitelist 修复

专项 Smoke 暴露出一个真实 DTO 基础问题：`circulationFieldValues` 在 Nest validation whitelist 后会从对象数组退化成 `[[]]`。

现已增加共享强类型 `StageCirculationFieldValueDto`，订单和合同 circulation DTO 都改为嵌套强类型校验。实测保存并重新 GET 后保持：

`{ fieldId, required, valueType }`

不再发生字段被 whitelist 丢弃。

## 6. 订单专项 Smoke

命令：

`pnpm smoke:w365-order-stage`

最终回归结果：**PASS / exit 0**。

覆盖：

1. 管理员真实登录与订单表单字段读取。
2. stage add/update/sort/get。
3. rollback 开关保存与读取。
4. `stageHasData` 与删除保护。
5. NORMAL 前进、禁止回退、允许回退。
6. ADVANCED 指定边、禁止未配置边。
7. ADVANCED required metadata 字段条件。
8. 真实 `/order/update/stage` 写入 stage、字段值与 billboard `pos`。
9. detail 再读取 stage 与动态字段。
10. finally 恢复原 circulation、rollback、stage 排序并清理夹具。

## 7. W3.6.3 合同隔离回归

共享 circulation DTO 与 NORMAL 判断同时影响合同，因此在关闭 6.2C 前重新运行 `apps/api/scripts/w363-contract-http-smoke.mjs`。

最终结果：**PASS / exit 0**。

- 使用独立临时数据库 `w363_contract_api_fb5ce42653`。
- 本阶段当时从零应用 **54/54 migrations** 并执行 Seed，结束后自动清理临时库；W3.6.5 6.4 最终验收已进一步完成 **56/56 migrations + Seed** 空库复放。
- contract module form、page/get/snapshot/update、Saved View、NORMAL/ADVANCED stage、batch update/sort/statistic 全绿。
- DataScope `ALL / DEPT / SELF` 全绿。
- CREATE/UPDATE/DELETE approval、revoke rollback、batch approval 全绿。
- legacy `/contracts` 继续 404。

这确认订单状态流共享修复没有破坏已关闭的 W3.6.3 合同模块。

## 8. Build / typecheck

- `pnpm --filter @micromatrix/api typecheck`：此前专项回归 **exit 0**。
- `pnpm --filter @micromatrix/api build`：本次关闭前重新执行，**exit 0**。

## 9. 结论与下一边界

W3.6.5 **6.2C 已关闭**。订单状态流主功能、业务 runtime、字段条件和共享合同回归均已有可复现证据。

下一执行指针为 **6.2D：Approval + snapshot + notification**，范围限定为 CREATE/UPDATE/DELETE、reject/revoke rollback、`approved` 事实位与 `ORDER_APPROVAL`；独立订单页面仍留在 6.2E。
