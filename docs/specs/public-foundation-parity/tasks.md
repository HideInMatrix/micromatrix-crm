# 实施任务

- [x] 1. 阅读 Cordys 组织架构、角色权限、模块配置源码
  - 阅读对应页面组件、API 封装及后端实现；运行页面仅确认实例状态和交互结果。
  - 沿 API 核对 Department/Role/Module Controller 与 Service。
  - _Requirements: R1_

- [x] 2. 建立租户模块配置公共数据源
  - 新增 shared 定义、Prisma 模型、NestJS 查询/切换/排序 API。
  - 增加服务端校验和权限码。
  - _Requirements: R4_

- [x] 3. 让左侧菜单由模块配置和角色权限共同生成
  - 新增 Pinia store，接入布局过滤和排序。
  - 保留关闭模块路由与数据，不在菜单展示。
  - _Requirements: R4_

- [x] 4. 重做模块配置首页
  - 对齐主导航配置与模块开关卡片。
  - 将已有字段配置降为模块内“表单设置”能力。
  - _Requirements: R4_

- [x] 5. 收口组织架构页面
  - 合并部门树与成员列表，复用现有成员 CRUD。
  - _Requirements: R2_

- [x] 6. 收口角色权限页面
  - 改为角色列表 + 权限/成员页签，不改变已验收的 RBAC 语义。
  - _Requirements: R3_

- [x] 7. 验收与记录
  - 运行迁移、类型检查、lint、build、相关测试和浏览器验证。
  - 更新 parity 与 alignment-log。
  - _Requirements: R1, R2, R3, R4_
