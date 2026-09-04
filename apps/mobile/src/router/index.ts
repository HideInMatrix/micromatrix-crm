import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useEnterpriseUiStore } from '@/stores/enterprise-ui'

const router = createRouter({
  history: createWebHistory('/mobile/'),
  routes: [
    {
      path: '/login',
      name: 'mobile-login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { public: true, title: '登录', depth: 0 },
    },
    {
      path: '/',
      component: () => import('@/layouts/MobileTabbarLayout.vue'),
      redirect: '/home',
      children: [
        {
          path: 'home',
          name: 'mobile-home',
          component: () => import('@/views/home/HomeView.vue'),
          meta: { title: '工作台', depth: 1 },
        },
        {
          path: 'leads',
          name: 'leads',
          component: () => import('@/views/leads/LeadsView.vue'),
          meta: { title: '线索管理', perm: 'menu:lead', depth: 1 },
        },
        {
          path: 'customers',
          name: 'customers',
          component: () => import('@/views/customers/CustomersView.vue'),
          meta: { title: '客户管理', perm: 'menu:customer', depth: 1 },
        },
        {
          path: 'approvals',
          name: 'approvals',
          component: () => import('@/views/approvals/ApprovalsView.vue'),
          meta: { title: '审批中心', perm: 'menu:approval', depth: 1 },
        },
        {
          path: 'mine',
          name: 'mobile-mine',
          component: () => import('@/views/profile/MineView.vue'),
          meta: { title: '我的', depth: 1 },
        },
        {
          path: 'leads/:id/convert',
          name: 'mobile-lead-convert',
          component: () => import('@/views/leads/LeadConvertView.vue'),
          meta: { title: '转换线索', perm: 'lead:update', depth: 2 },
        },
        {
          path: 'customers/detail',
          name: 'mobile-customer-detail',
          component: () => import('@/views/customers/CustomerDetailView.vue'),
          meta: { title: '客户详情', perm: 'menu:customer', depth: 2 },
        },
        {
          path: 'opportunities/detail',
          name: 'mobile-opportunity-detail',
          component: () => import('@/views/opportunities/OpportunityDetailView.vue'),
          meta: { title: '商机详情', perm: 'menu:opportunity', depth: 2 },
        },
        {
          path: 'follow-plans',
          name: 'follow-plans',
          component: () => import('@/views/follow-plans/FollowUpPlansView.vue'),
          meta: { title: '跟进计划', depth: 2 },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/home',
    },
  ],
})

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    title?: string
    perm?: string
    depth?: number
  }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const enterpriseUi = useEnterpriseUiStore()
  const requestedTenant = typeof to.query.tenant === 'string' ? to.query.tenant.trim() : ''

  if (!auth.isAuthenticated && to.name === 'mobile-login') {
    await enterpriseUi
      .loadLoginBranding({ tenantSlug: requestedTenant || undefined })
      .catch(() => undefined)
  } else if (!auth.isAuthenticated && requestedTenant) {
    await enterpriseUi.load(requestedTenant).catch(() => undefined)
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'mobile-login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'mobile-login' && auth.isAuthenticated) return { path: '/' }

  if (auth.isAuthenticated && !auth.user) {
    await auth.fetchMe().catch(() => auth.logout())
    if (!auth.user) return { name: 'mobile-login' }
  }
  if (auth.user?.tenantSlug) {
    await enterpriseUi.load(auth.user.tenantSlug).catch(() => undefined)
  }
  if (to.meta.perm && !auth.hasPerm(to.meta.perm)) return { path: '/' }
})

router.afterEach((to) => {
  useEnterpriseUiStore().setDocumentTitle(to.meta.title)
})

export default router
