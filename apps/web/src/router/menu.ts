/** 菜单配置：驱动侧边栏渲染与路由权限（perm 为空表示登录即可见） */
export interface MenuItem {
  path: string
  title: string
  perm?: string
  children?: MenuItem[]
}

export const MENUS: MenuItem[] = [
  { path: '/dashboard', title: '工作台', perm: 'menu:dashboard' },
  { path: '/reports', title: '销售报表', perm: 'menu:dashboard' },
  { path: '/leads', title: '线索管理', perm: 'menu:lead' },
  { path: '/customers', title: '客户管理', perm: 'menu:customer' },
  { path: '/opportunities', title: '商机管理', perm: 'menu:opportunity' },
  { path: '/products', title: '产品管理', perm: 'menu:product' },
  { path: '/quotes', title: '报价管理', perm: 'menu:quote' },
  { path: '/contracts', title: '合同管理', perm: 'menu:contract' },
  { path: '/orders', title: '订单管理', perm: 'menu:order' },
  { path: '/bidding', title: '标讯', perm: 'menu:bidding' },
  { path: '/approvals', title: '审批中心', perm: 'menu:approval' },
  {
    path: '/system',
    title: '系统管理',
    perm: 'menu:system',
    children: [
      { path: '/system/departments', title: '组织架构', perm: 'system:dept' },
      { path: '/system/members', title: '成员管理', perm: 'system:member' },
      { path: '/system/roles', title: '角色权限', perm: 'system:role' },
      { path: '/system/modules', title: '模块设置', perm: 'system:module' },
      { path: '/system/sales-settings', title: '销售设置', perm: 'system:module' },
      { path: '/system/approval-flows', title: '审批流配置', perm: 'approval:flowManage' },
      { path: '/system/logs', title: '系统日志', perm: 'system:log' },
      { path: '/system/settings', title: '企业设置', perm: 'system:setting' },
    ],
  },
]
