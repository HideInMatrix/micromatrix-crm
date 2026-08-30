// ============ 权限码体系 ============
// 约定：menu:* 为菜单权限；<资源>:<动作> 为操作权限；'*' 表示全部权限

export interface PermissionNode {
  code: string
  label: string
  children?: PermissionNode[]
}

/** 权限树：驱动角色管理界面勾选与后端校验 */
export const PERMISSION_TREE: PermissionNode[] = [
  {
    code: 'menu:dashboard',
    label: '工作台',
    children: [
      { code: 'dashboard:read', label: '查看仪表板' },
      { code: 'dashboard:create', label: '新建仪表板/目录' },
      { code: 'dashboard:update', label: '编辑仪表板/目录' },
      { code: 'dashboard:delete', label: '删除仪表板/目录' },
    ],
  },
  {
    code: 'menu:lead',
    label: '线索管理',
    children: [
      { code: 'lead:create', label: '新建' },
      { code: 'lead:update', label: '编辑' },
      { code: 'lead:delete', label: '删除' },
      { code: 'lead:transfer', label: '转移' },
      { code: 'lead:recycle', label: '移入线索池' },
      { code: 'lead:import', label: '导入' },
      { code: 'lead:export', label: '导出' },
      { code: 'leadPool:read', label: '查看线索池' },
      { code: 'leadPool:pick', label: '线索池领取' },
      { code: 'leadPool:assign', label: '线索池分配' },
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
      { code: 'customer:read', label: '查看客户' },
      { code: 'customer:create', label: '新建' },
      { code: 'customer:update', label: '编辑' },
      { code: 'customer:delete', label: '删除' },
      { code: 'customer:transfer', label: '转移' },
      { code: 'customer:recycle', label: '移入客户公海' },
      { code: 'customer:merge', label: '合并客户' },
      { code: 'customer:import', label: '导入' },
      { code: 'customer:export', label: '导出' },
      { code: 'contact:read', label: '查看联系人' },
      { code: 'customerPool:read', label: '查看客户公海' },
      { code: 'customerPool:pick', label: '客户公海领取' },
      { code: 'customerPool:assign', label: '客户公海分配' },
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
      { code: 'product:import', label: '导入产品' },
      { code: 'product:export', label: '导出产品' },
      { code: 'price:read', label: '查看价格表' },
      { code: 'price:add', label: '新建价格表' },
      { code: 'price:update', label: '编辑价格表' },
      { code: 'price:delete', label: '删除价格表' },
      { code: 'price:import', label: '导入价格表' },
      { code: 'price:export', label: '导出价格表' },
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
      { code: 'CONTRACT:PAYMENT', label: '新增回款' },
      {
        code: 'CONTRACT_PAYMENT_PLAN:READ',
        label: '查看回款计划',
        children: [
          { code: 'CONTRACT_PAYMENT_PLAN:ADD', label: '新建回款计划' },
          { code: 'CONTRACT_PAYMENT_PLAN:UPDATE', label: '编辑回款计划' },
          { code: 'CONTRACT_PAYMENT_PLAN:DELETE', label: '删除回款计划' },
          { code: 'CONTRACT_PAYMENT_PLAN:IMPORT', label: '导入回款计划' },
          { code: 'CONTRACT_PAYMENT_PLAN:EXPORT', label: '导出回款计划' },
        ],
      },
      {
        code: 'CONTRACT_PAYMENT_RECORD:READ',
        label: '查看回款记录',
        children: [
          { code: 'CONTRACT_PAYMENT_RECORD:ADD', label: '新建回款记录' },
          { code: 'CONTRACT_PAYMENT_RECORD:UPDATE', label: '编辑回款记录' },
          { code: 'CONTRACT_PAYMENT_RECORD:DELETE', label: '删除回款记录' },
          { code: 'CONTRACT_PAYMENT_RECORD:IMPORT', label: '导入回款记录' },
          { code: 'CONTRACT_PAYMENT_RECORD:EXPORT', label: '导出回款记录' },
        ],
      },
      {
        code: 'CONTRACT_INVOICE:READ',
        label: '查看发票',
        children: [
          { code: 'CONTRACT_INVOICE:ADD', label: '新建发票' },
          { code: 'CONTRACT_INVOICE:UPDATE', label: '编辑发票' },
          { code: 'CONTRACT_INVOICE:DELETE', label: '删除发票' },
          { code: 'CONTRACT_INVOICE:IMPORT', label: '导入发票' },
          { code: 'CONTRACT_INVOICE:EXPORT', label: '导出发票' },
          { code: 'CONTRACT_INVOICE:APPROVAL', label: '审批发票' },
        ],
      },
      {
        code: 'CONTRACT_BUSINESS_TITLE:READ',
        label: '查看工商抬头',
        children: [
          { code: 'CONTRACT_BUSINESS_TITLE:ADD', label: '新建工商抬头' },
          { code: 'CONTRACT_BUSINESS_TITLE:UPDATE', label: '编辑工商抬头' },
          { code: 'CONTRACT_BUSINESS_TITLE:DELETE', label: '删除工商抬头' },
          { code: 'CONTRACT_BUSINESS_TITLE:IMPORT', label: '导入工商抬头' },
          { code: 'CONTRACT_BUSINESS_TITLE:EXPORT', label: '导出工商抬头' },
          { code: 'CONTRACT_BUSINESS_TITLE:APPROVAL', label: '审批工商抬头' },
        ],
      },
    ],
  },
  {
    code: 'menu:order',
    label: '订单管理',
    children: [
      {
        code: 'ORDER:READ',
        label: '查看订单',
        children: [
          { code: 'ORDER:ADD', label: '新建订单' },
          { code: 'ORDER:UPDATE', label: '编辑订单' },
          { code: 'ORDER:DELETE', label: '删除订单' },
          { code: 'ORDER:IMPORT', label: '导入订单' },
          { code: 'ORDER:EXPORT', label: '导出订单' },
          { code: 'ORDER:DOWNLOAD', label: '下载订单' },
        ],
      },
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
  },
  {
    code: 'PERSONAL_API_KEY:READ',
    label: '个人 API Key',
    children: [
      { code: 'PERSONAL_API_KEY:ADD', label: '新增' },
      { code: 'PERSONAL_API_KEY:UPDATE', label: '编辑/启停' },
      { code: 'PERSONAL_API_KEY:DELETE', label: '删除' },
    ],
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
          { code: 'system:dept:sync', label: '同步组织架构' },
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
      {
        code: 'system:message',
        label: '消息设置',
        children: [{ code: 'system:message:update', label: '编辑' }],
      },
      {
        code: 'system:process',
        label: '流程设置',
        children: [
          { code: 'system:process:add', label: '新建' },
          { code: 'system:process:update', label: '编辑/启停' },
          { code: 'system:process:delete', label: '删除' },
        ],
      },
      { code: 'system:pool', label: '公海/线索池设置' },
      { code: 'system:log', label: '系统日志' },
      {
        code: 'system:setting',
        label: '企业设置',
        children: [{ code: 'system:setting:update', label: '编辑' }],
      },
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
