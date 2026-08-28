import { randomBytes } from 'node:crypto'
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { UpdatePersonalApiKeyDto } from './dto/personal-api-key.dto'

@Injectable()
export class PersonalApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLog: BusinessChangeLogService,
  ) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.userApiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((row) => this.toVO(row))
  }

  async add(user: AuthUser): Promise<void> {
    const count = await this.prisma.userApiKey.count({ where: { userId: user.id } })
    if (count >= 5) throw new ConflictException('每个用户最多创建 5 个 API Key')

    const created = await this.prisma.userApiKey.create({
      data: {
        userId: user.id,
        accessKey: `ak_${randomBytes(15).toString('base64url')}`,
        secretKey: `sk_${randomBytes(30).toString('base64url')}`,
      },
    })
    await this.changeLog.record(user, {
      module: 'personalApiKey',
      action: 'add',
      targetId: created.id,
      targetName: created.accessKey,
      before: {},
      after: { accessKey: created.accessKey, enabled: true, forever: true },
    })
  }

  async update(user: AuthUser, dto: UpdatePersonalApiKeyDto): Promise<void> {
    const current = await this.getOwned(user.id, dto.id)
    let expireAt: Date | null = null
    if (!dto.forever) {
      if (!dto.expireTime) throw new UnprocessableEntityException('非永久 API Key 必须设置到期时间')
      expireAt = new Date(dto.expireTime)
      if (Number.isNaN(expireAt.getTime())) throw new UnprocessableEntityException('到期时间无效')
    }
    const updated = await this.prisma.userApiKey.update({
      where: { id: current.id },
      data: {
        forever: dto.forever,
        expireAt,
        description: dto.description?.trim() || null,
      },
    })
    await this.changeLog.record(user, {
      module: 'personalApiKey',
      action: 'update',
      targetId: updated.id,
      targetName: updated.accessKey,
      before: this.loggable(current),
      after: this.loggable(updated),
    })
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const current = await this.getOwned(user.id, id)
    await this.prisma.userApiKey.delete({ where: { id: current.id } })
    await this.changeLog.record(user, {
      module: 'personalApiKey',
      action: 'delete',
      targetId: current.id,
      targetName: current.accessKey,
      before: this.loggable(current),
      after: {},
    })
  }

  async setEnabled(user: AuthUser, id: string, enabled: boolean): Promise<void> {
    const current = await this.getOwned(user.id, id)
    const updated = await this.prisma.userApiKey.update({
      where: { id: current.id },
      data: { enabled },
    })
    await this.changeLog.record(user, {
      module: 'personalApiKey',
      action: enabled ? 'enable' : 'disable',
      targetId: updated.id,
      targetName: updated.accessKey,
      before: { enabled: current.enabled },
      after: { enabled: updated.enabled },
    })
  }

  private async getOwned(userId: string, id: string) {
    const row = await this.prisma.userApiKey.findFirst({ where: { id, userId } })
    if (!row) throw new NotFoundException('API Key 不存在')
    return row
  }

  private toVO(row: {
    id: string
    userId: string
    accessKey: string
    secretKey: string
    createdAt: Date
    enabled: boolean
    forever: boolean
    expireAt: Date | null
    description: string | null
  }) {
    return {
      id: row.id,
      createUser: row.userId,
      accessKey: row.accessKey,
      secretKey: row.secretKey,
      createTime: row.createdAt.getTime(),
      enable: row.enabled,
      forever: row.forever,
      expireTime: row.expireAt?.getTime() ?? null,
      description: row.description ?? '',
    }
  }

  private loggable(row: {
    accessKey: string
    enabled: boolean
    forever: boolean
    expireAt: Date | null
    description: string | null
  }) {
    return {
      accessKey: row.accessKey,
      enabled: row.enabled,
      forever: row.forever,
      expireAt: row.expireAt,
      description: row.description,
    }
  }
}
