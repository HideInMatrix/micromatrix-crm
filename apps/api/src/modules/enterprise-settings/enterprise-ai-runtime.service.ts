import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import { PrismaService } from '../../prisma/prisma.service'

export interface EnterpriseAiCompletionResult {
  text: string
  latencyMs: number
  modelId: string
  modelName: string
  displayName: string
  provider: string
}

@Injectable()
export class EnterpriseAiRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
  ) {}

  async complete(
    tenantId: string,
    modelId: string,
    prompt: string,
    requestedMaxTokens = 512,
  ): Promise<EnterpriseAiCompletionResult> {
    const model = await this.prisma.enterpriseAiModel.findFirst({
      where: { id: modelId, tenantId },
    })
    if (!model) throw new NotFoundException('模型不存在')
    if (!model.enable) throw new BadRequestException('模型当前未启用')
    if (!model.apiKeyCiphertext || !model.apiKeyIv || !model.apiKeyAuthTag) {
      throw new BadRequestException('模型 API Key 未配置')
    }

    const apiKey = this.cipher.decrypt({
      ciphertext: model.apiKeyCiphertext,
      iv: model.apiKeyIv,
      authTag: model.apiKeyAuthTag,
      keyVersion: model.apiKeyKeyVersion ?? 1,
    })
    const maxTokens = Math.max(
      1,
      Math.min(model.maxTokens ?? requestedMaxTokens, requestedMaxTokens),
    )
    const started = Date.now()
    try {
      const text =
        model.provider === 'Anthropic'
          ? await this.callAnthropic(model.apiUrl, apiKey, model.modelName, prompt, {
              temperature: Number(model.temperature),
              topP: Number(model.topP),
              maxTokens,
            })
          : await this.callOpenAiCompatible(model.apiUrl, apiKey, model.modelName, prompt, {
              temperature: Number(model.temperature),
              topP: Number(model.topP),
              maxTokens,
            })
      return {
        text,
        latencyMs: Date.now() - started,
        modelId: model.id,
        modelName: model.modelName,
        displayName: model.displayName,
        provider: model.provider,
      }
    } catch (error) {
      if (error instanceof BadGatewayException) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new BadGatewayException(`模型请求失败：${message}`)
    }
  }

  private async callOpenAiCompatible(
    apiUrl: string,
    apiKey: string,
    modelName: string,
    prompt: string,
    options: { temperature: number; topP: number; maxTokens: number },
  ) {
    const response = await fetch(this.endpoint(apiUrl, 'chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature,
        top_p: options.topP,
        max_tokens: options.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = (await this.readJson(response)) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>
      error?: { message?: string }
      message?: string
    }
    if (!response.ok) this.throwProviderError(response.status, payload)
    const text = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text
    if (!text?.trim()) throw new BadGatewayException('模型返回内容为空')
    return text.trim()
  }

  private async callAnthropic(
    apiUrl: string,
    apiKey: string,
    modelName: string,
    prompt: string,
    options: { temperature: number; topP: number; maxTokens: number },
  ) {
    const response = await fetch(this.endpoint(apiUrl, 'messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature,
        top_p: options.topP,
        max_tokens: options.maxTokens,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = (await this.readJson(response)) as {
      content?: Array<{ type?: string; text?: string }>
      error?: { message?: string }
      message?: string
    }
    if (!response.ok) this.throwProviderError(response.status, payload)
    const text = payload.content
      ?.filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n')
    if (!text?.trim()) throw new BadGatewayException('模型返回内容为空')
    return text.trim()
  }

  private endpoint(apiUrl: string, suffix: string) {
    const url = new URL(apiUrl)
    if (url.pathname.replace(/\/$/, '').endsWith(`/${suffix}`)) return url
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${suffix}`.replace(/\/{2,}/g, '/')
    return url
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return {}
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new BadGatewayException(`模型服务返回了非 JSON 响应（HTTP ${response.status}）`)
    }
  }

  private throwProviderError(
    status: number,
    payload: { error?: { message?: string }; message?: string },
  ): never {
    const raw = payload.error?.message ?? payload.message ?? `HTTP ${status}`
    throw new BadGatewayException(`模型服务调用失败（${status}）：${String(raw).slice(0, 500)}`)
  }
}
