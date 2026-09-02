import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common'
import type {
  ApprovalModule,
  ApprovalNodeConfig,
  ApprovalWebhookConfig,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { ApprovalInstance } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalResourceService } from './approval-resource.service'
import {
  ApprovalWebhookClient,
  ApprovalWebhookClientError,
  type ApprovalWebhookClientResult,
} from './approval-webhook.client'
import {
  ApprovalWebhookConfigError,
  normalizeApprovalWebhookConfig,
  parseApprovalWebhookJsonBody,
  parseApprovalWebhookUrl,
  validateApprovalWebhookConfig,
} from './approval-webhook.utils'

interface DeliveryExecutionResult {
  ok: boolean
  result?: ApprovalWebhookClientResult
  error?: ApprovalWebhookClientError | ApprovalWebhookConfigError
}

@Injectable()
export class ApprovalWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ApprovalResourceService,
    private readonly client: ApprovalWebhookClient,
  ) {}

  async testConnection(user: AuthUser, input: ApprovalWebhookConfig) {
    const config = normalizeApprovalWebhookConfig(input)!
    try {
      validateApprovalWebhookConfig(config)
      if (!config.webHookEnable) {
        throw new ApprovalWebhookConfigError('WEBHOOK_DISABLED', '请先启用 Webhook 再测试连接')
      }
    } catch (error) {
      if (error instanceof ApprovalWebhookConfigError) throw new BadRequestException(error.message)
      throw error
    }

    const target = this.auditTarget(config.webHookUrl)
    const delivery = await this.prisma.approvalWebhookDelivery.create({
      data: {
        tenantId: user.tenantId,
        source: 'TEST',
        method: config.webHookMethod,
        targetOrigin: target.origin,
        targetPath: target.path,
        createdById: user.id,
      },
    })
    const execution = await this.executeDelivery(delivery.id, config)
    if (!execution.ok) {
      const error = execution.error!
      if (error instanceof ApprovalWebhookConfigError || this.isSecurityClientError(error)) {
        throw new BadRequestException(error.message)
      }
      throw new BadGatewayException(error.message)
    }
    return {
      ok: true,
      httpStatus: execution.result!.httpStatus,
      responseBytes: execution.result!.responseBytes,
      durationMs: execution.result!.durationMs,
    }
  }

  async enqueueRuntime(
    instance: ApprovalInstance,
    nodeIndex: number,
    action: 'APPROVE' | 'REJECT',
    operatorId: string,
  ) {
    const snapshot = instance.nodesSnapshot as unknown as ApprovalNodeConfig[]
    const node = snapshot[nodeIndex]
    if (!node) return
    const postConfig = action === 'APPROVE' ? node.passPostConfig : node.rejectPostConfig
    const configured = normalizeApprovalWebhookConfig(postConfig?.webHookConfig)
    if (!configured?.webHookEnable) return

    let runtimeConfig = configured
    try {
      const variables = await this.resources.webhookVariables(
        instance.tenantId,
        instance.module as ApprovalModule,
        instance.targetId,
      )
      runtimeConfig = this.resolveRuntimeConfig(configured, variables)
      validateApprovalWebhookConfig(runtimeConfig)
    } catch (error) {
      const normalizedError = this.normalizeError(error)
      const target = this.tryAuditTarget(configured.webHookUrl)
      await this.prisma.approvalWebhookDelivery.create({
        data: {
          tenantId: instance.tenantId,
          instanceId: instance.id,
          flowId: instance.flowId,
          flowVersionId: instance.flowVersionId,
          nodeId: node.nodeId ?? null,
          nodeIndex,
          action,
          source: 'RUNTIME',
          method: configured.webHookMethod,
          targetOrigin: target.origin,
          targetPath: target.path,
          status: 'FAILED',
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
          createdById: operatorId,
          finishedAt: new Date(),
        },
      })
      return
    }

    const target = this.auditTarget(runtimeConfig.webHookUrl)
    const delivery = await this.prisma.approvalWebhookDelivery.create({
      data: {
        tenantId: instance.tenantId,
        instanceId: instance.id,
        flowId: instance.flowId,
        flowVersionId: instance.flowVersionId,
        nodeId: node.nodeId ?? null,
        nodeIndex,
        action,
        source: 'RUNTIME',
        method: runtimeConfig.webHookMethod,
        targetOrigin: target.origin,
        targetPath: target.path,
        createdById: operatorId,
      },
    })
    setImmediate(() => {
      void this.executeDelivery(delivery.id, runtimeConfig).catch(() => undefined)
    })
  }

  private async executeDelivery(
    deliveryId: string,
    config: ApprovalWebhookConfig,
  ): Promise<DeliveryExecutionResult> {
    await this.prisma.approvalWebhookDelivery.update({
      where: { id: deliveryId },
      data: { startedAt: new Date() },
    })
    try {
      const result = await this.client.send(config)
      await this.prisma.approvalWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'SENT',
          httpStatus: result.httpStatus,
          responseBytes: result.responseBytes,
          durationMs: result.durationMs,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
        },
      })
      return { ok: true, result }
    } catch (error) {
      const normalizedError = this.normalizeError(error)
      const result = error instanceof ApprovalWebhookClientError ? error.result : undefined
      await this.prisma.approvalWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          httpStatus: result?.httpStatus || null,
          responseBytes: result?.responseBytes ?? null,
          durationMs: result?.durationMs ?? null,
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
          finishedAt: new Date(),
        },
      })
      return { ok: false, error: normalizedError }
    }
  }

  private resolveRuntimeConfig(
    config: ApprovalWebhookConfig,
    variables: Record<string, Record<string, unknown>>,
  ): ApprovalWebhookConfig {
    const webHookUrl =
      config.webHookMethod === 'GET'
        ? this.replaceTemplate(config.webHookUrl, variables, true)
        : config.webHookUrl
    const webHookBody =
      config.webHookMethod === 'POST'
        ? JSON.stringify(this.replaceJsonValue(parseApprovalWebhookJsonBody(config.webHookBody), variables))
        : config.webHookBody
    return {
      ...config,
      webHookUrl,
      webHookBody,
    }
  }

  private replaceJsonValue(
    value: unknown,
    variables: Record<string, Record<string, unknown>>,
  ): unknown {
    if (Array.isArray(value)) return value.map((item) => this.replaceJsonValue(item, variables))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          this.replaceJsonValue(item, variables),
        ]),
      )
    }
    if (typeof value !== 'string') return value
    const exact = /^\$\{([^}]+)\}$/.exec(value)
    if (exact) return this.resolvePlaceholder(exact[1], variables)
    return this.replaceTemplate(value, variables, false)
  }

  private replaceTemplate(
    template: string,
    variables: Record<string, Record<string, unknown>>,
    encode: boolean,
  ) {
    return template.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
      const value = this.resolvePlaceholder(key, variables)
      const text = value === null ? 'null' : String(value)
      return encode ? encodeURIComponent(text) : text
    })
  }

  private resolvePlaceholder(
    rawKey: string,
    variables: Record<string, Record<string, unknown>>,
  ): unknown {
    const [root, field, ...rest] = rawKey.trim().split('.')
    if (!root || !field || rest.length) {
      throw new ApprovalWebhookConfigError(
        'INVALID_PLACEHOLDER',
        `Webhook 占位符「${rawKey}」格式无效`,
      )
    }
    const resource = variables[root]
    if (!resource || !Object.prototype.hasOwnProperty.call(resource, field)) {
      throw new ApprovalWebhookConfigError(
        'UNKNOWN_PLACEHOLDER',
        `Webhook 占位符「${rawKey}」无法解析`,
      )
    }
    return resource[field]
  }

  private auditTarget(rawUrl: string) {
    const url = parseApprovalWebhookUrl(rawUrl)
    return { origin: url.origin, path: url.pathname === '/' ? '/' : '[redacted-path]' }
  }

  private tryAuditTarget(rawUrl: string) {
    try {
      return this.auditTarget(rawUrl)
    } catch {
      return { origin: '[invalid]', path: '/' }
    }
  }

  private normalizeError(error: unknown): ApprovalWebhookClientError | ApprovalWebhookConfigError {
    if (error instanceof ApprovalWebhookClientError || error instanceof ApprovalWebhookConfigError) {
      return error
    }
    return new ApprovalWebhookClientError('INTERNAL', 'Webhook 执行失败')
  }

  private isSecurityClientError(error: ApprovalWebhookClientError) {
    return ['PRIVATE_ADDRESS', 'DNS_RESOLUTION_FAILED'].includes(error.code)
  }
}
