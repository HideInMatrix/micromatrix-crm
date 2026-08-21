/** 菜单配置：对齐当前 CordysCRM 实例经模块开关过滤后的左侧导航。 */
export interface MenuItem {
  path: string
  title: string
  perm?: string
  children?: MenuItem[]
}

export const MENUS: MenuItem[] = [
  { path: '/dashboard', title: '首页', perm: 'menu:dashboard' },
  { path: '/leads', title: '线索', perm: 'menu:lead' },
  { path: '/customers', title: '客户', perm: 'menu:customer' },
  { path: '/reports', title: '仪表板', perm: 'menu:dashboard' },
  { path: '/custom-forms', title: '自定义表单', perm: 'menu:system' },
  { path: '/orders', title: '订单', perm: 'menu:order' },
  {
    path: '/system',
    title: '系统',
    perm: 'menu:system',
    children: [
      { path: '/system/departments', title: '组织架构', perm: 'system:dept' },
      { path: '/system/roles', title: '角色权限', perm: 'system:role' },
      { path: '/system/modules', title: '模块配置', perm: 'system:module' },
      { path: '/system/messages', title: '消息设置', perm: 'system:setting' },
      { path: '/system/approval-flows', title: '流程设置', perm: 'approval:flowManage' },
      { path: '/system/settings', title: '企业设置', perm: 'system:setting' },
      { path: '/system/logs', title: '系统日志', perm: 'system:log' },
    ],
  },
]
