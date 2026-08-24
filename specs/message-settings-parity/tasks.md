# 实施任务

- [x] 1. 读取 Cordys 消息设置全链路源码
  - 核对 Web、API、Controller、Service、Domain、DTO、Mapper、migration、默认事件 JSON 和通知发送链路。
  - _Requirements: R1-R4_

- [x] 2. 建立需求与设计基线
  - 明确消息通知与公告、模板、邮件/第三方发送器的阶段边界。
  - _Requirements: R1-R6_

- [x] 3. 实现共享契约、数据模型与后端 API
  - 新增目录、Prisma 模型/迁移、DTO、Service、Controller、权限和操作日志。
  - _Requirements: R1-R3, R5_

- [x] 4. 接入站内通知分发
  - 事件开关控制落库/SSE，跟进计划提醒绑定准确事件。
  - _Requirements: R4_

- [x] 5. 实现消息设置页面
  - 分组表格、单项/批量开关、禁用邮件说明、到期配置抽屉。
  - _Requirements: R2, R3, R5_

- [x] 6. 自动化与浏览器验收
  - Prisma generate、迁移、typecheck、lint、build、规则测试、smoke 和浏览器往返。
  - _Requirements: R2-R6_

- [x] 7. 更新项目文档并本地提交
  - 更新执行计划、parity、alignment log、数据模型、API、索引和 README。
  - _Requirements: R6_
