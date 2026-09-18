# PRISMA8-002 VarChar / ID 语义盘点

状态：`P3.1 COMPLETE`

## 1. 总量

canonical contract `apps/api/prisma/contract.prisma` 当前共有 **476** 个 `VarChar(n)` 字段。

长度分布：

| 长度 | 字段数 |
| ---: | ---: |
| 10 | 6 |
| 16 | 1 |
| 20 | 6 |
| 30 | 4 |
| 32 | 366 |
| 50 | 20 |
| 64 | 1 |
| 255 | 63 |
| 500 | 2 |
| 1000 | 4 |
| 2000 | 1 |
| 3000 | 2 |

`varchar(32)` 占 **366/476**，是 Prisma 8 generated `Varchar<32>` branded type 与应用层适配调用的主要来源。

## 2. 476/476 分类

| 分类 | 字段数 | 说明 |
| --- | ---: | --- |
| IDENTIFIER | 361 | 主键、外键、组织/用户/资源引用、owner/follower、动态字段关联 ID 等 |
| PROTOCOL | 38 | status/stage/type/module/operator/searchMode/formKey/internalKey 等协议/状态码 |
| TEXT | 52 | name/description/content/remark/address/reason/products/resourceUrl 等受限文本 |
| SERIALIZED_VALUE | 16 | 15 个动态 `fieldValue` + `ApprovalInstances.updateFields` JSON 字符串 |
| BOUNDED_VALUE | 6 | phone/identificationNumber/bankAccount/registrationNumber 等有明确长度上限的业务值 |
| BUSINESS_KEY | 3 | number/no 等业务编号 |

分类优先使用 contract 的 `@id`、`@relation(fields: [...])`，再结合 `*Id`、owner/createUser/updateUser 等历史字段语义；不会把仅因长度为 32 的状态码机械当成 ID。

`ApprovalInstances.updateFields varchar(2000)` 经生产写路径核对，实际保存 `JSON.stringify(updateFields)`，归入 SERIALIZED_VALUE。

## 3. ID 结论

现有 ID/reference 并不是统一 UUID：

- 主体数据大量使用 CUID/CUID-like；
- 部分历史数据使用 32-hex；
- 存在 `SYSTEM` / `system`、`u<hex>`、`org-<hex>` 等历史标识；
- `DashboardModule.parentId` 存在 `NONE` sentinel。

因此 P3 禁止把 361 个 IDENTIFIER 字段整体迁移为 PostgreSQL `uuid`。未来如果某一独立 ID domain 要迁 UUID，需要单独做值域清洗、FK 图审计和数据迁移。

## 4. 正规化方向

本轮目标不是放宽长度规则，而是把 PostgreSQL typmod 与应用 branded type 解耦：

```text
VarChar(n)
  -> String / PostgreSQL text
  + CHECK (char_length(column) <= n)
```

Prisma 8 generated contract 已验证：

- 普通 `String` 使用 `pg/text@1`，TypeScript 为普通 `string`；
- `VarChar(n)` 生成 `Varchar<n>` branded type；
- PostgreSQL target 正式支持 `@@check(expression: ..., name: ...)`，CHECK 会进入 contract / migration / verify。

因此 `String + @@check` 可以保留数据库长度约束，同时从根上删除 `prisma8Varchar/prisma8Varchars` 类型适配。

