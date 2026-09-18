import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
import type {
  DictionaryAddDto,
  DictionaryModule,
  DictionarySortDto,
  DictionaryUpdateDto,
} from './dto/dictionary.dto'

const MAX_REASON_COUNT = 50
type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

@Injectable()
export class DictionariesService {
  constructor(private readonly prisma8: Prisma8Service) {}

  async list(organizationId: string, module: DictionaryModule) {
    const rows = await this.listRows(organizationId, module)
    return rows.map((row) => this.toVO(row))
  }

  private listRows(organizationId: string, module: DictionaryModule) {
    return this.dicts()
      .where({
        organizationId: organizationId,
        module: module,
      })
      .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
      .all()
  }

  async config(organizationId: string, module: DictionaryModule) {
    const [dictList, config] = await Promise.all([
      this.listRows(organizationId, module),
      this.configs()
        .where({
          module: module,
          organizationId: organizationId,
        })
        .first(),
    ])
    return {
      dictList: [
        ...dictList,
        {
          id: 'system',
          name: module === 'OPPORTUNITY_FAIL_RS' ? '系统自动关闭' : '系统自动回收',
          module,
          type: 'TEXT',
          pos: BigInt(dictList.length + 1),
          organizationId,
          createTime: BigInt(0),
          updateTime: BigInt(0),
          createUser: 'system',
          updateUser: 'system',
        },
      ].map((item) => this.toVO(item)),
      enable: config?.enabled ?? false,
    }
  }

