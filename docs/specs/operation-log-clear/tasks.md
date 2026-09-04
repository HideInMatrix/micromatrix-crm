# LOG-003 操作日志全量清空任务

- [x] C1 需求与设计冻结
  - 区分 retention 清理与全量清空。
  - 冻结租户/权限/不可恢复确认边界。
  - 冻结 clear-all 成功后不得重新写入操作日志。

- [x] C2 API
  - 新增 `POST /logs/clear-all`。
  - 当前租户 `deleteMany` 并返回真实删除数量。
  - 不使用 `@LogOperation`。

- [x] C3 Web
  - “立即清理”改名“清理过期日志”。
  - 新增“清空全部操作日志”。
  - 输入 `清空` 强确认，完成后刷新列表/策略。

- [x] C4 回归与封板
  - 增加 clear-all 专项测试。
  - API Rules / root typecheck / lint / build / Prettier / diff 全绿。
  - 更新主文档与 alignment-log，切换 `LOG-003 VERIFIED`。

当前状态：**VERIFIED**。

最终验证：API Rules **192/192 PASS**；root typecheck PASS；lint **0 error / 8 个既有 warning**；production build PASS，Web **4145 modules transformed**；未认证运行态 `POST /api/logs/clear-all` 返回 401；Prettier 与 `git diff --check` PASS。
