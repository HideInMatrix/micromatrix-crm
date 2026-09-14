import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request, Response } from 'express'
import { WeComSsoController } from './wecom-sso.controller'
import type { WeComSsoService } from './wecom-sso.service'

test('企业微信应用主页入口写入工作台 nonce cookie 并由后端 302 到 OAuth 授权页', async () => {
  let receivedInput: { tenantSlug?: string; target?: string } | undefined
  let receivedOrigin: string | undefined
  let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined
  let redirect: { status: number; url: string } | undefined

  const authorizationUrl =
    'https://open.weixin.qq.com/connect/oauth2/authorize?appid=ww-a&scope=snsapi_base#wechat_redirect'
  const service = {
    startWorkbenchEntry: async (
      input: { tenantSlug?: string; target?: string },
      origin?: string,
    ) => {
      receivedInput = input
      receivedOrigin = origin
      return {
        value: {
          authorizationUrl,
          corpId: 'ww-a',
          agentId: '1000001',
          redirectUri: 'https://crm.example.com/login/wecom/callback',
          state: 'wecom.state',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        browserNonce: 'browser-nonce',
        secureCookie: true,
      }
    },
  } as unknown as WeComSsoService

  const request = {
    headers: { origin: 'https://crm.example.com' },
    protocol: 'https',
    get: (name: string) => (name === 'host' ? 'crm.example.com' : undefined),
  } as unknown as Request
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookie = { name, value, options }
      return response
    },
    redirect: (status: number, url: string) => {
      redirect = { status, url }
      return response
    },
  } as unknown as Response

  const controller = new WeComSsoController(service)
  await controller.enterWorkbench(
    { tenant: 'acme', target: 'https://crm.example.com/teacher' },
    request,
    response,
  )

  assert.deepEqual(receivedInput, {
    tenantSlug: 'acme',
    target: 'https://crm.example.com/teacher',
  })
  assert.equal(receivedOrigin, 'https://crm.example.com')
  assert.deepEqual(cookie, {
    name: 'mm_wecom_workbench_oauth_nonce',
    value: 'browser-nonce',
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 10 * 60 * 1_000,
      path: '/api/auth/wecom',
    },
  })
  assert.deepEqual(redirect, { status: 302, url: authorizationUrl })
})
