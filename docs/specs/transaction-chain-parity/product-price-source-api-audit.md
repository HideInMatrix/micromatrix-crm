# W3.6.1 产品与价格表源码、DDL 与 API 证据矩阵

> 状态：SOURCE LOCKED / READY FOR IMPLEMENTATION
>
> 目标：只以 CordysCRM 源码、最终 migration 和前端真实调用为事实来源，确定 W3.6.1 的直接模型、API、页面和 `/system/modules` 关闭范围。MicroMatrix 当前 `/products` 自定义模型只作为迁移输入，不作为目标契约。

## 1. 产品：页面 → API → Controller → Service → Domain → DDL

### 1.1 Cordys 页面行为

来源：`CordysCRM/frontend/packages/web/src/views/product/index.vue`

- 列表由动态表单字段驱动，支持关键字、筛选、分页、排序和拖拽。
- 单条操作：详情、编辑、删除。
- 批量操作：导出选中、批量编辑、批量删除。
- 顶部动作：新建、导入、导出全部。
- 权限：`PRODUCT_MANAGEMENT:READ/ADD/UPDATE/DELETE/IMPORT/EXPORT`。
- 新建/编辑复用 `CrmFormCreateDrawer + FormDesignKeyEnum.PRODUCT`；详情复用动态表单详情。

### 1.2 Cordys 前端 API

来源：

- `CordysCRM/frontend/packages/lib-shared/api/modules/product.ts`
- `CordysCRM/frontend/packages/lib-shared/api/requrls/product.ts`

产品目标契约：

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/product/module/form` | 产品表单配置 |
| POST | `/product/page` | 产品分页/筛选 |
| GET | `/product/get/:id` | 产品详情 |
| POST | `/product/add` | 新建产品 |
| POST | `/product/update` | 更新产品 |
| POST | `/product/batch/update` | 批量编辑 |
| GET | `/product/delete/:id` | 删除产品 |
| POST | `/product/batch/delete` | 批量删除 |
| POST | `/product/edit/pos` | 拖拽排序 |
| GET | `/product/list/option` | 当前组织全部产品 option |
| GET | `/product/template/download` | 下载导入模板 |
| POST | `/product/import/pre-check` | 导入预校验 |
| POST | `/product/import` | 正式导入 |
| POST | `/product/export-all` | 导出全部 |
| POST | `/product/export-select` | 导出选中 |

### 1.3 Cordys Controller / Service

来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/controller/ProductController.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/service/ProductService.java`

关键语义：

- 产品目录按 `organization_id` 隔离，不使用负责人/部门 DataScope；读取权限仍由产品 READ 权限控制。
- 新增时写 `pos = getNextOrder(orgId)`，排序步长使用 Cordys 公共 `POS_STEP`。
- 主表字段和动态字段同一业务动作保存；动态字段写 `product_field/product_field_blob`。
- 更新动态字段时是删除目标资源旧字段值后重新保存，不保留 JSON 双写。
- 批改可修改主字段或动态字段。
- 单删/批删同时清理产品动态字段。
- 产品 option 返回当前组织下 `id/name`。
- 导入/导出完全由动态表单字段驱动。
- `checkProductList` 限制业务引用中的产品选择最多 20 个。

### 1.4 Cordys Product 直接模型

来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/domain/Product.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/domain/ProductField.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/domain/ProductFieldBlob.java`
- `CordysCRM/backend/crm/src/main/resources/migration/1.0.0/ddl/V1.0.0_2__system_setting.sql`
- `CordysCRM/backend/crm/src/main/resources/migration/1.0.3/ddl/V1.0.3_2__ga_ddl.sql`
- `CordysCRM/backend/crm/src/main/resources/migration/1.0.4/ddl/V1.0.4_2__ga_ddl.sql`

最终主表字段：

```text
product
  id              varchar(32) PK
  name            varchar(255) NOT NULL
  price           decimal(14,4) NULL
  status          varchar(32) NOT NULL
  pos             bigint NOT NULL
  organization_id varchar(32) NOT NULL
  create_time      bigint NOT NULL
  update_time      bigint NOT NULL
  create_user      varchar(32) NOT NULL
  update_user      varchar(32) NOT NULL
