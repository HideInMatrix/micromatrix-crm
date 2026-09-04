import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useEnterpriseUiStore } from '@/stores/enterprise-ui'
import { isWeComWorkbenchBrowser } from '@/utils/wecom'

declare module 'vue-router' {
  interface RouteMeta {
    /** 无需登录即可访问 */
    public?: boolean
    title?: string
    /** 访问所需权限码 */
    perm?: string
    /** 左侧菜单高亮路径，用于详情页或共享页面。 */
    activeMenu?: string
    /** Header 顶部并列业务路由所属分组。 */
    topMenuGroup?: string
    /** Header 顶部菜单显示文本；只有设置该字段的路由才渲染为菜单项。 */
    topMenuLabel?: string
    /** Header 顶部菜单组内排序。 */
    topMenuOrder?: number
    /** 详情等非菜单路由应高亮的顶部菜单路径。 */
    topMenuActivePath?: string
    /** Cordys 已有、当前项目待实现的页面说明。 */
    plannedFeature?: string
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/login/wecom/callback',
      name: 'wecom-login-callback',
      component: () => import('@/views/auth/WeComCallbackView.vue'),
      meta: { public: true, title: '企业微信登录' },
    },
    {
      path: '/login/wecom/workbench',
      name: 'wecom-workbench-login',
      component: () => import('@/views/auth/WeComWorkbenchLoginView.vue'),
      meta: { public: true, title: '企业微信工作台登录' },
    },
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/home/DashboardView.vue'),
          meta: { title: '工作台', perm: 'menu:dashboard' },
        },
        {
          path: 'reports',
          component: () => import('@/views/home/ReportsView.vue'),
          meta: { title: '仪表板', perm: 'menu:dashboard' },
        },
        {
          path: 'leads',
          name: 'leads',
          component: () => import('@/views/leads/LeadsView.vue'),
          meta: {
            title: '线索管理',
            perm: 'menu:lead',
            topMenuGroup: 'lead',
            topMenuLabel: '线索',
            topMenuOrder: 10,
          },
        },
        {
          path: 'leads/pool',
          name: 'lead-pool',
          component: () => import('@/views/leads/LeadsView.vue'),
          meta: {
            title: '线索池',
            perm: 'leadPool:read',
            activeMenu: '/leads',
            topMenuGroup: 'lead',
            topMenuLabel: '线索池',
            topMenuOrder: 20,
          },
        },
        {
          path: 'customers',
          name: 'customers',
          component: () => import('@/views/customers/CustomersView.vue'),
          meta: {
            title: '客户管理',
            perm: 'menu:customer',
            topMenuGroup: 'customer',
            topMenuLabel: '客户',
            topMenuOrder: 10,
          },
        },
        {
          path: 'contacts',
          name: 'contacts',
          component: () => import('@/views/contacts/ContactsView.vue'),
          meta: {
            title: '联系人',
            perm: 'contact:read',
            activeMenu: '/customers',
            topMenuGroup: 'customer',
            topMenuLabel: '联系人',
            topMenuOrder: 20,
          },
        },
        {
          path: 'customers/open-sea',
          name: 'customer-open-sea',
          component: () => import('@/views/customers/CustomerPoolView.vue'),
          meta: {
            title: '客户公海',
            perm: 'customerPool:read',
            activeMenu: '/customers',
            topMenuGroup: 'customer',
            topMenuLabel: '客户公海',
            topMenuOrder: 30,
          },
        },
        {
          path: 'customers/:id',
          name: 'customer-detail',
          component: () => import('@/views/customers/CustomerDetailView.vue'),
          meta: {
            title: '客户详情',
            perm: 'menu:customer',
            activeMenu: '/customers',
            topMenuGroup: 'customer',
            topMenuActivePath: '/customers',
          },
        },
        {
          path: 'opportunities',
          name: 'opportunities',
          component: () => import('@/views/opportunities/OpportunitiesView.vue'),
          meta: {
            title: '商机管理',
            perm: 'menu:opportunity',
            topMenuGroup: 'opportunity',
            topMenuLabel: '商机',
            topMenuOrder: 10,
          },
        },
        {
          path: 'products',
          name: 'products',
          component: () => import('@/views/products/ProductsView.vue'),
          meta: {
            title: '产品管理',
            perm: 'menu:product',
            topMenuGroup: 'product',
            topMenuLabel: '产品',
            topMenuOrder: 10,
          },
        },
        {
          path: 'products/prices',
          name: 'product-prices',
          component: () => import('@/views/products/ProductsView.vue'),
          meta: {
            title: '价格表',
            perm: 'price:read',
            activeMenu: '/products',
            topMenuGroup: 'product',
            topMenuLabel: '价格表',
            topMenuOrder: 20,
          },
        },
        {
          path: 'quotes',
          component: () => import('@/views/quotes/QuotesView.vue'),
          meta: {
            title: '报价管理',
            perm: 'menu:quote',
            activeMenu: '/opportunities',
            topMenuGroup: 'opportunity',
            topMenuLabel: '报价',
            topMenuOrder: 20,
          },
        },
        {
          path: 'contracts',
          component: () => import('@/views/contracts/ContractsView.vue'),
          meta: {
            title: '合同管理',
            perm: 'menu:contract',
            topMenuGroup: 'contract',
            topMenuLabel: '合同',
            topMenuOrder: 10,
          },
        },
        {
          path: 'contract/contractInvoice',
          name: 'contract-invoice',
          component: () => import('@/views/contracts/InvoicesView.vue'),
          meta: {
            title: '发票',
            perm: 'CONTRACT_INVOICE:READ',
            activeMenu: '/contracts',
            topMenuGroup: 'contract',
            topMenuLabel: '发票',
            topMenuOrder: 20,
          },
        },
        {
          path: 'contract/contractBusinessName',
          name: 'contract-business-title',
          component: () => import('@/views/contracts/BusinessTitlesView.vue'),
          meta: {
            title: '工商抬头',
            perm: 'CONTRACT_BUSINESS_TITLE:READ',
            activeMenu: '/contracts',
            topMenuGroup: 'contract',
            topMenuLabel: '工商抬头',
            topMenuOrder: 30,
          },
        },
        {
          path: 'order/index',
          name: 'order-index',
          component: () => import('@/views/orders/OrdersView.vue'),
          meta: { title: '订单管理', perm: 'ORDER:READ' },
        },
        {
          path: 'approvals',
          name: 'approvals',
          component: () => import('@/views/approvals/ApprovalsView.vue'),
          meta: { title: '审批中心', perm: 'menu:approval' },
        },
        {
          path: 'follow-plans',
          name: 'follow-plans',
          component: () => import('@/views/follow-plans/FollowUpPlansView.vue'),
          meta: { title: '跟进计划' },
        },
        {
          path: 'bidding',
          component: () => import('@/views/bidding/BiddingView.vue'),
          meta: { title: '标讯', perm: 'menu:bidding' },
        },
        {
          path: 'custom-forms',
          component: () => import('@/views/custom-forms/PlannedFeatureView.vue'),
          meta: {
            title: '自定义表单',
            perm: 'menu:system',
            plannedFeature: '任意自定义业务表单、数据权限与数据列表',
          },
        },
        {
          path: 'system/departments',
          component: () => import('@/views/system/MembersView.vue'),
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
          component: () => import('@/views/system/NavigationModulesView.vue'),
          meta: { title: '模块设置', perm: 'system:module' },
        },
        {
          path: 'system/modules/fields',
          component: () => import('@/views/system/ModulesView.vue'),
          meta: {
            title: '表单设置',
            perm: 'system:module',
            activeMenu: '/system/modules',
          },
        },
        {
          path: 'system/sales-settings',
          component: () => import('@/views/system/SalesSettingsView.vue'),
          meta: { title: '销售设置', perm: 'system:module' },
        },
        {
          path: 'system/approval-flows',
          component: () => import('@/views/system/ApprovalFlowsView.vue'),
          meta: { title: '流程设置', perm: 'system:process' },
        },
        {
          path: 'system/messages',
          component: () => import('@/views/system/MessageSettingsView.vue'),
          meta: {
            title: '消息设置',
            perm: 'system:message',
          },
        },
        {
          path: 'system/logs',
          component: () => import('@/views/system/LogsView.vue'),
          meta: { title: '系统日志', perm: 'system:log' },
        },
        {
          path: 'system/settings',
          component: () => import('@/views/system/enterprise-settings/SettingsView.vue'),
          meta: { title: '企业设置', perm: 'system:setting' },
        },
        {
          path: 'notifications',
          component: () => import('@/views/notifications/NotificationsView.vue'),
          meta: { title: '消息中心' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const enterpriseUi = useEnterpriseUiStore()
  const requestedTenant = typeof to.query.tenant === 'string' ? to.query.tenant.trim() : ''
  if (!auth.isAuthenticated && to.name === 'login') {
    await enterpriseUi
      .loadLoginBranding({ tenantSlug: requestedTenant || undefined })
      .catch(() => undefined)
  } else if (!auth.isAuthenticated && requestedTenant) {
    await enterpriseUi.load(requestedTenant).catch(() => undefined)
  }
  if (
    to.name === 'login' &&
    !auth.isAuthenticated &&
    isWeComWorkbenchBrowser() &&
    to.query.manual !== '1'
  ) {
    return {
      name: 'wecom-workbench-login',
      query: {
        ...(typeof to.query.redirect === 'string' ? { redirect: to.query.redirect } : {}),
        ...(typeof to.query.tenant === 'string' ? { tenant: to.query.tenant } : {}),
      },
    }
  }
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
  if (auth.user?.tenantSlug) {
    await enterpriseUi.load(auth.user.tenantSlug).catch(() => undefined)
  }
  if (to.meta.perm && !auth.hasPerm(to.meta.perm)) {
    return { path: '/' }
  }
})

router.afterEach((to) => {
  useEnterpriseUiStore().setDocumentTitle(to.meta.title)
})

export default router
