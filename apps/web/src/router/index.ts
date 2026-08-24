import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getClientMode, isMobileClient, type ClientMode } from '@/utils/client-mode'

declare module 'vue-router' {
  interface RouteMeta {
    /** 无需登录即可访问 */
    public?: boolean
    title?: string
    /** 访问所需权限码 */
    perm?: string
    /** 左侧菜单高亮路径，用于详情页或共享页面。 */
    activeMenu?: string
    /** Cordys 已有、当前项目待实现的页面说明。 */
    plannedFeature?: string
    /** 页面只属于某一端；both/未声明表示两端共用 */
    client?: ClientMode | 'both'
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () =>
        isMobileClient() ? import('@/mobile/views/LoginView.vue') : import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录', client: 'both' },
    },
    {
      path: '/leads/:id/convert',
      name: 'mobile-lead-convert',
      component: () => import('@/mobile/views/LeadConvertView.vue'),
      meta: { title: '转换线索', perm: 'lead:update', client: 'mobile' },
    },
    {
      path: '/customers/detail',
      name: 'mobile-customer-detail',
      component: () => import('@/mobile/views/CustomerDetailView.vue'),
      meta: { title: '客户详情', perm: 'menu:customer', client: 'mobile' },
    },
    {
      path: '/opportunities/detail',
      name: 'mobile-opportunity-detail',
      component: () => import('@/mobile/views/OpportunityDetailView.vue'),
      meta: { title: '商机详情', perm: 'menu:opportunity', client: 'mobile' },
    },
    {
      path: '/',
      component: () =>
        isMobileClient()
          ? import('@/mobile/layouts/TabbarLayout.vue')
          : import('@/layouts/DefaultLayout.vue'),
      redirect: () => (isMobileClient() ? '/home' : '/dashboard'),
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { title: '工作台', perm: 'menu:dashboard', client: 'pc' },
        },
        {
          path: 'home',
          name: 'mobile-home',
          component: () => import('@/mobile/views/HomeView.vue'),
          meta: { title: '工作台', client: 'mobile' },
        },
        {
          path: 'reports',
          component: () => import('@/views/ReportsView.vue'),
          meta: { title: '销售报表', perm: 'menu:dashboard', client: 'pc' },
        },
        {
          path: 'leads',
          name: 'leads',
          component: () =>
            isMobileClient()
              ? import('@/mobile/views/LeadsView.vue')
              : import('@/views/LeadsView.vue'),
          meta: { title: '线索管理', perm: 'menu:lead', client: 'both' },
        },
        {
          path: 'leads/pool',
          name: 'lead-pool',
          component: () => import('@/views/LeadsView.vue'),
          meta: {
            title: '线索池',
            perm: 'menu:lead',
            client: 'pc',
            activeMenu: '/leads',
          },
        },
        {
          path: 'customers',
          name: 'customers',
          component: () =>
            isMobileClient()
              ? import('@/mobile/views/CustomersView.vue')
              : import('@/views/CustomersView.vue'),
          meta: { title: '客户管理', perm: 'menu:customer', client: 'both' },
        },
        {
          path: 'contacts',
          name: 'contacts',
          component: () => import('@/views/ContactsView.vue'),
          meta: { title: '联系人', perm: 'contact:read', client: 'pc' },
        },
        {
          path: 'customers/open-sea',
          name: 'customer-open-sea',
          component: () => import('@/views/CustomerPoolView.vue'),
          meta: { title: '客户公海', perm: 'menu:customer', client: 'pc' },
        },
        {
          path: 'customers/:id',
          name: 'customer-detail',
          component: () => import('@/views/CustomerDetailView.vue'),
          meta: {
            title: '客户详情',
            perm: 'menu:customer',
            client: 'pc',
            activeMenu: '/customers',
          },
        },
        {
          path: 'opportunities',
          name: 'opportunities',
          component: () => import('@/views/OpportunitiesView.vue'),
          meta: { title: '商机管理', perm: 'menu:opportunity', client: 'pc' },
        },
        {
          path: 'products',
          component: () => import('@/views/ProductsView.vue'),
          meta: { title: '产品管理', perm: 'menu:product', client: 'pc' },
        },
        {
          path: 'quotes',
          component: () => import('@/views/QuotesView.vue'),
          meta: { title: '报价管理', perm: 'menu:quote', client: 'pc' },
        },
        {
          path: 'contracts',
          component: () => import('@/views/ContractsView.vue'),
          meta: { title: '合同管理', perm: 'menu:contract', client: 'pc' },
        },
        {
          path: 'orders',
          component: () => import('@/views/OrdersView.vue'),
          meta: { title: '订单管理', perm: 'menu:order', client: 'pc' },
        },
        {
          path: 'approvals',
          name: 'approvals',
          component: () =>
            isMobileClient()
              ? import('@/mobile/views/ApprovalsView.vue')
              : import('@/views/ApprovalsView.vue'),
          meta: { title: '审批中心', perm: 'menu:approval', client: 'both' },
        },
        {
          path: 'follow-plans',
          name: 'follow-plans',
          component: () =>
            isMobileClient()
              ? import('@/mobile/views/FollowUpPlansView.vue')
              : import('@/views/FollowUpPlansView.vue'),
          meta: { title: '跟进计划', client: 'both' },
        },
        {
          path: 'mine',
          name: 'mobile-mine',
          component: () => import('@/mobile/views/MineView.vue'),
          meta: { title: '我的', client: 'mobile' },
        },
        {
          path: 'bidding',
          component: () => import('@/views/BiddingView.vue'),
          meta: { title: '标讯', perm: 'menu:bidding', client: 'pc' },
        },
        {
          path: 'custom-forms',
          component: () => import('@/views/PlannedFeatureView.vue'),
          meta: {
            title: '自定义表单',
            perm: 'menu:system',
            client: 'pc',
            plannedFeature: '任意自定义业务表单、数据权限与数据列表',
          },
        },
        {
          path: 'system/departments',
          component: () => import('@/views/system/MembersView.vue'),
          meta: { title: '组织架构', perm: 'system:dept', client: 'pc' },
        },
        {
          path: 'system/members',
          component: () => import('@/views/system/MembersView.vue'),
          meta: { title: '成员管理', perm: 'system:member', client: 'pc' },
        },
        {
          path: 'system/roles',
          component: () => import('@/views/system/RolesView.vue'),
          meta: { title: '角色权限', perm: 'system:role', client: 'pc' },
        },
        {
          path: 'system/modules',
          component: () => import('@/views/system/NavigationModulesView.vue'),
          meta: { title: '模块设置', perm: 'system:module', client: 'pc' },
        },
        {
          path: 'system/modules/fields',
          component: () => import('@/views/system/ModulesView.vue'),
          meta: {
            title: '表单设置',
            perm: 'system:module',
            client: 'pc',
            activeMenu: '/system/modules',
          },
        },
        {
          path: 'system/sales-settings',
          component: () => import('@/views/system/SalesSettingsView.vue'),
          meta: { title: '销售设置', perm: 'system:module', client: 'pc' },
        },
        {
          path: 'system/approval-flows',
          component: () => import('@/views/system/ApprovalFlowsView.vue'),
          meta: { title: '审批流配置', perm: 'approval:flowManage', client: 'pc' },
        },
        {
          path: 'system/messages',
          component: () => import('@/views/system/MessageSettingsView.vue'),
          meta: {
            title: '消息设置',
            perm: 'system:message',
            client: 'pc',
          },
        },
        {
          path: 'system/logs',
          component: () => import('@/views/system/LogsView.vue'),
          meta: { title: '系统日志', perm: 'system:log', client: 'pc' },
        },
        {
          path: 'system/settings',
          component: () => import('@/views/system/SettingsView.vue'),
          meta: { title: '企业设置', perm: 'system:setting', client: 'pc' },
        },
        {
          path: 'notifications',
          component: () => import('@/views/NotificationsView.vue'),
          meta: { title: '消息中心', client: 'pc' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const clientMode = getClientMode()
  if (to.meta.client && to.meta.client !== 'both' && to.meta.client !== clientMode) {
    return { path: '/' }
  }

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
