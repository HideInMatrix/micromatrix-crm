import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
  hasPermission,
  type MessageLanguage,
  type NotificationBatchDetailVO,
  type NotificationBatchItemVO,
  type NotificationCategory,
} from '@micromatrix/shared'
import { toAuthUser, type AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { CustomerAccessService } from '../../customers/customer-access.service'
import { PrismaService } from '../../prisma.service'
import { instantToISOString } from '../../prisma/temporal'
import { FollowUpPlansService } from '../follow-up-plans/follow-up-plans.service'
import { FollowUpsService } from '../follow-ups/follow-ups.service'
import { MESSAGE_TEMPLATE_RESOURCES } from './message-template.resources'

const CATEGORIES: Record<string, [string, string]> = {
  LEAD_ACTIVITY: ['线索动态', 'Lead activity'],
  CUSTOMER_ACTIVITY: ['客户动态', 'Customer activity'],
  BUSINESS_TODO: ['业务待办', 'Business tasks'],
  INTERACTION: ['互动消息', 'Interactions'],
}

@Injectable()
export class NotificationBatchDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly customers: CustomerAccessService,
    private readonly plans: FollowUpPlansService,
    private readonly followUps: FollowUpsService,
  ) {}

  // AuthGuard may use its short-lived cache. Rebuild role scope from the DB
  // before exposing historic notification payloads.
  private async freshUser(auth: AuthUser): Promise<AuthUser> {
    const orm = this.prisma.client.orm.public
    const user = await orm.Users.where({ id: auth.id, tenantId: auth.tenantId, status: 'ACTIVE' })
      .select('id', 'tenantId', 'email', 'name', 'deptId', 'leaderId')
      .first()
    if (!user) throw new NotFoundException('通知批次不存在')
    const tenant = await orm.Tenants.where({ id: auth.tenantId, status: 'ACTIVE' })
      .select('id')
      .first()
    if (!tenant) throw new NotFoundException('通知批次不存在')
    const links = await orm.UserRoles.where({ tenantId: auth.tenantId, userId: auth.id })
      .select('roleId')
      .all()
    const ids = [...new Set(links.map((row) => row.roleId))]
    const roles = ids.length
      ? await orm.Roles.where({ tenantId: auth.tenantId })
          .where((row) => row.id.in(ids))
          .select('id', 'name', 'permissions', 'dataScope', 'scopeDeptIds')
          .all()
      : []
    return toAuthUser({
      ...user,
      userRoles: roles.map((role) => ({
        role: {
          ...role,
          permissions: [...(role.permissions ?? [])],
          scopeDeptIds: [...(role.scopeDeptIds ?? [])],
        },
      })),
    })
  }

  async list(
    auth: AuthUser,
    id: string,
    page = 1,
    pageSize = 20,
  ): Promise<NotificationBatchDetailVO> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      throw new NotFoundException('通知批次不存在')
    const orm = this.prisma.client.orm.public
    const batch = await orm.NotificationBatch.where({
      id,
      tenantId: auth.tenantId,
      recipientId: auth.id,
    })
      .where((row) => row.sealedAt.isNotNull())
      .first()
    if (!batch || !batch.outputId || (batch.channel !== 'SYSTEM' && batch.channel !== 'WECOM'))
      throw new NotFoundException('通知批次不存在')
    const user = await this.freshUser(auth)
    // Channel-specific batch can be opened by its recipient even without a
    // corresponding SYSTEM notification. Reject missing/deleted outputs.
    const output =
      batch.channel === 'SYSTEM'
        ? await orm.Notifications.where({
            id: batch.outputId,
            tenantId: user.tenantId,
            userId: user.id,
          })
            .select('id')
            .first()
        : await orm.MessageDeliveries.where({
            id: batch.outputId,
            tenantId: user.tenantId,
            userId: user.id,
            channel: 'WECOM',
          })
            .select('id')
            .first()
    if (!output) throw new NotFoundException('通知批次不存在')
    const visible = () =>
      orm.NotificationItem.where({ batchId: batch.id }).where((row) => row.suppressedAt.isNull())
    const [rows, count] = await Promise.all([
      visible()
        .orderBy((row) => row.createdAt.asc())
        .orderBy((row) => row.id.asc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      visible().aggregate((agg) => ({ total: agg.count() })),
    ])
    // Archive may commit between the first batch read and the page read.
    // Re-read the marker; never expose a partial page for an archived batch.
    const current = await orm.NotificationBatch.where({
      id: batch.id,
      tenantId: user.tenantId,
      recipientId: user.id,
    })
      .select('detailsArchivedAt')
      .first()
    if (!current) throw new NotFoundException('通知批次不存在')
    const archivedAt = current.detailsArchivedAt
    const language: MessageLanguage = batch.language === 'en-US' ? 'en-US' : 'zh-CN'
    const resources = MESSAGE_TEMPLATE_RESOURCES[language] as Record<string, { eventName: string }>
    const items: NotificationBatchItemVO[] = []
    // Limit DB concurrency and reuse only authorization results within this response.
    const decisions = new Map<string, Promise<string | null>>()
    for (const row of archivedAt ? [] : rows) {
      let link: string | null = null
      if (row.link) {
        const key = JSON.stringify([row.event, row.link])
        let decision = decisions.get(key)
        if (!decision) {
          decision = this.authorizeLink(user, row.event, row.link)
          decisions.set(key, decision)
        }
        link = await decision
      }
      const eventName = Object.prototype.hasOwnProperty.call(resources, row.event)
        ? resources[row.event]!.eventName
        : language === 'en-US'
          ? 'Business notification'
          : '业务通知'
      items.push({
        id: row.id,
        event: row.event,
        eventName,
        occurredAt: instantToISOString(row.occurredAt),
        accessible: link !== null,
        // A link proves access to its target, not every historical template
        // variable (e.g. a converted customer's former lead or actor name).
        // Use only static labels; the live resource UI enforces field access.
        title: link ? eventName : null,
        content: null,
        link,
        linkLabel: link ? (language === 'en-US' ? 'View resource' : '查看业务记录') : null,
      })
    }
    const title = Object.prototype.hasOwnProperty.call(CATEGORIES, batch.category)
      ? CATEGORIES[batch.category]![language === 'en-US' ? 1 : 0]
      : language === 'en-US'
        ? 'Business activity'
        : '业务动态'
    return {
      id: batch.id,
      category: batch.category as NotificationCategory,
      channel: batch.channel,
      title,
      windowStart: instantToISOString(batch.windowStart),
      windowEnd: instantToISOString(batch.windowEnd),
      detailsArchivedAt: archivedAt ? instantToISOString(archivedAt) : null,
      total: archivedAt ? 0 : count.total,
      page,
      pageSize,
      items,
    }
  }

  private async authorizeLink(user: AuthUser, event: string, raw: string): Promise<string | null> {
    // Only explicit, known resource routes. Bare list URLs do not establish
    // record-level authorization. Do not return the original untrusted URL.
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
    let url: URL
    try {
      url = new URL(raw, 'https://notification.invalid')
    } catch {
      return null
    }
    if (url.origin !== 'https://notification.invalid' || url.hash) return null
    const path = url.pathname
    const id = url.searchParams.get('id')
    if (
      !id ||
      id.length > 128 ||
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      url.searchParams.getAll('id').length !== 1
    )
      return null
    const orm = this.prisma.client.orm.public
    try {
      if (path === '/follow-plans') {
        if (!event.includes('FOLLOW_UP_PLAN')) return null
        await this.plans.assertPlanAccess(user, id, false)
        return '/follow-plans?' + new URLSearchParams({ id })
      }
      if (path !== '/leads' && path !== '/customers') return null
      if (event.includes('FOLLOW_UP_PLAN')) return null
      const followId = url.searchParams.get('followUpId')
      const commentId = url.searchParams.get('commentId')
      const kind = path === '/leads' ? 'lead' : 'customer'
      if (event.includes('FOLLOW_UP_RECORD_COMMENT')) {
        if (!followId || !commentId || followId.length > 128 || commentId.length > 128) return null
        const record = await this.followUps.assertRecordAccess(user, followId, false)
        if (record.targetType !== kind || record.targetId !== id) return null
        const comment = await orm.FollowUpRecordComment.where({
          id: commentId,
          resourceId: followId,
          organizationId: user.tenantId,
        })
          .select('id')
          .first()
        if (!comment) return null
      } else if (followId || commentId) return null
      if (path === '/leads') {
        if (!hasPermission(user.permissions, 'menu:lead')) return null
        const lead = await orm.Clue.where({
          id,
          organizationId: user.tenantId,
          inSharedPool: false,
        })
          .select('owner')
          .first()
        if (!lead || !(await this.scope.matchesBusinessOwner(user, lead.owner))) return null
      } else {
        if (!hasPermission(user.permissions, 'customer:read')) return null
        await this.customers.assertRead(user, id)
      }
      return (
        path +
        '?' +
        new URLSearchParams({
          id,
          ...(followId && commentId ? { followUpId: followId, commentId } : {}),
        })
      )
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return null
      throw error // Database errors fail the request rather than leaking data.
    }
  }
}
