import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type {
  DictionaryAddDto,
  DictionaryModule,
  DictionarySortDto,
  DictionaryUpdateDto,
} from './dto/dictionary.dto'

const MAX_REASON_COUNT = 50

@Injectable()
export class DictionariesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, module: DictionaryModule) {
    const rows = await this.listRows(organizationId, module)
    return rows.map((row) => this.toVO(row))
  }

  private listRows(organizationId: string, module: DictionaryModule) {
    return this.prisma.sysDict.findMany({
      where: { organizationId, module },
      orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
    })
  }

  async config(organizationId: string, module: DictionaryModule) {
    const [dictList, config] = await Promise.all([
      this.listRows(organizationId, module),
      this.prisma.sysDictConfig.findUnique({
        where: { module_organizationId: { module, organizationId } },
      }),
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
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.sysDict.findMany({
        where: { organizationId: user.tenantId, module: dto.module },
        orderBy: { pos: 'asc' },
      })
      if (rows.length >= MAX_REASON_COUNT) throw new BadRequestException('原因最多配置 50 条')
      if (rows.some((row) => row.name === name)) throw new BadRequestException('原因名称不能重复')
      const now = BigInt(Date.now())
      const row = await tx.sysDict.create({
        data: {
          name,
          module: dto.module,
          type: 'TEXT',
          pos: BigInt(rows.length + 1),
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      return this.toVO(row)
    })
  }

  async update(user: AuthUser, dto: DictionaryUpdateDto) {
    const row = await this.assertOwned(user.tenantId, dto.id)
    const name = dto.name.trim()
    const duplicate = await this.prisma.sysDict.findFirst({
      where: {
        organizationId: user.tenantId,
        module: row.module,
        name,
        id: { not: row.id },
      },
    })
    if (duplicate) throw new BadRequestException('原因名称不能重复')
    return this.toVO(
      await this.prisma.sysDict.update({
        where: { id: row.id },
        data: { name, updateUser: user.id, updateTime: BigInt(Date.now()) },
      }),
    )
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.assertOwned(user.tenantId, id)
    return this.prisma.$transaction(async (tx) => {
      const [config, count] = await Promise.all([
        tx.sysDictConfig.findUnique({
          where: {
            module_organizationId: { module: row.module, organizationId: user.tenantId },
          },
        }),
        tx.sysDict.count({ where: { organizationId: user.tenantId, module: row.module } }),
      ])
      if (config?.enabled && count <= 1) {
        throw new BadRequestException('原因已启用，至少保留一条原因')
      }
      await tx.sysDict.delete({ where: { id } })
      await this.normalizePositions(tx, user.tenantId, row.module, user.id)
      return { id }
    })
  }

  async switch(user: AuthUser, module: DictionaryModule, enable: boolean) {
    if (enable) {
      const count = await this.prisma.sysDict.count({
        where: { organizationId: user.tenantId, module },
      })
      if (!count) throw new BadRequestException('请先至少配置一条原因')
    }
    const row = await this.prisma.sysDictConfig.upsert({
      where: { module_organizationId: { module, organizationId: user.tenantId } },
      update: { enabled: enable },
      create: { module, organizationId: user.tenantId, enabled: enable },
    })
    return { module: row.module, enable: row.enabled }
  }

  async sort(user: AuthUser, dto: DictionarySortDto) {
    const dragged = await this.assertOwned(user.tenantId, dto.dragDictId)
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.sysDict.findMany({
        where: { organizationId: user.tenantId, module: dragged.module },
        orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
      })
      const from = rows.findIndex((row) => row.id === dragged.id)
      const to = Math.max(0, Math.min(rows.length - 1, dto.end - 1))
      if (from < 0) throw new NotFoundException('原因不存在')
      const [item] = rows.splice(from, 1)
      if (!item) throw new NotFoundException('原因不存在')
      rows.splice(to, 0, item)
      const now = BigInt(Date.now())
      for (const [index, row] of rows.entries()) {
        await tx.sysDict.update({
          where: { id: row.id },
          data: { pos: BigInt(index + 1), updateTime: now, updateUser: user.id },
        })
      }
      return this.listAfterTransaction(tx, user.tenantId, dragged.module as DictionaryModule)
    })
  }

  async validateReason(
    organizationId: string,
    module: DictionaryModule,
    reasonId?: string | null,
  ) {
    const config = await this.prisma.sysDictConfig.findUnique({
      where: { module_organizationId: { module, organizationId } },
    })
    if (!config?.enabled) return null
    if (!reasonId || reasonId === 'system') throw new BadRequestException('请选择移入线索池原因')
    const reason = await this.prisma.sysDict.findFirst({
      where: { id: reasonId, organizationId, module },
    })
    if (!reason) throw new BadRequestException('移入线索池原因不存在或已删除')
    return reason
  }

  async isEnabled(organizationId: string, module: DictionaryModule) {
    const config = await this.prisma.sysDictConfig.findUnique({
      where: { module_organizationId: { module, organizationId } },
      select: { enabled: true },
    })
    return config?.enabled ?? false
  }

  async reasonName(organizationId: string, reasonId: string | null) {
    if (!reasonId) return null
    if (reasonId === 'system') return '系统自动回收'
    const row = await this.prisma.sysDict.findFirst({
      where: { id: reasonId, organizationId },
      select: { name: true },
    })
    return row?.name ?? null
  }

  async reasonNames(organizationId: string, reasonIds: string[]) {
    const ids = [...new Set(reasonIds.filter((id) => id && id !== 'system'))]
    const rows = ids.length
      ? await this.prisma.sysDict.findMany({
          where: { organizationId, id: { in: ids } },
          select: { id: true, name: true },
        })
      : []
    const map = new Map(rows.map((row) => [row.id, row.name]))
    if (reasonIds.includes('system')) map.set('system', '系统自动回收')
    return map
  }

  private async assertOwned(organizationId: string, id: string) {
    const row = await this.prisma.sysDict.findFirst({ where: { id, organizationId } })
    if (!row) throw new NotFoundException('原因不存在')
    return row
  }

  private toVO(row: {
    id: string
    name: string
    module: string
    type: string
    pos: bigint
    organizationId: string
    createTime: bigint
    updateTime: bigint
    createUser: string
    updateUser: string
  }) {
    return { ...row, pos: Number(row.pos), createTime: Number(row.createTime), updateTime: Number(row.updateTime) }
  }

  private async normalizePositions(
    tx: Prisma.TransactionClient,
    organizationId: string,
    module: string,
    userId: string,
  ) {
    const rows = await tx.sysDict.findMany({
      where: { organizationId, module },
      orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
    })
    const now = BigInt(Date.now())
    for (const [index, row] of rows.entries()) {
      await tx.sysDict.update({
        where: { id: row.id },
        data: { pos: BigInt(index + 1), updateTime: now, updateUser: userId },
      })
    }
  }

  private async listAfterTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    module: DictionaryModule,
  ) {
    const rows = await tx.sysDict.findMany({
      where: { organizationId, module },
      orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
    })
    return rows.map((row) => this.toVO(row))
  }
}
