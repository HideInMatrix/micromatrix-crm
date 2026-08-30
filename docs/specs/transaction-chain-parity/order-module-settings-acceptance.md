# W3.6.5 订单 `/system/modules` 专项验收

> 验收日期：2026-08-30。范围：W3.6.5 task 6.3。

## 1. 订单表单设置

订单卡片“订单表单设置”继续使用 `/system/modules/fields?module=order`。Browser Smoke 已实际点击并确认页面请求 `GET /api/metadata/order/fields`，消费当前 direct order metadata，而不是旧订单 JSON 字段模型。

## 2. 订单状态流设置

原 label-only “订单状态流设置”已替换为真实 `OrderStageSettingsDrawer`。

Drawer 使用 `/order/stage/*`：get、add、update、delete、update-rollback、sort、circulation-type、advanced/config。

交互与已验收合同状态流保持同一模式，支持阶段 CRUD、排序、`stageHasData` 删除保护、进行中/完结回退开关、NORMAL/ADVANCED 流转关系，并保留已有 `circulationFieldValues`。

## 3. Browser Smoke

`pnpm smoke:w365-order-browser` 最终结果：**37 passed / 0 failed / exit 0**。

其中 6.3 专项断言确认：订单表单设置为 REAL 且可点击；订单状态流设置为 REAL 且可点击；表单设置消费 direct metadata；状态流 Drawer 请求 `/api/order/stage/get`；Drawer 显示默认 7 阶段并暴露 rollback、基础流转、高级流转和添加阶段。全程 API 5xx = 0，Runtime exception = 0。

## 4. Build

- Web typecheck：**exit 0**。
- Web production build：**exit 0**。

## 5. 结论

W3.6.5 **6.3 已关闭**。订单卡片不存在 label-only / placeholder，订单表单与订单状态流两项均为真实可用能力。

下一执行指针：**6.4 专项验收与提交**。
