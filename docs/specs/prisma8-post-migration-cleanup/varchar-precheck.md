# PRISMA8-002 Existing DB VarChar / ID Precheck

状态：`P3.2 COMPLETE / P3.3 VERIFIED`

## 1. 物理 schema

2026-09-18 existing DB 只读检查：

- contract VarChar 字段：**476**
- existing DB 匹配列：**476/476**
- 物理类型/长度与 contract 不一致：**0**
- 已有非空数据的 VarChar 列：**173**
- 非空 VarChar 值总数：**2467**
- 超过声明长度的数据：**0**

现有数据满足为每个字段增加等价 `char_length(column) <= n` CHECK 的前提。

接近当前长度上限的数据主要集中在 32 位历史 ID/reference；另有 `SysModuleField.type varchar(20)` 已出现长度 20 的合法协议值，因此不能通过统一缩短长度来减少类型种类。

## 2. IDENTIFIER 值域

361 个 IDENTIFIER 字段中，当前 **131** 个字段存在非空值，共 **1794** 个值：

| 形态 | 数量 |
| --- | ---: |
| CUID/CUID-like | 1621 |
| 32-hex | 17 |
| RFC UUID | 0 |
| 其它历史/协议标识 | 157 |
| 空字符串 | 0 |

“其它”值抽样包括 `SYSTEM/system`、`u<hex>`、`org-<hex>` 与 `NONE` sentinel。

结论：existing DB 不具备整体迁移到 PostgreSQL `uuid` 的数据条件；本轮 ID storage 继续保持字符串语义。

## 3. P3.3 migration 前置条件

正式 forward migration 必须：

1. 把目标 `varchar(n)` 改为 `text`；
2. 对每一列新增 contract-declared CHECK：`char_length(column) <= n`；
3. 保持 nullability、PK/FK、unique/index、default 与业务值不变；
4. existing DB apply 前后逐列校验 count/max length/value fingerprint；
5. fresh DB 执行 baseline + timestamp migration + VarChar migration + Seed；
6. `db verify` / `migration status` 全绿后，才进入 P3.4 helper 删除。

## 4. P3.3 正式迁移结果

正式 forward migration：`20260918T0923_varchar_text_length_constraints`。

- contract：476 个 `VarChar(n)` 全部改为 `String`；
- generated TypeScript：`Varchar<N>` 引用归零；
- migration：**476 ALTER COLUMN TYPE text + 476 ADD CHECK = 952 operations**；
- existing DB：**476/476 text**、**476/476 CHECK**；
- existing DB 值指纹：476 列、2467 个非空值，迁移前后 **0 mismatch**；
- existing DB：`db verify` PASS，`migration status` Up to date；
- fresh DB：baseline 672 + timestamp 126 + varchar 952 = **1750 operations**，随后 Seed / verify / status 全绿；
- API typecheck/build PASS，完整 API Rules **346/346 PASS**。

因此 P3.3 已满足“保留长度约束但去除 VarChar branded runtime type”的目标，后续进入 P3.4 应用 helper 清退。

