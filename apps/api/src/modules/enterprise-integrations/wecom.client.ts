import { Injectable } from '@nestjs/common'

export interface WeComConnectionInput {
  corpId: string
  agentId: string
  appSecret: string
}

export interface WeComConnectionResult {
  success: boolean
  message: string
  providerCode: number | null
}

interface WeComResponse {
  errcode: number | null
  errmsg: string | null
  accessToken: string | null
}

@Injectable()
export class WeComClient {
  async testConnection(input: WeComConnectionInput): Promise<WeComConnectionResult> {
    const tokenUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
    tokenUrl.searchParams.set('corpid', input.corpId)
    tokenUrl.searchParams.set('corpsecret', input.appSecret)

    const tokenResponse = await this.request(tokenUrl)
    if (!tokenResponse.ok) return tokenResponse.result
    if (!tokenResponse.data.accessToken) {
      return { success: false, message: '企业微信未返回 access token', providerCode: null }
    }

    const agentUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/agent/get')
    agentUrl.searchParams.set('access_token', tokenResponse.data.accessToken)
    agentUrl.searchParams.set('agentid', input.agentId)
    const agentResponse = await this.request(agentUrl)
    if (!agentResponse.ok) return agentResponse.result

    return { success: true, message: '企业微信连接成功', providerCode: 0 }
  }

  private async request(
    url: URL,
  ): Promise<{ ok: true; data: WeComResponse } | { ok: false; result: WeComConnectionResult }> {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        return {
          ok: false,
          result: {
            success: false,
            message: `企业微信服务响应异常（HTTP ${response.status}）`,
            providerCode: null,
          },
        }
      }

      const data = this.parseResponse(await response.json())
      if (data.errcode !== 0) {
        const detail = data.errmsg ? `：${data.errmsg.slice(0, 160)}` : ''
        return {
          ok: false,
          result: {
            success: false,
            message: `企业微信连接失败（${data.errcode ?? '未知错误'}）${detail}`,
            providerCode: data.errcode,
          },
        }
      }
      return { ok: true, data }
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return {
        ok: false,
        result: {
          success: false,
          message:
            name === 'TimeoutError' || name === 'AbortError'
              ? '企业微信连接超时'
              : '企业微信服务暂时不可用',
          providerCode: null,
        },
      }
    }
  }

  private parseResponse(value: unknown): WeComResponse {
    if (!value || typeof value !== 'object') {
      return { errcode: null, errmsg: null, accessToken: null }
    }
    const data = value as Record<string, unknown>
    return {
      errcode: typeof data['errcode'] === 'number' ? data['errcode'] : null,
      errmsg: typeof data['errmsg'] === 'string' ? data['errmsg'] : null,
      accessToken: typeof data['access_token'] === 'string' ? data['access_token'] : null,
    }
  }
}
