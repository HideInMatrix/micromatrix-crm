# PRISMA8-002 技术设计

## 1. 原则

本单元不是再次迁移 ORM，而是把迁移过程中为降低风险保留的 compatibility boundary 逐步替换成正式架构。

处理顺序固定为：

```text
纯 runtime workaround
  -> 测试 compatibility facade
  -> 时间语义/API 边界
  -> varchar / ID schema 治理
  -> numeric / json domain type 收口
  -> Prisma8* 过渡命名删除
```

越靠前越不应修改数据库；越靠后越需要 existing DB + fresh DB 双路径验证。

## 2. Runtime 模块格式

当前项目使用 Prisma 8 contract runtime：

```text
contract.prisma
  -> prisma contract emit
  -> generated/contract.json + contract.d.ts
  -> @prisma/orm-postgres/runtime
```

`moduleFormat = "cjs"` 属于 Prisma Client generator 配置，不属于当前 `@prisma/orm-postgres` contract config。当前安装的 `@prisma/orm-postgres@8.0.0-rc.10` 已实测可由 CommonJS `require()` 加载，因此不引入无效的 `moduleFormat` 配置；生产代码直接静态 import runtime。

## 3. 测试 compatibility layer

当前 `src/testing/prisma-fixture-client.ts` 模拟 Prisma 7 delegate 形态，并依赖 5k+ 行静态 `prisma-fixture-metadata.ts` 做 model/field/relation 翻译。

收口策略不是一次删除全部测试，而是：

1. 建立 Prisma 8 原生 test database helper，只负责 client lifecycle、tenant/id/time 等通用 fixture 原语；
2. 按模块把测试 setup/assert/cleanup 改为 `client.orm.public.<Model>` 原生 API；
3. 每迁完一批，减少 `createPrismaFixtureClient` 引用；
4. 引用归零后删除 fixture facade 与 metadata；
5. 禁止再新增 Prisma 7 风格 delegate API。

## 4. 时间模型

### 4.1 存储与展示职责

- PostgreSQL 保存时间语义；
- Prisma 8 使用正式 timestamp/timestamptz codec；
- API serializer 输出 ISO 8601；
- 前端格式化展示。

### 4.2 迁移路径

先 inventory 126 个 Timestamp 字段，分类为：

- absolute instant；
- local/wall-clock datetime；
- schedule/time-of-day。

只有 absolute instant 才评估 `timestamp -> timestamptz`。旧值转换必须通过数据 precheck 确认历史写入约定；若历史值为 UTC，则 migration 显式使用 `AT TIME ZONE 'UTC'`。

应用层逐步改为直接接受 Prisma 8 Temporal 或统一 serializer，删除业务内部 `Date <-> Temporal` 往返。

## 5. VarChar / ID

当前 contract 含大量 `VarChar(N)`，Prisma 8 将其暴露为 branded type。不能仅为了消除 cast 将其全部改成无约束 `text`。

候选方案按字段分类评估：

- 业务自由文本：可评估 `text + CHECK(char_length(...) <= N)`；
- 固定长度/协议字段：保留 varchar/domain；
- 32 位历史 ID：先确认值域；真正 UUID 才评估 PostgreSQL `uuid`，非 UUID 继续 String；
- 所有变化通过 forward migration，并在 existing DB 上先跑长度/格式 precheck。

## 6. Numeric / JSON

- `numeric(p,s)` 保持精确类型，应用 domain 改为 decimal string/typed value，不改浮点；
- `jsonb` 保持 JSON 类型，通过 DTO/serializer 收紧输入，逐步删除仅做 cast 的 helper。

## 7. 验证策略

每一阶段最少执行：

- contract emit；
- API typecheck；
- production build；
- 受影响模块真实 PostgreSQL tests。

数据库阶段额外执行：

- existing DB precheck；
- migration plan / apply；
- db verify / migration status；
- fresh DB baseline + forward migrations + seed；
- 完整 API Rules 与 Docker release smoke。

