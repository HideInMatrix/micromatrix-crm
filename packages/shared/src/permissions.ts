// ============ 权限码体系 ============
// 约定：menu:* 为菜单权限；<资源>:<动作> 为操作权限；'*' 表示全部权限

export interface PermissionNode {
  code: string
  label: string
  children?: PermissionNode[]
}

/** 权限树：驱动角色管理界面勾选与后端校验 */
export const PERMISSION_TREE: PermissionNode[] = [
  { code: 'menu:dashboard', label: '工作台' },
  {
    code: 'menu:lead',
    label: '线索管理',
    children: [
      { code: 'lead:create', label: '新建' },
      { code: 'lead:update', label: '编辑' },
      { code: 'lead:delete', label: '删除' },
      { code: 'lead:assign', label: '分配/领取' },
      { code: 'lead:import', label: '导入' },
      { code: 'lead:export', label: '导出' },
      { code: 'leadPool:import', label: '线索池导入' },
      { code: 'leadPool:export', label: '线索池导出' },
      { code: 'leadPool:update', label: '线索池编辑' },
      { code: 'leadPool:delete', label: '线索池删除' },
    ],
  },
  {
    code: 'menu:customer',
    label: '客户管理',
    children: [
      { code: 'customer:create', label: '新建' },
      { code: 'customer:update', label: '编辑' },
      { code: 'customer:delete', label: '删除' },
      { code: 'customer:assign', label: '分配/领取' },
      { code: 'customer:merge', label: '合并客户' },
      { code: 'customer:team', label: '团队管理' },
      { code: 'customer:import', label: '导入' },
      { code: 'customer:export', label: '导出' },
      { code: 'contact:read', label: '查看联系人' },
      { code: 'customerPool:import', label: '客户公海导入' },
      { code: 'customerPool:export', label: '客户公海导出' },
      { code: 'customerPool:update', label: '客户公海编辑' },
      { code: 'customerPool:delete', label: '客户公海删除' },
      { code: 'contact:create', label: '新建联系人' },
      { code: 'contact:update', label: '编辑联系人' },
      { code: 'contact:delete', label: '删除联系人' },
      { code: 'contact:import', label: '导入联系人' },
      { code: 'contact:export', label: '导出联系人' },
    ],
  },
  {
    code: 'menu:opportunity',
    label: '商机管理',
    children: [
      { code: 'opportunity:create', label: '新建' },
      { code: 'opportunity:update', label: '编辑' },
      { code: 'opportunity:delete', label: '删除' },
      { code: 'opportunity:stage', label: '推进阶段' },
    ],
  },
  {
    code: 'menu:product',
    label: '产品管理',
    children: [
      { code: 'product:create', label: '新建' },
      { code: 'product:update', label: '编辑' },
      { code: 'product:delete', label: '删除' },
    ],
  },
  {
    code: 'menu:quote',
    label: '报价管理',
    children: [
      { code: 'quote:create', label: '新建' },
      { code: 'quote:update', label: '编辑' },
      { code: 'quote:delete', label: '删除' },
      { code: 'quote:submit', label: '提交审批' },
    ],
  },
  {
    code: 'menu:contract',
    label: '合同管理',
    children: [
      { code: 'contract:create', label: '新建' },
      { code: 'contract:update', label: '编辑' },
      { code: 'contract:delete', label: '删除' },
      { code: 'contract:submit', label: '提交审批' },
      { code: 'receivable:manage', label: '回款管理' },
      { code: 'invoice:manage', label: '发票管理' },
      { code: 'invoiceTitle:manage', label: '工商抬头管理' },
    ],
  },
  {
    code: 'menu:order',
    label: '订单管理',
    children: [
      { code: 'order:create', label: '新建' },
      { code: 'order:update', label: '编辑' },
      { code: 'order:delete', label: '删除' },
    ],
  },
  {
    code: 'menu:bidding',
    label: '标讯',
    children: [
      { code: 'bidding:manage', label: '订阅与数据源管理' },
      { code: 'bidding:convert', label: '转线索' },
    ],
  },
  {
    code: 'menu:approval',
    label: '审批中心',
    children: [{ code: 'approval:flowManage', label: '流程配置' }],
  },
  {
    code: 'menu:system',
    label: '系统管理',
    children: [
      {
        code: 'system:dept',
        label: '组织架构',
        children: [
          { code: 'system:dept:create', label: '新建部门' },
          { code: 'system:dept:update', label: '编辑/排序/设置主管' },
          { code: 'system:dept:delete', label: '删除部门' },
        ],
      },
      {
        code: 'system:member',
        label: '成员管理',
        children: [
          { code: 'system:member:create', label: '新建成员' },
          { code: 'system:member:update', label: '编辑成员' },
          { code: 'system:member:status', label: '启用/禁用' },
          { code: 'system:member:resetPassword', label: '重置密码' },
          { code: 'system:member:delete', label: '删除成员' },
        ],
      },
      {
        code: 'system:role',
        label: '角色权限',
        children: [
          { code: 'system:role:create', label: '新建角色' },
          { code: 'system:role:update', label: '编辑角色' },
          { code: 'system:role:delete', label: '删除角色' },
        ],
      },
      {
        code: 'system:module',
        label: '模块设置',
        children: [{ code: 'system:module:update', label: '编辑' }],
      },
      { code: 'system:pool', label: '公海/线索池设置' },
      { code: 'system:log', label: '系统日志' },
      { code: 'system:setting', label: '企业设置' },
    ],
  },
]

/** 展平权限树得到全部权限码 */
export function flattenPermissionCodes(nodes: PermissionNode[] = PERMISSION_TREE): string[] {
  return nodes.flatMap((n) => [n.code, ...flattenPermissionCodes(n.children ?? [])])
}

/** 返回权限树中每个权限码的祖先码，用于动作权限自动补齐菜单/读取权限。 */
export function permissionAncestorMap(
  nodes: PermissionNode[] = PERMISSION_TREE,
  ancestors: string[] = [],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const node of nodes) {
    result.set(node.code, ancestors)
    const children = permissionAncestorMap(node.children ?? [], [...ancestors, node.code])
    children.forEach((value, key) => result.set(key, value))
  }
  return result
}

/** 权限判断：'*' 拥有全部权限 */
export function hasPermission(owned: string[], code: string): boolean {
  return owned.includes('*') || owned.includes(code)
}

// ============ 数据范围 ============

export type DataScope = 'ALL' | 'DEPT_AND_CHILD' | 'DEPT' | 'SELF' | 'CUSTOM'

export const DATA_SCOPE_OPTIONS: { value: DataScope; label: string }[] = [
  { value: 'ALL', label: '全部数据' },
  { value: 'DEPT_AND_CHILD', label: '本部门及下级部门' },
  { value: 'DEPT', label: '本部门' },
  { value: 'SELF', label: '仅本人' },
  { value: 'CUSTOM', label: '自定义部门' },
]
