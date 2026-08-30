# DB-021 FollowUpPlan 8.4 PC / Mobile 动态字段验收

## 1. 验收范围

本阶段只关闭 DB-021 的前端运行时缺口：

- PC FollowUpPlan 新建 / 编辑表单消费真实 `followPlan` ModuleForm；
- Mobile FollowUpPlan 新建 / 编辑表单消费同一份 ModuleForm；
- 编辑时从 `FollowUpPlanVO.moduleFields` 回填；
- 保存时提交 `{ fieldId, fieldValue }[]`，不恢复 `customData`；
- PC / Mobile 均支持当前 Metadata 可创建的动态字段类型；
- 不新增 Cordys 不存在的 `/system/modules` FollowUpPlan 专属入口。

## 2. Metadata HTTP 契约

新增只读接口：

```text
GET /api/follow-up-plans/module/form
```

实现链：

```text
FollowUpPlansController.moduleForm
  -> FollowUpPlansService.form
  -> ModuleFormsService.getConfig(tenantId, 'followPlan')
```

前端 `followUpPlanApi.moduleForm()` 直接返回：

- `formKey`
- `formProp`
- `FieldVO[] fields`

前端没有维护第二份 FollowPlan 字段 schema。

## 3. PC 表单

`FollowUpPlanDialog.vue`：

- 打开时并行加载 `module/form` 与 `useFieldRefs()`；
- 只把 `!system && !hidden && type !== 'formula'` 的字段交给 `DynamicForm`；
- 新建时使用字段 `defaultValue`；
- 编辑时按 `fieldId -> FieldVO.id -> FieldVO.key` 回填 `moduleFields`；
- 保存前调用 `DynamicForm.validate()` 验证自定义必填字段；
- create / update payload 都提交 `moduleFields`；
- metadata 加载失败时禁止保存，避免编辑旧计划时用空动态字段覆盖真实 Field/Blob 数据。

## 4. Mobile 表单

`MobileFollowUpPlanList.vue` 复用项目现有 `MobileDynamicForm.vue`，没有另造 FollowPlan 专用字段组件。

FollowPlan Mobile：

- 加载同一 `followPlan module/form`；
- 加载成员与部门引用数据；
- 新建使用默认值；
- 编辑从 `moduleFields` 回填；
- 保存前检查动态必填字段；
- create / update 提交 `moduleFields`。

本阶段同时补齐了共享 `MobileDynamicForm` 之前跳过的五类 Metadata 字段：

- `member`
- `dept`
- `multiselect`
- `checkbox`
- `datetime`

因此 FollowPlan Mobile 不会因为字段类型不同而静默漏掉动态字段。

## 5. `/system/modules` 边界

对 `apps/web/src/views/system` 扫描 `followPlan`：

```text
0 matches
```

本阶段没有新增 FollowUpPlan 专属模块设置按钮；字段能力来自通用 Metadata / ModuleForm 基座，符合 8.4 既定边界。

## 6. 自动化验收

### 6.1 Typecheck

```text
pnpm --filter @micromatrix/api typecheck
exit 0

pnpm --filter @micromatrix/web typecheck
exit 0
```

### 6.2 后端真实库回归

```text
pnpm smoke:db021-follow-plan-runtime
DB-021 FollowPlan runtime smoke: 12 assertions passed
exit 0
```

证明 8.4 的 metadata endpoint / UI 接入没有破坏 8.3 Field/Blob runtime。

### 6.3 PC / Mobile Browser Smoke

命令：

```text
pnpm smoke:db021-follow-plan-browser
```

最终结果：

```text
DB-021 FollowPlan Browser Smoke: 25 passed, 0 failed
exit 0
```

Smoke 每次自行创建并在 `finally` 清理：

- 1 个临时客户；
- 1 个临时 FollowPlan；
- 1 个 text 字段；
- 5 个复杂字段：member / dept / multiselect / checkbox / datetime。

核心实证：

- `GET /follow-up-plans/module/form` 真实 200；
- PC 六类动态字段均真实渲染；
- PC text Field 从数据库回填为 `seed-value`；
- PC 编辑为 `pc-edited` 后 PATCH 成功，API detail 从 Field/Blob 读回 `pc-edited`；
- 切换 390px Mobile viewport 后加载真正移动端 FollowPlan 页面；
- Mobile 五类复杂字段均真实渲染；
- Mobile text Field 回填 `pc-edited`；
- Mobile 编辑为 `mobile-edited` 后 PATCH 成功，API detail 读回 `mobile-edited`；
- Browser API 5xx = 0；
- Browser Runtime exception = 0。

## 7. 结论

DB-021 8.4 已满足关闭条件：FollowUpPlan PC / Mobile 已进入真实 ModuleForm + Field/Blob 表单往返，不再依赖 `customData`，也没有为了 FollowPlan 新造 Cordys 不存在的 `/system/modules` 专属设置入口。

DB-021 此时仍保持 `IN_PROGRESS`；必须等 8.5 全量回归、空库双 Seed、legacy scan 和最终文档全部通过后才允许改为 `VERIFIED`。
