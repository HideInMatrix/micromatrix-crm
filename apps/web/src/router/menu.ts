import type { NavigationModuleKey } from '@micromatrix/shared'

/**
 * CordysCRM 主导航目录。
 * 是否显示与排序由模块配置接口决定，权限只做第二层过滤。
 */
export interface MenuItem {
  path: string
  title: string
  moduleKey: NavigationModuleKey
  perm?: string
  children?: MenuItem[]
}

export const MENUS: MenuItem[] = [
  { path: '/dashboard', title: '首页', moduleKey: 'home', perm: 'menu:dashboard' },
  { path: '/leads', title: '线索', moduleKey: 'lead', perm: 'menu:lead' },
  { path: '/customers', title: '客户', moduleKey: 'customer', perm: 'menu:customer' },
  {
    path: '/opportunities',
    title: '商机',
    moduleKey: 'opportunity',
    perm: 'menu:opportunity',
  },
  { path: '/products', title: '产品', moduleKey: 'product', perm: 'menu:product' },
  { path: '/reports', title: '仪表板', moduleKey: 'dashboard', perm: 'menu:dashboard' },
  { path: '/contracts', title: '合同', moduleKey: 'contract', perm: 'menu:contract' },
  {
    path: '/custom-forms',
    title: '自定义表单',
    moduleKey: 'customForm',
    perm: 'menu:system',
  },
  { path: '/bidding', title: '标讯', moduleKey: 'bidding', perm: 'menu:bidding' },
  { path: '/order/index', title: '订单', moduleKey: 'order', perm: 'ORDER:READ' },
  {
    path: '/system',
    title: '系统',
    moduleKey: 'system',
    perm: 'menu:system',
    children: [
      {
        path: '/system/departments',
        title: '组织架构',
        moduleKey: 'system',
        perm: 'system:dept',
      },
      {
        path: '/system/roles',
        title: '角色权限',
        moduleKey: 'system',
        perm: 'system:role',
      },
      {
        path: '/system/modules',
        title: '模块配置',
        moduleKey: 'system',
        perm: 'system:module',
      },
      {
        path: '/system/messages',
        title: '消息设置',
        moduleKey: 'system',
        perm: 'system:message',
      },
      {
        path: '/system/approval-flows',
        title: '流程设置',
        moduleKey: 'system',
        perm: 'system:process',
      },
      {
        path: '/system/settings',
        title: '企业设置',
        moduleKey: 'system',
        perm: 'system:setting',
      },
      {
        path: '/system/logs',
        title: '系统日志',
        moduleKey: 'system',
        perm: 'system:log',
      },
    ],
  },
]
