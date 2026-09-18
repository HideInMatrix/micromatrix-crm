# PRISMA8-002 Existing DB Timestamp Precheck

状态：P2.4 COMPLETE / P2.5 VERIFIED

## 1. 目的

在 canonical contract 从 Timestamp(3) 迁移到 Timestamptz(3) 前，只读验证 existing DB 的历史写入语义，确认旧 timestamp without time zone 值应按 UTC 解释。

## 2. 开发库结果

- database：default
- PostgreSQL session timezone：UTC
- canonical Timestamp 字段：126
- existing DB 匹配物理列：126/126
- 物理类型：126/126 = timestamp without time zone
- 缺失列：0
- 异型列：0
- CURRENT_TIMESTAMP DB default：50
- 无 DB default：76
- 有非空历史数据的列：52
- 当前为空的列：74
- 最早值：2026-09-07 03:47:17.978
- 最晚值：2027-09-07 03:47:18.293（SCHEDULED_INSTANT）
- AUDIT / EVENT_INSTANT 中超过当前 UTC + 24h 的异常未来值：0

## 3. 抽样结果

    users.createdAt
    2026-09-07 03:47:18.412
    -> 2026-09-07 03:47:18.412+00

    operation_logs.createdAt
    2026-09-10 05:15:23.645
    -> 2026-09-10 05:15:23.645+00

    bidding_infos.deadline
    2026-09-22 00:16:33.974
    -> 2026-09-22 00:16:33.974+00

    subscriptions.currentPeriodEnd
    2027-09-07 03:47:18.293
    -> 2027-09-07 03:47:18.293+00

上述结果与现有 compatibility boundary 的实际行为一致：旧 Timestamp 一直被按 UTC wall value 解释为 absolute instant。

## 4. Forward migration 规则

126 列统一使用显式 UTC 解释：

    ALTER TABLE <table>
    ALTER COLUMN <column>
    TYPE timestamptz(3)
    USING <column> AT TIME ZONE 'UTC';

不得省略 USING ... AT TIME ZONE 'UTC'。否则 PostgreSQL 会根据 migration session timezone 解释旧值，导致迁移结果依赖执行环境。

CURRENT_TIMESTAMP 本身表示 absolute instant，列切换为 timestamptz 后继续保留该 default。

## 5. P2.5 验证条件

1. existing DB apply 前后旧数据对应 UTC instant 不变；
2. 126/126 列物理类型变为 timestamp with time zone；
3. Prisma db verify / migration status 全绿；
4. fresh DB baseline + forward migration + bootstrap Seed 全绿；
5. API typecheck/build/真实 PostgreSQL tests 全绿；
6. PlainDateTime-as-UTC compatibility 路径被删除。

## 6. P2.5 实际结果

- migration：`20260918T0826_timestamp_absolute_instants`
- migration operations：126
- target storage hash：`07748bd3c63b9a5cad29fe7ca01d2112d369c952703a483fb95f34ecd715c0a9`
- migration check：PASS
- existing DB：126/126 列已变为 timestamp with time zone
- existing DB 迁移前 UTC epoch 指纹：`1a7e4fcdfaacffe4b3536924b4b67b90b8aa89998757bae914ef4b2ffe8395b4`
- existing DB 迁移后 UTC epoch 指纹：`1a7e4fcdfaacffe4b3536924b4b67b90b8aa89998757bae914ef4b2ffe8395b4`
- existing DB `db verify`：PASS
- existing DB `migration status`：Up to date
- fresh DB：baseline 672 + forward 126 = 798 operations，PASS
- fresh DB Seed / verify / status：PASS
- fresh DB timestamptz 列：126
- API typecheck / production build：exit 0
- API Rules：346/346 PASS、0 fail、0 skip

第 1–5 项已全部满足；第 6 项属于 P2.2/P2.6 的后续应用层清理，数据库迁移本身已验证完成。