```

动态字段：

```text
product_field(resource_id, field_id, field_value varchar(255))
product_field_blob(resource_id, field_id, field_value text)
```

结论：MicroMatrix 当前 `products` 表中的 `code/category/unit/cost/description/customData/ownerId/deptId/createdAt/updatedAt` **不是 Cordys 产品主表字段**。若需要“描述、图片”等信息，应作为产品动态字段进入 Field/Blob，而不是继续保留自定义主表列。

### 1.5 Cordys 产品默认表单

来源：`CordysCRM/backend/crm/src/main/resources/form/field.json`

- `productName` → 主表 `name`，必填 + unique。
- `productPrice` → 主表 `price`。
- `productStatus` → 主表 `status`，必填，默认 `1`。
- `productDescription` → 动态 TEXTAREA。
- `productPic` → 动态 PICTURE/Blob 体系。

状态：

- `1` = 上架
- `2` = 下架

## 2. 价格表：页面 → API → Controller → Service → Domain → DDL

### 2.1 Cordys 页面行为

来源：`CordysCRM/frontend/packages/web/src/views/product/price.vue`

- 价格表是独立完整业务页，不是 Product 的一个附属字段。
- 单条动作：详情、编辑、复制、删除。
- 批量动作：导出选中、批量编辑；Cordys 页面没有批量删除价格表动作。
- 顶部动作：新建、导入、导出全部。
- 支持关键字、高级筛选、分页、排序、拖拽。
- 权限：`PRICE:READ/ADD/UPDATE/DELETE/IMPORT/EXPORT`。
- 新建/编辑使用 `FormDesignKeyEnum.PRICE` 动态表单。

### 2.2 Cordys 前端 API

来源：

- `CordysCRM/frontend/packages/lib-shared/api/modules/product.ts`
- `CordysCRM/frontend/packages/lib-shared/api/requrls/product.ts`

价格表目标契约：

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/price/module/form` | 价格表表单配置 |
| POST | `/price/page` | 分页/高级筛选 |
| GET | `/price/get/:id` | 详情 |
| POST | `/price/add` | 新建 |
| POST | `/price/update` | 编辑 |
| GET | `/price/copy/:id` | 复制 |
| GET | `/price/delete/:id` | 删除 |
| POST | `/price/batch/update` | 批量编辑 |
| POST | `/price/edit/pos` | 拖拽排序 |
| GET | `/price/template/download` | 下载导入模板 |
| POST | `/price/import/pre-check` | 导入预校验 |
| POST | `/price/import` | 正式导入 |
| POST | `/price/export` | 导出全部 |
| POST | `/price/export-select` | 导出选中 |

### 2.3 Cordys Controller / Service

来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/controller/ProductPriceController.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/service/ProductPriceService.java`

关键语义：

- 新增/编辑时会把 `products` 子表数据追加到 `moduleFields`，统一写入价格表 Field/Blob 表。
- 详情通过动态表单配置还原普通字段、Blob、附件以及子表数据。
- 复制会复制主表和全部价格表动态字段/子表字段，名称截断后追加 `_copy_<random>`，并生成新的 pos/audit 字段。
- 删除前检查是否被报价字段引用；被使用的价格表不可删除。
- 批量更新支持主字段和动态字段。
- 导入支持多级表头/子表字段。

### 2.4 Cordys ProductPrice 直接模型

来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/domain/ProductPrice.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/domain/ProductPriceField.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/product/domain/ProductPriceFieldBlob.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/common/domain/BaseResourceSubField.java`
- `CordysCRM/backend/crm/src/main/resources/migration/1.4.0/ddl/V1.4.0_2__ga_ddl.sql`
- `CordysCRM/backend/crm/src/main/resources/migration/1.4.2/ddl/V1.4.2_2__ga_ddl.sql`
- `CordysCRM/backend/crm/src/main/resources/migration/1.5.0/ddl/V1.5.0_3__modify_sub_key.sql`

最终主表：

```text
product_price
  id              varchar(32) PK
  name            varchar(255) NOT NULL
  status          varchar(32) NOT NULL
  pos             bigint NOT NULL
  organization_id varchar(32) NOT NULL
  create_time      bigint NOT NULL
  update_time      bigint NOT NULL
  create_user      varchar(32) NOT NULL
  update_user      varchar(32) NOT NULL
```

