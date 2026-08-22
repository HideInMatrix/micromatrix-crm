# 实施任务

- [x] 1. 读取 Cordys 跟进计划全链路源码
  - 核对 Web、Mobile、API、Controller、Service、Domain、Mapper、migration、提醒和转记录。
  - 记录状态、字段、权限、提醒查询和非原子转换事实。
  - _Requirements: R1_

- [x] 2. 建立需求与设计基线
  - 明确范围、数据模型、API、权限、转换、提醒、PC/移动端和非目标。
  - _Requirements: R1-R6_

- [x] 3. 实现数据模型与后端闭环
  - 新增 Prisma 模型/迁移、shared 契约、DTO、Controller、Service 和模块注册。
  - 实现 CRUD、目标校验、数据范围、状态锁和操作日志。
  - _Requirements: R1, R2_

- [x] 4. 实现转换与到期提醒
  - 原子创建跟进记录，保证转换幂等并刷新最近跟进时间。
  - 定时通知负责人，按计划和日期去重。
  - _Requirements: R3, R4_

- [x] 5. 实现 PC 与移动端
  - 新增全局页面、移动端页面、顶部 `event` 入口和客户 360 Tab。
  - 所有新增图标使用 `lucide-vue-next`。
  - _Requirements: R5_

- [x] 6. 自动化与全链路验收
  - 运行 Prisma generate、typecheck、lint、build、规则测试和 smoke。
  - 浏览器验证 PC、移动端、顶部入口与客户 360。
  - _Requirements: R2-R6_

- [x] 7. 更新项目文档
  - 更新执行计划、parity、alignment log、数据模型、API、文档索引和 README。
  - _Requirements: R6_
