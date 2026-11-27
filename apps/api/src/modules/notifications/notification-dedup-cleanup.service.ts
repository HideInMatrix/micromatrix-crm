import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  hasPermission,
  type NotificationDedupCleanupPreviewVO,
  type NotificationDedupCleanupInput,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma.service'
import type { PrismaClient } from '../../prisma/db'
import { jsonValue } from '../../prisma/json-value'
import { tryNotificationLock } from './notification-lifecycle-locks'

type Tx = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
const LIMIT = 5000
type Candidate = { sourceKey: string; expiresAt: string }

@Injectable()
export class NotificationDedupCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(tx: Tx, user: AuthUser) {
    const orm = tx.orm.public
    const [member, tenant, links] = await Promise.all([
      orm.Users.where({ id: user.id, tenantId: user.tenantId, status: 'ACTIVE' })
        .select('id', 'name')
        .first(),
      orm.Tenants.where({ id: user.tenantId, status: 'ACTIVE' }).select('id').first(),
      orm.UserRoles.where({ tenantId: user.tenantId, userId: user.id }).select('roleId').all(),
    ])
    if (!member || !tenant || !links.length) throw new ForbiddenException('没有清理去重凭据权限')
    const roles = await orm.Roles.where({ tenantId: user.tenantId })
      .where((row) => row.id.in(links.map((link) => link.roleId)))
      .select('permissions')
      .all()
    const permissions = roles.flatMap((role) => [...(role.permissions ?? [])])
    if (
      !hasPermission(permissions, 'system:message') ||
      !hasPermission(permissions, 'system:message:update')
    )
      throw new ForbiddenException('没有清理去重凭据权限')
    return member
  }
  private async candidates(tx: Tx, tenantId: string, lock: boolean): Promise<Candidate[]> {
    const client = this.prisma.client
    // NOWAIT prevents waiting behind busy rows; never silently substitute a
    // different candidate because of locks. Preview does not modify rows.
    const query = lock
      ? client.raw.sql`SELECT source_key AS "sourceKey", expires_at::text AS "expiresAt"
        FROM notification_source_tombstones
        WHERE tenant_id=${tenantId} AND expires_at<=clock_timestamp()
        ORDER BY expires_at,source_key LIMIT ${LIMIT + 1} FOR UPDATE NOWAIT`
      : client.raw.sql`SELECT source_key AS "sourceKey", expires_at::text AS "expiresAt"
        FROM notification_source_tombstones
        WHERE tenant_id=${tenantId} AND expires_at<=clock_timestamp()
        ORDER BY expires_at,source_key LIMIT ${LIMIT + 1}`
    const rows: Candidate[] = []
    for await (const row of tx.query(
      query.returnsRow({ sourceKey: 'pg/text@1', expiresAt: 'pg/text@1' }).build(),
    ))
      rows.push(row)
    return rows
  }
  private summarize(user: AuthUser, rows: Candidate[]): NotificationDedupCleanupPreviewVO {
    const selected = rows.slice(0, LIMIT)
    // Digest binds exact candidate identities AND their stored expiry,
    // tenant and confirming user; never expose source keys to clients.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([user.tenantId, user.id, selected]))
      .digest('hex')
    return { count: selected.length, hasMore: rows.length > LIMIT, fingerprint }
  }
  async preview(user: AuthUser): Promise<NotificationDedupCleanupPreviewVO> {
    return this.prisma.client.transaction(async (tx) => {
      await this.authorize(tx, user)
      return this.summarize(user, await this.candidates(tx, user.tenantId, false))
    })
  }
  async cleanup(
    user: AuthUser,
    input: NotificationDedupCleanupInput,
  ): Promise<{ deleted: number }> {
    if (
      input?.confirm !== true ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > LIMIT ||
      typeof input.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.fingerprint)
    )
      throw new BadRequestException('请先预览并明确确认清理范围')
    const client = this.prisma.client
    return client.transaction(async (tx) => {
      const member = await this.authorize(tx, user)
      if (!(await tryNotificationLock(client, tx, 'notification-dedup-manual:' + user.tenantId)))
        throw new ConflictException('当前已有清理任务，请重新预览')
      const candidates = await this.candidates(tx, user.tenantId, true)
      const current = this.summarize(user, candidates)
      if (current.count !== input.count || current.fingerprint !== input.fingerprint)
        throw new ConflictException('可清理记录已变化，请重新预览并确认')
      const keys = candidates.slice(0, LIMIT).map((row) => row.sourceKey)
      // Row locks and exact keys prevent deleting outside confirmed scope.
      const query = client.raw.sql`WITH removed AS (
        DELETE FROM notification_source_tombstones
        WHERE tenant_id=${user.tenantId} AND expires_at<=clock_timestamp()
          AND source_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
        RETURNING 1
      ) SELECT count(*)::text AS count FROM removed`.returnsRow({ count: 'pg/text@1' })
      let deleted = 0
      for await (const row of tx.query(query.build())) deleted = Number(row.count)
      if (deleted !== input.count) throw new ConflictException('清理范围已变化，请重新预览')
      const log = await tx.orm.public.OperationLogs.create({
        tenantId: user.tenantId,
        userId: member.id,
        userName: member.name,
        module: 'messageSetting',
        action: 'cleanupNotificationDedup',
        targetName: '去重凭据清理 ' + deleted + ' 条',
      })
      await tx.orm.public.OperationLogBlobs.create({
        operationLogId: log.id,
        detail: jsonValue({ deleted, confirmed: true }),
      })
      return { deleted }
    })
  }
}