Field/Blob 同时承担普通动态字段和子表格 cell：

```text
product_price_field
  resource_id
  field_id
  field_value varchar(255)
  ref_sub_id nullable
  row_id nullable
  biz_id nullable

product_price_field_blob
  resource_id
  field_id
  field_value text
  ref_sub_id nullable
  row_id nullable
  biz_id nullable
```

最终子表 cell 唯一键按 Cordys 1.5.0 为：

```text
(resource_id, ref_sub_id, row_id, field_id)
```

`biz_id` 是同一业务行的稳定行标识，用于子表数据重组和后续编辑。

### 2.5 Cordys 价格表默认表单

来源：

- `CordysCRM/backend/crm/src/main/resources/form/field.json`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/common/constants/BusinessModuleField.java`

系统字段：

- `priceName` → 主表 `name`，必填 + unique。
- `priceStatus` → 主表 `status`，必填，默认 `1`。
- `priceProducts` → `SUB_PRODUCT` 子表。
- `priceProduct` → 子表 DATA_SOURCE(PRODUCT)，必填。
- `priceProductAmount` → 子表 INPUT_NUMBER，必填。

默认状态：

- `1` = 启用
- `2` = 禁用

默认 `products` 子表还可包含 SKU、税点、重要说明等可配置列；这些不是主表列，必须继续使用子表 Field/Blob cell 存储。

## 3. `/system/modules` 产品卡片关闭范围

来源：`CordysCRM/frontend/packages/web/src/views/system/module/components/configCard.vue`

Cordys 产品卡只有两个配置入口：

1. `产品表单设置` → `FormDesignKeyEnum.PRODUCT`
2. `价格表表单设置` → `FormDesignKeyEnum.PRICE`

MicroMatrix 当前：

- 产品表单设置：已有 metadata 入口，但字段模板仍是旧自定义 Product 主表，需随 2.2 改为 Cordys 字段。
- 价格表表单设置：当前只有占位文本，必须在 W3.6.1 内变为真实动态表单设置入口。

因此 2.3 关闭门槛是两个入口都能真实打开、读写字段配置并驱动对应页面/API。

## 4. MicroMatrix 当前差异与破坏式迁移范围

### 4.1 当前产品模型/API 不可保留为目标契约

当前：

```text
products
  tenantId/name/code/category/unit/price/cost/status/description/customData/ownerId/deptId/createdAt/updatedAt

