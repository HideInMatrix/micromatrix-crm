import { Injectable } from '@nestjs/common'
import type { MessageLanguage, MessageTaskEvent } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import {
  APPROVAL_TEMPLATE_STATES,
  APPROVAL_TEMPLATE_TYPES,
  MESSAGE_SUBJECT_SUFFIX,
  MESSAGE_TEMPLATE_RESOURCES,
  type ApprovalTemplateState,
  type ApprovalTemplateType,
} from './message-template.resources'

export interface RenderedMessageTemplate {
  language: MessageLanguage
  title: string
  content: string
}

@Injectable()
export class MessageTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeLanguage(language: string | null | undefined): MessageLanguage {
    return language?.replace('_', '-').toLowerCase() === 'en-us' ? 'en-US' : 'zh-CN'
  }

  async render(
    tenantId: string,
    event: MessageTaskEvent,
    context: Record<string, unknown> = {},
    language?: string | null,
  ): Promise<RenderedMessageTemplate> {
    const normalizedLanguage = this.normalizeLanguage(language)
    const resource = MESSAGE_TEMPLATE_RESOURCES[normalizedLanguage][event]
    const normalizedContext = this.localizeSemanticContext(
      normalizedLanguage,
      await this.normalizeContext(tenantId, context),
    )
    return {
      language: normalizedLanguage,
      title: this.substitute(
        `${resource.eventName}${MESSAGE_SUBJECT_SUFFIX[normalizedLanguage]}`,
        normalizedContext,
      ),
      content: this.substitute(resource.template, normalizedContext),
    }
  }

  /** 对齐 Cordys MessageTemplateUtils.getContent：直接渲染任意资源模板文本。 */
  async renderText(
    tenantId: string,
    template: string,
    context: Record<string, unknown> = {},
  ): Promise<string> {
    return this.substitute(template, await this.normalizeContext(tenantId, context))
  }

  private async normalizeContext(
    tenantId: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const normalized: Record<string, string> = {}
    const userLookups: Array<{ key: string; value: string }> = []

    for (const [key, rawValue] of Object.entries(context)) {
      if (rawValue === null || rawValue === undefined) {
        normalized[key] = ''
        continue
      }
      if (/Time$/i.test(key)) {
        normalized[key] = this.formatTime(rawValue)
        continue
      }
      const value = String(rawValue)
      normalized[key] = value
      if (/User$/i.test(key) && this.looksLikeUserAddress(value)) userLookups.push({ key, value })
    }

    if (userLookups.length) {
      const values = [...new Set(userLookups.map(({ value }) => value))]
      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          OR: [{ email: { in: values, mode: 'insensitive' } }, { phone: { in: values } }],
        },
        select: { email: true, phone: true, name: true },
      })
      const names = new Map<string, string>()
      for (const user of users) {
        if (user.email) names.set(user.email.toLowerCase(), user.name)
        if (user.phone) names.set(user.phone, user.name)
      }
      for (const { key, value } of userLookups) {
        normalized[key] = names.get(value.toLowerCase()) ?? names.get(value) ?? value
      }
    }
    return normalized
  }

  private substitute(template: string, context: Record<string, string>): string {
    return template.replace(/\$\{([^}]+)\}/g, (token, key: string) =>
      Object.prototype.hasOwnProperty.call(context, key) ? context[key]! : token,
    )
  }

  private localizeSemanticContext(
    language: MessageLanguage,
    context: Record<string, string>,
  ): Record<string, string> {
    const localized = { ...context }
    if (localized.type && this.isApprovalTemplateType(localized.type)) {
      localized.type = APPROVAL_TEMPLATE_TYPES[language][localized.type]
    }
    if (localized.state && this.isApprovalTemplateState(localized.state)) {
      localized.state = APPROVAL_TEMPLATE_STATES[language][localized.state]
    }
    return localized
  }

  private isApprovalTemplateType(value: string): value is ApprovalTemplateType {
    return ['quotation', 'contract', 'order', 'invoice'].includes(value)
  }

  private isApprovalTemplateState(value: string): value is ApprovalTemplateState {
    return value === 'APPROVED' || value === 'UNAPPROVED'
  }

  private formatTime(value: unknown): string {
    const date =
      value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value))
    if (Number.isNaN(date.getTime())) return String(value)
    const pad = (input: number) => String(input).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  private looksLikeUserAddress(value: string): boolean {
    return value.includes('@') || /^\+?[0-9][0-9 -]{5,}$/.test(value)
  }
}
