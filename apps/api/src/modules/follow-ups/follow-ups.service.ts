import { ForbiddenException, Injectable } from '@nestjs/common'
import { FollowUpVO, hasPermission } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CustomerAccessService } from '../../customers/customer-access.service'
import { FollowUpRecord } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AttachmentsService } from '../attachments/attachments.service'
import { CreateFollowUpDto, QueryFollowUpsDto } from './dto/follow-up.dto'

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly customerAccess: CustomerAccessService,
  ) {}

  async list(user: AuthUser, query: QueryFollowUpsDto): Promise<FollowUpVO[]> {
    if (query.targetType === 'customer') {
      const access = await this.customerAccess.assertFollowRead(user, query.targetId)
      const permission = access.customer.inSharedPool ? 'customerPool:read' : 'customer:read'
      if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无客户读取权限')
    }
    const records = await this.prisma.followUpRecord.findMany({
      where: { tenantId: user.tenantId, targetType: query.targetType, targetId: query.targetId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const attachMap = await this.attachments.listByTargets(
      user.tenantId,
      'follow-up',
      records.map((r) => r.id),
    )
    return records.map((r) => this.toVO(r, attachMap.get(r.id)))
  }

  async create(user: AuthUser, dto: CreateFollowUpDto): Promise<FollowUpVO> {
    if (dto.targetType === 'customer') {
      const access = await this.customerAccess.assertFollowWrite(user, dto.targetId)
      const permission = access.customer.inSharedPool ? 'customerPool:update' : 'customer:update'
      if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无客户更新权限')
    }
    const record = await this.prisma.followUpRecord.create({
      data: {
        tenantId: user.tenantId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        type: dto.type,
        content: dto.content,
        nextFollowAt: dto.nextFollowAt ? new Date(dto.nextFollowAt) : null,
        ownerId: user.id,
        ownerName: user.name,
      },
    })
    await this.touchTarget(user.tenantId, dto.targetType, dto.targetId)
    return this.toVO(record)
  }

  /** 更新目标对象的最近跟进时间 */
  private async touchTarget(tenantId: string, targetType: string, targetId: string) {
    const now = new Date()
    const directNow = BigInt(now.getTime())
    switch (targetType) {
      case 'lead':
        await this.prisma.clue.updateMany({
          where: { id: targetId, organizationId: tenantId },
          data: { followTime: directNow, updateTime: directNow },
        })
        break
      case 'customer':
        await this.prisma.customer.updateMany({
          where: { id: targetId, organizationId: tenantId },
          data: { followTime: directNow, updateTime: directNow },
        })
        break
      case 'opportunity':
        await this.prisma.opportunity.updateMany({
          where: { id: targetId, tenantId },
          data: { lastFollowedAt: now },
        })
        break
      default:
        break
    }
  }

  private toVO(record: FollowUpRecord, attachments?: FollowUpVO['attachments']): FollowUpVO {
    return {
      id: record.id,
      targetType: record.targetType as FollowUpVO['targetType'],
      targetId: record.targetId,
      type: record.type,
      content: record.content,
      nextFollowAt: record.nextFollowAt?.toISOString() ?? null,
      ownerId: record.ownerId,
      ownerName: record.ownerName,
      createdAt: record.createdAt.toISOString(),
      attachments: attachments ?? [],
    }
  }
}
