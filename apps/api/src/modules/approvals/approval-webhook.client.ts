import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Injectable } from '@nestjs/common'
import type { ApprovalWebhookConfig } from '@micromatrix/shared'
import {
  allowApprovalWebhookLoopbackForTest,
  APPROVAL_WEBHOOK_RESPONSE_MAX_BYTES,
  APPROVAL_WEBHOOK_TIMEOUT_MS,
  ApprovalWebhookConfigError,
  isPublicWebhookAddress,
  normalizeApprovalWebhookConfig,
  parseApprovalWebhookHeaders,
  parseApprovalWebhookUrl,
  validateApprovalWebhookConfig,
} from './approval-webhook.utils'

export interface ApprovalWebhookClientResult {
  httpStatus: number
  responseBytes: number
  durationMs: number
}

export class ApprovalWebhookClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly result?: Partial<ApprovalWebhookClientResult>,
  ) {
    super(message)
    this.name = 'ApprovalWebhookClientError'
  }
}

@Injectable()
export class ApprovalWebhookClient {
  async send(input: ApprovalWebhookConfig): Promise<ApprovalWebhookClientResult> {
    const config = normalizeApprovalWebhookConfig(input)!
    validateApprovalWebhookConfig(config)
    if (!config.webHookEnable) {
      throw new ApprovalWebhookConfigError('WEBHOOK_DISABLED', 'Webhook 未启用')
    }

    const url = parseApprovalWebhookUrl(config.webHookUrl)
    const dnsHostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
    const resolved = await this.resolvePublicTarget(dnsHostname)
    const headers = parseApprovalWebhookHeaders(config.webHookHeader)
    const body = config.webHookMethod === 'POST' ? Buffer.from(config.webHookBody, 'utf8') : null
    if (body && !headers['content-type']) headers['content-type'] = 'application/json'
    if (body) headers['content-length'] = String(body.byteLength)

    return new Promise<ApprovalWebhookClientResult>((resolve, reject) => {
      const started = Date.now()
      let settled = false
      const finishResolve = (result: ApprovalWebhookClientResult) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      const finishReject = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
      const request = transport(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: config.webHookMethod,
          headers,
          lookup: (_hostname, _options, callback) => {
            callback(null, resolved.address, resolved.family)
          },
        },
        (response) => {
          let responseBytes = 0
          response.on('data', (chunk: Buffer | string) => {
            responseBytes += Buffer.byteLength(chunk)
            if (responseBytes > APPROVAL_WEBHOOK_RESPONSE_MAX_BYTES) {
              response.destroy()
              finishReject(
                new ApprovalWebhookClientError(
                  'RESPONSE_TOO_LARGE',
                  'Webhook 响应超过 64 KiB 上限',
                  {
                    httpStatus: response.statusCode ?? 0,
                    responseBytes,
                    durationMs: Date.now() - started,
                  },
                ),
              )
            }
          })
          response.on('end', () => {
            if (settled) return
            const result: ApprovalWebhookClientResult = {
              httpStatus: response.statusCode ?? 0,
              responseBytes,
              durationMs: Date.now() - started,
            }
            if (result.httpStatus < 200 || result.httpStatus >= 300) {
              finishReject(
                new ApprovalWebhookClientError(
                  'HTTP_STATUS',
                  `Webhook 返回非成功状态 ${result.httpStatus}`,
                  result,
                ),
              )
              return
            }
            finishResolve(result)
          })
          response.on('error', () => {
            finishReject(
              new ApprovalWebhookClientError('NETWORK', 'Webhook 响应读取失败', {
                httpStatus: response.statusCode ?? 0,
                responseBytes,
                durationMs: Date.now() - started,
              }),
            )
          })
        },
      )

      request.setTimeout(APPROVAL_WEBHOOK_TIMEOUT_MS, () => {
        request.destroy()
        finishReject(
          new ApprovalWebhookClientError('TIMEOUT', 'Webhook 请求超时', {
            durationMs: Date.now() - started,
          }),
        )
      })
      request.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) return
        const message =
          error.code === 'ECONNREFUSED'
            ? 'Webhook 目标拒绝连接'
            : error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN'
              ? 'Webhook 目标无法解析'
              : 'Webhook 网络请求失败'
        finishReject(
          new ApprovalWebhookClientError('NETWORK', message, { durationMs: Date.now() - started }),
        )
      })
      if (body) request.write(body)
      request.end()
    })
  }

  private async resolvePublicTarget(hostname: string) {
    let addresses: Array<{ address: string; family: number }>
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true })
    } catch {
      throw new ApprovalWebhookClientError('DNS_RESOLUTION_FAILED', 'Webhook 目标无法解析')
    }
    if (!addresses.length) {
      throw new ApprovalWebhookClientError('DNS_RESOLUTION_FAILED', 'Webhook 目标无法解析')
    }
    for (const item of addresses) {
      if (isPublicWebhookAddress(item.address)) continue
      if (allowApprovalWebhookLoopbackForTest(item.address)) continue
      throw new ApprovalWebhookClientError('PRIVATE_ADDRESS', 'Webhook 目标解析到非公网地址')
    }
    return addresses[0]
  }
}
