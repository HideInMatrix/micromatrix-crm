# W3.6.5 订单 direct API 专项验收

> 验收日期：2026-08-30。范围：W3.6.5 task 6.2A / 6.2B。本文只确认订单 direct schema、数据升级、metadata、API、DataScope、Saved View、SUB_PRODUCT、Import/Export 和 legacy exit；状态流高级规则、审批、独立页面与 `/system/modules` 分别留在 6.2C / 6.2D / 6.2E / 6.3 验收。

## 1. Direct schema 与 migration

- `20260830113000_w365_order_direct_models`
  - 建立 `sales_order`、`sales_order_field`、`sales_order_field_blob`、`sales_order_snapshot`、`sales_order_stage_config`。
  - 旧订单保留 id、编号、名称、客户/合同/负责人/金额/审批信息；固定 `OrderStatus` 一次性迁为 stage id。
  - 旧 `customData` 搬入 direct field/blob 后删除 JSON 真相源。
  - 旧 `orders` 表退出，当前 `to_regclass('public.orders') IS NULL`。
- `20260830121000_w365_order_form_fields`
  - 补齐 Cordys 默认订单表单的产品 SUB_PRODUCT 与收货地址、收货人、联系方式。
- `20260830122000_w365_order_form_positions`
  - 修复旧 metadata 升级后保留历史 `pos` 导致的重复排序位；最终表单顺序固定为 0～13。

当前 `default`：最终 6.4 验收已应用 **56/56 migrations**；其中第 55 个修复 direct order nullable schema，第 56 个完成历史订单权限升级。

## 2. 实库升级核对

- 旧订单 **1 -> 1**，原 id/number/contract/customer/owner 均保留。
- 旧 `PENDING` 依历史语义迁到 Cordys“待发货”。
- 默认阶段 **7/7**：新建、待发货、部分发货、已发货、待验收、已完成、已作废；默认 `circulationType=NORMAL`。
- `sales_order / sales_order_field / sales_order_snapshot` 存在，旧 `orders` 不存在。
- `/order/module/form` 实际返回 14 个目标字段，主字段顺序稳定为 `name/number/customerId/contractId/owner/amount`，随后为产品子表和收货字段。

## 3. Direct API 与数据范围

当前订单 namespace 为 `/order`：

- `GET /order/module/form`
- `POST /order/page`
- `POST /order/add`
- `POST /order/update`
- `POST /order/update/stage`
- `POST /order/batch/update`
- `GET /order/delete/:id`
- `GET /order/get/:id`
- `GET /order/get/snapshot/:id`
- `GET /order/module/form/snapshot/:id`
- `GET /order/tab`
- `GET /order/download/:id`
- `POST /order/statistic`
- `POST /order/sort`
- `GET /order/template/download`
- `POST /order/import/pre-check`
- `POST /order/import`
- `POST /order/export-all`
- `POST /order/export-select`

读取范围按 direct owner + `ORDER:READ` 计算；客户 360 `/account/order/page` 使用订单主表 `customerId`，不再经由旧合同反推客户。成员删除引用检查也已切 `organizationId + owner`。

## 4. Saved View 与高级筛选

- User View resourceType：`ORDER`。
- URL：`/order/view/*`。
- `/order/page` 会将 Saved View filters 与 ad-hoc filters 求交，再叠加 direct DataScope。
- direct 字段与普通 metadata 字段使用同一筛选链路。

## 5. 产品 SUB_PRODUCT

订单没有固定 `OrderItem` 表。产品行保存于：

- `sales_order_field`
- `sales_order_field_blob`

并使用：

- `ref_sub_id`
- `row_id`
- `biz_id`

CRUD/detail/snapshot 返回统一 `products`；产品总金额可由产品行自动汇总，调用方显式传入订单金额时仍以显式值为准。

## 6. Import / Export

订单复用公共 `SpreadsheetService + ExportTasksService`，产品明细走二级表头：

- 第一层：订单主字段与普通动态字段。
- 第二层“产品明细”：产品名称、产品单价、数量；产品金额按公式计算。
- 多 Excel 行可聚合为同一订单的多个产品子行。
- 客户支持 ID/名称；合同支持 ID/名称/编号；负责人支持 ID/姓名/邮箱；产品支持 ID/名称。
- 名称匹配出现多个结果时拒绝导入，避免不确定关联。

## 7. 专项 Smoke

命令：

`pnpm smoke:w365-order`

结果：**PASS**。

覆盖：

1. `admin@demo.com` 真实登录。
2. direct `/order/module/form` 与目标字段。
3. 新建含两行产品的订单，产品金额与订单金额正确。
4. page/detail/business snapshot/form snapshot。
5. 客户 360 order page。
6. `/order/view/*` Saved View 与 `/order/page` 过滤。
7. metadata batch update。
8. billboard sort / statistic / download。
9. SUB_PRODUCT 二级表头 template/pre-check/import。
10. 含产品子表的 export task 成功。
11. Smoke 夹具和 User View 清理。
12. legacy `/orders` 返回 404。

API `pnpm --filter @micromatrix/api typecheck` 同步为 exit 0。

## 8. 下一边界

6.2A / 6.2B 已关闭。下一执行指针为 **6.2C：订单 stage CRUD/sort/rollback、NORMAL/ADVANCED circulation、字段条件和业务 `update/stage`**。审批 CREATE/UPDATE/DELETE 不在本阶段混做。