  async add(user: AuthUser, dto: DictionaryAddDto) {
    const name = dto.name.trim()
    return this.prisma8.client.transaction(async (tx) => {
      const rows = await tx.orm.public.SysDict.where({
        organizationId: user.tenantId,
        module: dto.module,
      })
        .orderBy((row) => row.pos.asc())
        .all()
      if (rows.length >= MAX_REASON_COUNT) throw new BadRequestException('原因最多配置 50 条')
      if (rows.some((row) => row.name === name)) throw new BadRequestException('原因名称不能重复')
      const now = BigInt(Date.now())
      const row = await tx.orm.public.SysDict.create({
        id: createLegacyId32(),
        name: name,
        module: dto.module,
        _type: 'TEXT',
        pos: BigInt(rows.length + 1),
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      return this.toVO(row)
    })
  }

  async update(user: AuthUser, dto: DictionaryUpdateDto) {
    const row = await this.assertOwned(user.tenantId, dto.id)
    const name = dto.name.trim()
    const duplicate = await this.dicts()
      .where({
        organizationId: user.tenantId,
        module: row.module,
        name: name,
      })
      .select('id')
      .first()
    if (duplicate && duplicate.id !== row.id) throw new BadRequestException('原因名称不能重复')
    const updated = await this.dicts()
      .where({ id: row.id })
      .update({
        name: name,
        updateUser: user.id,
        updateTime: BigInt(Date.now()),
      })
    if (!updated) throw new NotFoundException('原因不存在')
    return this.toVO(updated)
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.assertOwned(user.tenantId, id)
    return this.prisma8.client.transaction(async (tx) => {
      const [config, rows] = await Promise.all([
        tx.orm.public.SysDictConfig.where({
          module: row.module,
          organizationId: user.tenantId,
        }).first(),
        tx.orm.public.SysDict.where({
          organizationId: user.tenantId,
          module: row.module,
        }).all(),
      ])
      if (config?.enabled && rows.length <= 1) {
        throw new BadRequestException('原因已启用，至少保留一条原因')
      }
      await tx.orm.public.SysDict.where({ id: id }).delete()
      await this.normalizePositions(tx, user.tenantId, row.module, user.id)
      return { id }
    })
  }

  async switch(user: AuthUser, module: DictionaryModule, enable: boolean) {
    if (enable) {
      const first = await this.dicts()
        .where({
          organizationId: user.tenantId,
          module: module,
        })
        .select('id')
        .first()
      if (!first) throw new BadRequestException('请先至少配置一条原因')
    }
    const scope = {
      module: module,
      organizationId: user.tenantId,
    }
    let row = await this.configs().where(scope).update({ enabled: enable })
    if (!row) {
      try {
        row = await this.configs().create({ ...scope, enabled: enable })
      } catch (error) {
        if ((error as { sqlState?: string }).sqlState !== '23505') throw error
        row = await this.configs().where(scope).update({ enabled: enable })
      }
    }
    if (!row) throw new NotFoundException('原因配置不存在')
    return { module: row.module, enable: row.enabled }
  }

  async sort(user: AuthUser, dto: DictionarySortDto) {
    const dragged = await this.assertOwned(user.tenantId, dto.dragDictId)
    return this.prisma8.client.transaction(async (tx) => {
      const rows = await tx.orm.public.SysDict.where({
        organizationId: user.tenantId,
        module: dragged.module,
      })
        .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
        .all()
      const from = rows.findIndex((row) => row.id === dragged.id)
      const to = Math.max(0, Math.min(rows.length - 1, dto.end - 1))
      if (from < 0) throw new NotFoundException('原因不存在')
      const [item] = rows.splice(from, 1)
      if (!item) throw new NotFoundException('原因不存在')
      rows.splice(to, 0, item)
      const now = BigInt(Date.now())
      for (const [index, row] of rows.entries()) {
        const updated = await tx.orm.public.SysDict.where({ id: row.id }).update({
          pos: BigInt(index + 1),
          updateTime: now,
          updateUser: user.id,
        })
        if (!updated) throw new NotFoundException('原因不存在')
      }
      return this.listAfterTransaction(tx, user.tenantId, dragged.module)
    })
  }

  async validateReason(organizationId: string, module: DictionaryModule, reasonId?: string | null) {
    const config = await this.configs()
      .where({
        module: module,
        organizationId: organizationId,
      })
      .first()
    if (!config?.enabled) return null
    const label =
      module === 'OPPORTUNITY_FAIL_RS'
        ? '商机失败原因'
        : module === 'CUSTOMER_POOL_RS'
          ? '移入客户公海原因'
          : '移入线索池原因'
    if (!reasonId || reasonId === 'system') throw new BadRequestException(`请选择${label}`)
    const reason = await this.dicts()
      .where({
        id: reasonId,
        organizationId: organizationId,
        module: module,
      })
      .first()
    if (!reason) throw new BadRequestException(`${label}不存在或已删除`)
    return reason
  }

  async isEnabled(organizationId: string, module: DictionaryModule) {
    const config = await this.configs()
      .where({
        module: module,
        organizationId: organizationId,
      })
      .select('enabled')
      .first()
    return config?.enabled ?? false
  }

  async reasonName(organizationId: string, reasonId: string | null) {
    if (!reasonId) return null
    if (reasonId === 'system') return '系统自动回收'
    const row = await this.dicts()
      .where({
        id: reasonId,
        organizationId: organizationId,
      })
      .select('name')
      .first()
    return row?.name ?? null
  }

  async reasonNames(organizationId: string, reasonIds: string[]) {
    const ids = [...new Set(reasonIds.filter((id) => id && id !== 'system'))]
    const rows = ids.length
      ? await this.dicts()
          .where({ organizationId: organizationId })
          .where((row) => row.id.in(ids))
          .select('id', 'name')
          .all()
      : []
    const map = new Map<string, string>(rows.map((row) => [row.id, row.name]))
    if (reasonIds.includes('system')) map.set('system', '系统自动回收')
    return map
  }

  private async assertOwned(organizationId: string, id: string) {
    const row = await this.dicts()
      .where({
        id: id,
        organizationId: organizationId,
      })
      .first()
    if (!row) throw new NotFoundException('原因不存在')
    return row
  }

  private toVO(row: {
    id: string
    name: string
    module: string
    type?: string
    _type?: string
    pos: bigint
    organizationId: string
    createTime: bigint
    updateTime: bigint
    createUser: string
    updateUser: string
  }) {
    return {
      id: row.id,
      name: row.name,
      module: row.module,
      type: row._type ?? row.type ?? 'TEXT',
      pos: Number(row.pos),
      organizationId: row.organizationId,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      createUser: row.createUser,
      updateUser: row.updateUser,
    }
  }

  private async normalizePositions(
    tx: Prisma8Transaction,
    organizationId: string,
    module: string,
    userId: string,
  ) {
    const rows = await tx.orm.public.SysDict.where({
      organizationId: organizationId,
      module: module,
    })
      .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
      .all()
    const now = BigInt(Date.now())
    for (const [index, row] of rows.entries()) {
      const updated = await tx.orm.public.SysDict.where({ id: row.id }).update({
        pos: BigInt(index + 1),
        updateTime: now,
        updateUser: userId,
      })
      if (!updated) throw new NotFoundException('原因不存在')
    }
  }

  private async listAfterTransaction(
    tx: Prisma8Transaction,
    organizationId: string,
    module: string,
  ) {
    const rows = await tx.orm.public.SysDict.where({
      organizationId: organizationId,
      module: module,
    })
      .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
      .all()
    return rows.map((row) => this.toVO(row))
  }

  private dicts() {
    return this.prisma8.client.orm.public.SysDict
  }

  private configs() {
    return this.prisma8.client.orm.public.SysDictConfig
  }
}