GET/POST/PATCH/DELETE /products...
```

目标：

```text
product + product_field + product_field_blob
/product/*
```

W3.6 规则明确不保留旧 `/products` 兼容 Controller、旧表双写或 `customData` 真相源。

### 4.2 当前完全缺失价格表业务域

当前 Prisma/API/Web 没有 Cordys `product_price` 业务对象。

必须新增：

- `ProductPrice/ProductPriceField/ProductPriceFieldBlob` 直接模型。
- `/price/*` Controller/Service/DTO。
- 价格表 PC 页面、详情/编辑/复制/删除/批改/排序/导入导出。
- `price` metadata/system fields 和 `/system/modules` REAL 配置入口。

## 5. 跨模块影响扫描

产品直接模型切换不能只修改 ProductsModule。已锁定调用方：

### API

- `OpportunitiesService.validateProducts()`：当前仍按旧 `Product.tenantId` 查询。
- `QuotesService`：从商机意向产品带入报价时仍读取旧 `Product.tenantId/unit`；Cordys 新 Product 无 `unit` 主表列。
- `MembersService`：当前用旧 `Product.ownerId` 阻止删除成员；Cordys Product 无负责人字段，应删除该引用判断。
- Root Smoke：产品历史数据清理、产品 CRUD/交易链夹具仍使用 `/products` 和 `ON/OFF`。

### Web

- `apps/web/src/api/deal.ts`：旧 `/products` API。
- `ProductsView.vue`：旧字段、旧 toggle-status 动作。
- `OpportunitiesView.vue`：产品 option 读取旧产品分页接口。
- `LineItemsEditor.vue`：读取旧 ProductVO 的 `unit`；迁移后至少只能可靠带出 `name/price`，其它报价/合同明细字段由交易单据自身维护。

### Shared / Metadata / Seed

- `ProductVO` 仍暴露 `code/category/unit/cost/ownerId` 等旧字段。
- `MODULE_SYSTEM_FIELDS.product` 仍把旧主表字段当系统字段。
- 当前无 `price` system fields。
- Seed 只有 `product:*` MicroMatrix 权限，无价格表权限族。

## 6. W3.6.1 实施决策

### D1 数据库

- 使用 forward-only migration 创建 Cordys `product/product_field/product_field_blob/product_price/product_price_field/product_price_field_blob`。
- 从旧 `products` 仅迁移 Cordys 能表达的主字段：`id/name/price/status/tenantId/createdAt/updatedAt`；旧额外列不作为新主表列保留。
- `ON/OFF` 映射为 Cordys `1/2`。
- 若旧 description/customData 中存在仍需保留的数据，只能在明确对应新动态字段定义后写入 Field/Blob；不得复制成新 JSONB。
- 迁移完成后删除旧 `products` 表。

### D2 动态字段

- 扩展 `ResourceFieldValueService` 支持 `product`。
- 价格表需要额外支持 `refSubId/rowId/bizId` 的子表 cell；不能用现有仅 `(resourceId, fieldId)` 的普通动态字段逻辑冒充。

### D3 API

- 产品只暴露 Cordys `/product/*`。
- 价格表只暴露 Cordys `/price/*`。
- 删除旧 `/products` REST 契约及其前端调用。

### D4 页面

- 产品列表/详情/新建编辑按 Cordys 动态表单和批量动作收口。
- 新增独立价格表页；页面动作与 Cordys 对齐，不人为增加批量删除。
- 产品 option 统一使用 `/product/list/option`。

### D5 系统模块设置

- 产品表单字段模板改为 Cordys 主字段 + 默认动态字段。
- 新增 `price` 表单字段模板及真实设置入口。

## 7. 2.2 实施顺序

1. Prisma 直接模型 + forward migration + 空库/现库副本验证。
2. 扩展 Product Field/Blob 动态字段存储；实现价格表子表字段存储。
3. 重建 `/product/*` API，迁移所有服务调用方，删除 `/products`。
4. 新建 `/price/*` API。
5. 重建 ProductVO / Price VO 与 Web API。
6. 产品页面迁移；新增价格表页面。
7. `/system/modules` 两个入口 REAL。
8. 专项 API/DB Smoke + Browser Smoke + 根回归。

## 8. W3.6.1 最终实施结果（2026-08-29）

- Product 已切换 Cordys 直接主表和 `product_field/product_field_blob`；`description` 与 `productPic` 均不再占用产品主表列。`productPic` 按 Cordys PICTURE 语义保存文件 key 数组并进入 Blob，且按 `BaseField.canImport/canExport()` 从 Excel 导入导出排除。
- 旧 `/products` API、`ON/OFF` 状态以及 `code/category/unit/cost/ownerId/deptId` 产品旧主字段契约均已从运行时代码清除；产品业务 API 只保留 `/product/*`。
- Price 已建立独立主表、Field/Blob 与 `/price/*`；`SUB_PRODUCT` 以 `ref_sub_id/row_id/biz_id` 保存产品、SKU、产品定价和税点，其中产品/定价按 Cordys 默认表单设为 required。
- 价格表 Excel ADD/UPDATE 与导出已实现 Cordys 多级表头：主字段纵向合并，`产品信息` 为一级父表头，产品/SKU/产品定价/税点为二级子表头；ADD 按价格表名称聚合连续子行，UPDATE 按唯一 ID 聚合。
- `/system/modules` 的产品表单和价格表表单均为真实 ModuleForm 入口；现有租户元数据由 forward migration 补齐，不依赖重跑 Seed。
- migrations：`20260828234500_w361_product_price_direct_models`、`20260828235900_w361_product_form_metadata_repair`、`20260829091500_w361_product_picture_price_subtable_metadata`。正式库 43/43，空库 43/43 + 双 Seed。
- 验收：专项 Service Smoke 全绿，Browser **19/19**，根 Smoke **224/224**，Rules **114/114**，全仓 typecheck/ESLint/production build 全绿。
- 仍由 W3.6.2 关闭的跨域依赖只有“Quote Field/Blob 引用价格表后的删除保护”；在报价直接模型完成前不保留或新建旧 Quote 兼容真相源。

