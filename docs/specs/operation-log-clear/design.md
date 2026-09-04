# LOG-003 操作日志全量清空设计

## 1. 现状

LOG-002 已提供：

- `POST /logs/cleanup`：按租户 retention 策略清理过期操作日志；
- `/system/logs` 日志策略 Drawer；
- `system:log:update` 写权限；
- `operation_logs -> operation_log_blobs` 级联删除。

当前“立即清理”按钮的实际语义是执行 retention 清理，因此在日志尚未超过保留期限时会返回 `deleted=0`，日志仍然存在。

## 2. API

新增：

```text
POST /logs/clear-all
permission: system:log:update
```

返回：

```ts
interface OperationLogClearResultVO {
  deleted: number
}
```

Service 使用：

```ts
prisma.operationLog.deleteMany({
  where: { tenantId },
})
```

Prisma FK cascade 自动清理对应 Blob。

本接口故意不加 `@LogOperation`。如果清空成功后 interceptor 再写入 `systemLog/clearAll`，页面会立刻出现一条新操作日志，与“清空全部”契约冲突。

## 3. Web

现有按钮“立即清理”改名为“清理过期日志”。

新增危险按钮“清空全部操作日志”。点击后使用 input confirm，要求输入 `清空`。确认内容显示当前列表已知总数，并说明实际删除数量以服务端返回为准。

完成后：

1. 提示 `已清空 N 条操作日志`；
2. 重置操作日志页码到 1；
3. 重新请求操作日志列表；
4. 重新请求策略状态。

## 4. 测试

- Service 测试 tenantId 条件不可缺失；
- 验证返回真实 `deleteMany.count`；
- Controller 路由保持 `system:log:update`；
- 扫描全量清空接口不使用 `@LogOperation`；
- API Rules、root typecheck、lint、production build、Prettier、`git diff --check`。
