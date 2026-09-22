import { createRouter, createWebHistory } from 'vue-router'
import { callbackWeComWorkbench } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'
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
      path: '/lark/callback',
      name: 'mobile-lark-callback',
      component: () => import('@/views/auth/LarkCallbackView.vue'),
      meta: { public: true, title: '飞书登录', depth: 0 },
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

function mobileRouteFromReturnPath(returnPath: string) {
  const url = new URL(returnPath || '/mobile/home', window.location.origin)
  if (!url.pathname.startsWith('/mobile/')) {
    return { path: '/home' }
  }
  return {
    path: url.pathname.slice('/mobile'.length) || '/',
    query: Object.fromEntries(url.searchParams.entries()),
    hash: url.hash,
    replace: true,
  }
}

function mobileRouteFromInternalPath(value: string) {
  const url = new URL(value || '/home', window.location.origin)
  const path = url.pathname.startsWith('/mobile/')
    ? url.pathname.slice('/mobile'.length) || '/'
    : url.pathname
  return {
    path,
    query: Object.fromEntries(url.searchParams.entries()),
    hash: url.hash,
    replace: true,
  }
}

function debugErrorSummary(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      serverMessage: extractErrorMessage(error),
    }
  }
  return { message: String(error), serverMessage: extractErrorMessage(error) }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const enterpriseUi = useEnterpriseUiStore()
  const requestedTenant = typeof to.query.tenant === 'string' ? to.query.tenant.trim() : ''
  let code = typeof to.query.code === 'string' ? to.query.code : ''
  let state = typeof to.query.state === 'string' ? to.query.state : ''
  let nestedRedirect = ''

  if ((!code || !state) && typeof to.query.redirect === 'string') {
    const redirectUrl = new URL(to.query.redirect, window.location.origin)
    const redirectCode = redirectUrl.searchParams.get('code') ?? ''
    const redirectState = redirectUrl.searchParams.get('state') ?? ''
    if (redirectCode && redirectState.startsWith('wecom.')) {
      code = redirectCode
      state = redirectState
      redirectUrl.searchParams.delete('code')
      redirectUrl.searchParams.delete('state')
      nestedRedirect = `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
    }
  }

  console.info('[WECOM-DEBUG][mobile-router][beforeEach]', {
    name: to.name,
    path: to.path,
    queryKeys: Object.keys(to.query),
    codePresent: Boolean(code),
    codeLength: code.length,
    statePresent: Boolean(state),
    statePrefix: state ? state.split('.')[0] : '',
    isAuthenticated: auth.isAuthenticated,
    hasUser: Boolean(auth.user),
  })

  if (code && state.startsWith('wecom.')) {
    if (auth.isAuthenticated) {
      console.info('[WECOM-DEBUG][mobile-router][wecom-already-authenticated]', {
        path: to.path,
      })
      if (nestedRedirect) return mobileRouteFromInternalPath(nestedRedirect)
      const query = { ...to.query }
      delete query.code
      delete query.state
      return { path: to.path, query, hash: to.hash, replace: true }
    }

    console.info('[WECOM-DEBUG][mobile-router][wecom-callback-start]', {
      codeLength: code.length,
      statePrefix: state.split('.')[0],
      nestedRedirect: nestedRedirect || undefined,
    })
    try {
      const { data } = await callbackWeComWorkbench({ code, state })
      auth.acceptLoginResult(data)
      console.info('[WECOM-DEBUG][mobile-router][wecom-callback-success]', {
        returnPath: data.returnPath,
        accessTokenPresent: Boolean(data.accessToken),
        accessTokenLength: data.accessToken?.length ?? 0,
        refreshTokenPresent: Boolean(data.refreshToken),
        refreshTokenLength: data.refreshToken?.length ?? 0,
        localAccessTokenPresent: Boolean(localStorage.getItem('mmx_access_token')),
        localRefreshTokenPresent: Boolean(localStorage.getItem('mmx_refresh_token')),
      })
      return mobileRouteFromReturnPath(data.returnPath || '/mobile/home')
    } catch (error) {
      console.error(
        '[WECOM-DEBUG][mobile-router][wecom-callback-failed]',
        debugErrorSummary(error),
      )
      return {
        name: 'mobile-login',
        query: {
          manual: '1',
          redirect: nestedRedirect || to.path,
          wecomError: '1',
        },
        replace: true,
      }
    }
  }

  if (!auth.isAuthenticated && to.name === 'mobile-login') {
    await enterpriseUi
      .loadLoginBranding({ tenantSlug: requestedTenant || undefined })
      .catch(() => undefined)
  } else if (!auth.isAuthenticated && requestedTenant) {
    await enterpriseUi.load(requestedTenant).catch(() => undefined)
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    console.warn('[WECOM-DEBUG][mobile-router][redirect-login]', {
      from: to.path,
      reason: 'protected-route-without-local-token',
      codePresent: Boolean(code),
      statePrefix: state ? state.split('.')[0] : '',
    })
    return { name: 'mobile-login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'mobile-login' && auth.isAuthenticated) return { path: '/' }

  if (auth.isAuthenticated && !auth.user) {
    console.info('[WECOM-DEBUG][mobile-router][fetch-me-start]')
    await auth.fetchMe().catch((error) => {
      console.error('[WECOM-DEBUG][mobile-router][fetch-me-failed]', debugErrorSummary(error))
      auth.logout()
    })
    if (!auth.user) {
      console.warn('[WECOM-DEBUG][mobile-router][redirect-login]', {
        from: to.path,
        reason: 'fetch-me-did-not-restore-user',
      })
      return { name: 'mobile-login' }
    }
    console.info('[WECOM-DEBUG][mobile-router][fetch-me-success]', {
      tenantSlug: auth.user.tenantSlug,
    })
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
