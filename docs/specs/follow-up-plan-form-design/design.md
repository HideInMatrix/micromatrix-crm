# PLAN-FORM-001 跟进计划完整 FormDesign 与创建上下文设计

状态：`IN_PROGRESS`

## 1. 运行时结构

FollowPlan 继续使用单一 ModuleForm 与 Field/Blob；Customer / Lead / Opportunity 只是创建上下文，不新增上下文布局存储：

```text
followPlan ModuleFormConfig
  ├── formProp
  └── fields[]
       ├── system fields
       └── custom fields
              │
              ├── PC FollowUpPlanDialog
              └── Mobile FollowUpPlan form
```

三种 createContext 共用同一 fields/formProp。

## 2. 系统字段渲染

FollowPlan system field 使用 `MODULE_SYSTEM_FIELDS.followPlan` 的稳定 key：`targetType / targetId / ownerId / contactId / estimatedAt / content / method / status`。

运行时按 ModuleForm `fields` 顺序遍历。system field 使用 FollowPlan 专用控件 adapter；custom field 复用现有动态表单 item。这样可以消费同一排序、span、hidden、required/mobile 配置，而不把 target/contact 等业务选择器降级成普通 text input。

## 3. Create context adapter

Customer / Lead / Opportunity 的 context 只负责 targetType/targetId 初始化与锁定；全局 FollowPlan 创建时仍允许用户切换 targetType。Opportunity 的客户/联系人 lookup 沿用当前业务规则。

## 4. 表单设置入口

在 Customer 模块动作中增加 Cordys 对应的“跟进计划表单设置”，跳转现有 `/system/modules/fields?module=followPlan`。

`ModulesView` 增加 `followPlan` 作为可配置 ModuleKey。仍编辑单一 ModuleForm，不引入 planClue/planBusiness。

## 5. System/custom 混排

FollowPlan form renderer 负责：读取完整 `fields[]`；过滤 hidden，Mobile 额外按 mobile 语义收敛；按 API 顺序生成 24 栅格；system key 映射专用控件；custom field 交给通用动态字段 renderer；保存时 system 值构造现有 FollowUpPlan DTO，custom 值构造现有 `moduleFields`。

不允许把 custom fields 固定追加到 system fields 之后，否则字段拖拽排序无法真实生效。

## 6. 验收重点

- 在表单设置里把 custom 字段拖到 system 字段之前，PC/Mobile 创建表单顺序真实变化；
- 修改 system field span/hidden/required 后 runtime 生效；
- Customer/Lead/Opportunity fixed context 不被 FormDesign 覆盖；
- 全局创建仍能切 targetType；
- Field/Blob、评论和转记录回归不变。
