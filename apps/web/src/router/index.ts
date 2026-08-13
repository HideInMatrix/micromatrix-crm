import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    /** 无需登录即可访问 */
    public?: boolean
    title?: string
    /** 访问所需权限码 */
    perm?: string
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { title: '工作台', perm: 'menu:dashboard' },
        },
        {
          path: 'reports',
          component: () => import('@/views/ReportsView.vue'),
          meta: { title: '销售报表', perm: 'menu:dashboard' },
        },
        {
          path: 'leads',
          name: 'leads',
          component: () => import('@/views/LeadsView.vue'),
          meta: { title: '线索管理', perm: 'menu:lead' },
        },
        {
          path: 'customers',
          name: 'customers',
          component: () => import('@/views/CustomersView.vue'),
          meta: { title: '客户管理', perm: 'menu:customer' },
        },
        {
          path: 'opportunities',
          name: 'opportunities',
          component: () => import('@/views/OpportunitiesView.vue'),
          meta: { title: '商机管理', perm: 'menu:opportunity' },
        },
        {
          path: 'products',
          component: () => import('@/views/ProductsView.vue'),
          meta: { title: '产品管理', perm: 'menu:product' },
        },
        {
          path: 'quotes',
          component: () => import('@/views/QuotesView.vue'),
          meta: { title: '报价管理', perm: 'menu:quote' },
        },
        {
          path: 'contracts',
          component: () => import('@/views/ContractsView.vue'),
          meta: { title: '合同管理', perm: 'menu:contract' },
        },
        {
          path: 'orders',
          component: () => import('@/views/OrdersView.vue'),
          meta: { title: '订单管理', perm: 'menu:order' },
        },
        {
          path: 'approvals',
          component: () => import('@/views/ApprovalsView.vue'),
          meta: { title: '审批中心', perm: 'menu:approval' },
        },
        {
          path: 'bidding',
          component: () => import('@/views/BiddingView.vue'),
          meta: { title: '标讯', perm: 'menu:bidding' },
        },
        {
          path: 'system/departments',
          component: () => import('@/views/system/DepartmentsView.vue'),
          meta: { title: '组织架构', perm: 'system:dept' },
        },
        {
          path: 'system/members',
          component: () => import('@/views/system/MembersView.vue'),
          meta: { title: '成员管理', perm: 'system:member' },
        },
        {
          path: 'system/roles',
          component: () => import('@/views/system/RolesView.vue'),
          meta: { title: '角色权限', perm: 'system:role' },
        },
        {
          path: 'system/modules',
          component: () => import('@/views/system/ModulesView.vue'),
          meta: { title: '模块设置', perm: 'system:module' },
        },
        {
          path: 'system/sales-settings',
          component: () => import('@/views/system/SalesSettingsView.vue'),
          meta: { title: '销售设置', perm: 'system:module' },
        },
        {
          path: 'system/approval-flows',
          component: () => import('@/views/system/ApprovalFlowsView.vue'),
          meta: { title: '审批流配置', perm: 'approval:flowManage' },
        },
        {
          path: 'system/logs',
          component: () => import('@/views/system/LogsView.vue'),
          meta: { title: '系统日志', perm: 'system:log' },
        },
        {
          path: 'system/settings',
          component: () => import('@/views/system/SettingsView.vue'),
          meta: { title: '企业设置', perm: 'system:setting' },
        },
        {
          path: 'notifications',
          component: () => import('@/views/NotificationsView.vue'),
          meta: { title: '消息中心' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { path: '/' }
  }
  // 权限校验需要用户信息（刷新页面后先恢复）
  if (auth.isAuthenticated && !auth.user) {
    await auth.fetchMe().catch(() => auth.logout())
    if (!auth.user) return { name: 'login' }
  }
  if (to.meta.perm && !auth.hasPerm(to.meta.perm)) {
    return { path: '/' }
  }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 微矩阵 CRM` : '微矩阵 CRM'
})

export default router
