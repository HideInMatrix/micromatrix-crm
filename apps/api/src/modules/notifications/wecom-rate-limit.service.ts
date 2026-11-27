import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { PrismaClient } from '../../prisma/db'
import { instantFromEpochMilliseconds } from '../../prisma/temporal'
import { PrismaService } from '../../prisma.service'

type Tx = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
type Identity = { corpId: string; agentId: string; externalSubject: string }
export type RateClaim = { id: string; tenantId: string; claimToken: string; attempts: number }
export type RateAdmission = 'granted' | 'rate_wait' | 'stale_claim'
const DAY = 86_400_000
const CONFIG_RETRY = 60_000

export function weComRateLimitEnabled(): boolean {
  return process.env.CRM_WECOM_RATE_LIMIT === '1'
}

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
function limit(name: string, max: number, fallback?: number): number {
  const raw = process.env[name]
  if ((raw === undefined || raw === '') && fallback !== undefined) return fallback
  const value = Number(raw)
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error('Invalid WeCom quota configuration')
  return value
}
function limits() {
  return {
    appSecond: limit('CRM_WECOM_APP_PER_SECOND', 10, 10),
    appDay: limit('CRM_WECOM_APP_DAILY_LIMIT', 1_000_000),
    memberMinute: limit('CRM_WECOM_MEMBER_PER_MINUTE', 24, 24),
    memberHour: limit('CRM_WECOM_MEMBER_PER_HOUR', 800, 800),
    memberDay: limit('CRM_WECOM_MEMBER_PER_DAY', 160, 160),
  }
}
export function weComQuotaKeys(identity: Identity) {
  const agent = Number(identity.agentId)
  if (
    !identity.corpId.trim() ||
    !/^\d+$/.test(identity.agentId) ||
    !Number.isSafeInteger(agent) ||
    agent <= 0 ||
    !identity.externalSubject.trim() ||
    identity.externalSubject.trim() !== identity.externalSubject ||
    identity.externalSubject.includes('|') ||
    identity.externalSubject.toLowerCase() === '@all'
  )
    throw new Error('Invalid WeCom single-recipient quota identity')
  // Provider application identity, not CRM tenant or rotating credential.
  // Canonicalize the numeric agent and conservatively group member case variants.
  const appKey = digest(['WECOM_APP', identity.corpId.trim().toLowerCase(), agent])
  return {
    appKey,
    memberKey: digest(['WECOM_MEMBER', appKey, identity.externalSubject.toLowerCase()]),
  }
}

