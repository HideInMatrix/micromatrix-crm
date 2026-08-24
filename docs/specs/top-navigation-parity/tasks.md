# 实施任务

- [x] 1. 读取 Cordys 顶部导航全链路源码
  - 核对配置页、Header、store、API、Controller、Service、Domain、Mapper 和迁移。
  - 记录“当前只支持排序、不支持开关”的事实。
  - _Requirements: R1_

- [x] 2. 建立需求与设计基线
  - 明确默认 key、顺序、权限、已具备入口和非目标。
  - _Requirements: R1, R2, R4_

- [x] 3. 实现顶部导航持久化与 API
  - 新增 Prisma 模型/迁移、shared 契约、默认补种、列表和完整排序接口。
  - _Requirements: R2, R3_

- [x] 4. 实现配置页拖拽与 Header 动态渲染
  - 配置页按真实状态展示八个入口；Header 只接入已有真实能力。
  - _Requirements: R3, R4_

- [x] 5. 自动化与全链路验收
  - 运行 Prisma generate、typecheck、lint、build、规则测试和 smoke。
  - _Requirements: R3, R4, R5_

- [x] 6. 更新项目文档
  - 更新执行计划、parity、alignment log、文档索引和根 README。
  - _Requirements: R5_
