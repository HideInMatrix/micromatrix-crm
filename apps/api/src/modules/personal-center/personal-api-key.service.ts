import { randomBytes } from 'node:crypto'
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import {
  prisma8TimestampFromDate,
  prisma8TimestampToDate,
} from '../../prisma/prisma8-temporal'
import type { UpdatePersonalApiKeyDto } from './dto/personal-api-key.dto'

@Injectable()
export class PersonalApiKeyService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly changeLog: BusinessChangeLogService,
  ) {}

  async list(user: AuthUser) {
    const rows = await this.keys()
      .where({ createUser: user.id })
      .orderBy((row) => row.createTime.desc())
      .all()
    return rows.map((row) => this.toVO(row))
  }

  async add(user: AuthUser): Promise<void> {
    const count = (await this.keys().where({ createUser: user.id }).select('id').all()).length
    if (count >= 5) throw new ConflictException('每个用户最多创建 5 个 API Key')

    const created = await this.keys().create({
      createUser: user.id,
      accessKey: `ak_${randomBytes(15).toString('base64url')}`,
      secretKey: `sk_${randomBytes(30).toString('base64url')}`,
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
    const updated = await this.keys().where({ id: current.id, createUser: user.id }).update({
      forever: dto.forever,
      expireTime: expireAt ? prisma8TimestampFromDate(expireAt) : null,
      description: dto.description?.trim() || null,
    })
    if (!updated) throw new NotFoundException('API Key 不存在')
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
    await this.keys().where({ id: current.id, createUser: user.id }).delete()
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
    const updated = await this.keys().where({ id: current.id, createUser: user.id }).update({
      enable: enabled,
    })
    if (!updated) throw new NotFoundException('API Key 不存在')
    await this.changeLog.record(user, {
      module: 'personalApiKey',
      action: enabled ? 'enable' : 'disable',
      targetId: updated.id,
      targetName: updated.accessKey,
      before: { enabled: current.enable },
      after: { enabled: updated.enable },
    })
  }

  private async getOwned(userId: string, id: string) {
    const row = await this.keys().where({ id, createUser: userId }).first()
    if (!row) throw new NotFoundException('API Key 不存在')
    return row
  }

  private keys() {
    return this.prisma8.client.orm.public.UserKey
  }

  private toVO(row: {
    id: string
    createUser: string
    accessKey: string
    secretKey: string
    createTime: ReturnType<typeof prisma8TimestampFromDate>
    enable: boolean
    forever: boolean
    expireTime: ReturnType<typeof prisma8TimestampFromDate> | null
    description: string | null
  }) {
    return {
      id: row.id,
      createUser: row.createUser,
      accessKey: row.accessKey,
      secretKey: row.secretKey,
      createTime: prisma8TimestampToDate(row.createTime).getTime(),
      enable: row.enable,
      forever: row.forever,
      expireTime: row.expireTime ? prisma8TimestampToDate(row.expireTime).getTime() : null,
      description: row.description ?? '',
    }
  }

  private loggable(row: {
    accessKey: string
    enable: boolean
    forever: boolean
    expireTime: ReturnType<typeof prisma8TimestampFromDate> | null
    description: string | null
  }) {
    return {
      accessKey: row.accessKey,
      enabled: row.enable,
      forever: row.forever,
      expireAt: row.expireTime ? prisma8TimestampToDate(row.expireTime) : null,
      description: row.description,
    }
  }
}