@Injectable()
export class WeComRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  private async lock(tx: Tx, appKey: string) {
    const key = 'wecom-quota:' + appKey
    const query = this.prisma.client.raw.sql`SELECT 1::int4 AS locked
      FROM pg_advisory_xact_lock(hashtextextended(${key},0))`.returnsRow({ locked: 'pg/int4@1' })
    for await (const _row of tx.query(query.build())) break
  }
  private async now(tx: Tx): Promise<number> {
    const q = this.prisma.client.raw
      .sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS ms`.returnsRow({
      ms: 'pg/text@1',
    })
    for await (const row of tx.query(q.build())) {
      const ms = Number(row.ms)
      if (Number.isSafeInteger(ms) && ms > 0) return ms
    }
    throw new Error('WeCom quota database clock unavailable')
  }
  private claim(tx: Tx, claim: RateClaim) {
    return tx.orm.public.MessageDeliveries.where({
      id: claim.id,
      tenantId: claim.tenantId,
      channel: 'WECOM',
      status: 'SENDING',
      claimToken: claim.claimToken,
      attempts: claim.attempts,
    })
  }
  private async postpone(
    tx: Tx,
    claim: RateClaim,
    now: number,
    next: number,
    code: string,
  ): Promise<RateAdmission> {
    const updated = await this.claim(tx, claim).updateAndCount({
      status: 'PENDING',
      attempts: Math.max(0, claim.attempts - 1),
      nextAttemptAt: instantFromEpochMilliseconds(Math.max(now + 1, next)),
      errorCode: code,
      errorMessage:
        code === 'WECOM_RATE_LIMIT_WAIT' ? '企业微信配额等待' : '企业微信频控暂不可用，等待恢复',
      updatedAt: instantFromEpochMilliseconds(now),
    })
    return updated === 1 ? 'rate_wait' : 'stale_claim'
  }
  // Called only before a POST; a failed storage transaction must not fall back
  // to sending without a quota. This independent transaction can refund admission.
  async deferUnavailable(claim: RateClaim): Promise<RateAdmission> {
    return this.prisma.client.transaction(async (tx) => {
      const now = await this.now(tx)
      return this.postpone(tx, claim, now, now + CONFIG_RETRY, 'WECOM_RATE_LIMIT_UNAVAILABLE')
    })
  }
  async reserve(claim: RateClaim, identity: Identity): Promise<RateAdmission> {
    let budget: ReturnType<typeof limits>
    let keys: ReturnType<typeof weComQuotaKeys>
    try {
      budget = limits()
      keys = weComQuotaKeys(identity)
    } catch {
      return this.deferUnavailable(claim)
    }
    return this.prisma.client.transaction(async (tx) => {
      await this.lock(tx, keys.appKey)
      const now = await this.now(tx)
      const orm = tx.orm.public
      if (!(await this.claim(tx, claim).select('id').first())) return 'stale_claim'
      // Same claim may not reserve a second POST even if invoked twice.
      if (await orm.WeComSendReservation.where({ id: claim.claimToken }).select('id').first())
        return 'stale_claim'
      const cooldown = await orm.WeComRateCooldown.where({ appKey: keys.appKey }).first()
      let next = cooldown?.blockedUntil.epochMilliseconds ?? 0
      const windows = [
        { scope: { appKey: keys.appKey }, width: 1000, cap: budget.appSecond },
        { scope: { appKey: keys.appKey }, width: DAY, cap: budget.appDay },
        { scope: { memberKey: keys.memberKey }, width: 60_000, cap: budget.memberMinute },
        { scope: { memberKey: keys.memberKey }, width: 3_600_000, cap: budget.memberHour },
        { scope: { memberKey: keys.memberKey }, width: DAY, cap: budget.memberDay },
      ]
      // Find the cap-th most recent reservation, not all rows. At the limit
      // the earliest useful retry is that reservation's rolling-window expiry.
      for (const window of windows) {
        const edge = await orm.WeComSendReservation.where(window.scope)
          .where((row) => row.reservedAt.gt(instantFromEpochMilliseconds(now - window.width)))
          .select('reservedAt')
          .orderBy((row) => row.reservedAt.desc())
          .offset(window.cap - 1)
          .first()
        if (edge) next = Math.max(next, edge.reservedAt.epochMilliseconds + window.width + 1)
      }
      if (next > now) return this.postpone(tx, claim, now, next, 'WECOM_RATE_LIMIT_WAIT')
      // Verify ownership again under a row write lock before reserving. A
      // recovered or manually replaced claim can never receive a new permit.
      const owned = await this.claim(tx, claim).updateAndCount({
        updatedAt: instantFromEpochMilliseconds(now),
      })
      if (owned !== 1) return 'stale_claim'
      await orm.WeComSendReservation.create({
        id: claim.claimToken,
        ...keys,
        reservedAt: instantFromEpochMilliseconds(now),
      })
      return 'granted'
    })
  }
  async block(identity: Identity): Promise<void> {
    const { appKey } = weComQuotaKeys(identity)
    await this.prisma.client.transaction(async (tx) => {
      await this.lock(tx, appKey)
      const now = await this.now(tx)
      const until = instantFromEpochMilliseconds(now + CONFIG_RETRY).toString()
      const q = this.prisma.client.raw.sql`INSERT INTO wecom_rate_cooldowns(app_key,blocked_until)
        VALUES(${appKey},${until}::timestamptz)
        ON CONFLICT(app_key) DO UPDATE SET blocked_until=GREATEST(wecom_rate_cooldowns.blocked_until,EXCLUDED.blocked_until)
        RETURNING 1::int4 AS changed`.returnsRow({ changed: 'pg/int4@1' })
      for await (const _row of tx.query(q.build())) break
    })
  }
  // Bounded retention; no active rolling-day reservations or cooldowns removed.
  async cleanupExpired(): Promise<void> {
    const client = this.prisma.client
    const q = client.raw.sql`WITH reservations AS (
      DELETE FROM wecom_send_reservations WHERE id IN (
        SELECT id FROM wecom_send_reservations WHERE reserved_at < clock_timestamp()-interval '25 hours'
        ORDER BY reserved_at,id LIMIT 5000)
        AND reserved_at < clock_timestamp()-interval '25 hours' RETURNING 1
      ), cooldowns AS (
      DELETE FROM wecom_rate_cooldowns WHERE app_key IN (
        SELECT app_key FROM wecom_rate_cooldowns WHERE blocked_until < clock_timestamp()-interval '1 hour'
        ORDER BY blocked_until,app_key LIMIT 5000)
        AND blocked_until < clock_timestamp()-interval '1 hour' RETURNING 1
      ) SELECT (SELECT count(*) FROM reservations)::text AS reservations,
      (SELECT count(*) FROM cooldowns)::text AS cooldowns`.returnsRow({
      reservations: 'pg/text@1',
      cooldowns: 'pg/text@1',
    })
    for await (const _row of client.runtime().query(q.build())) {
      /* consume */
    }
  }
}
