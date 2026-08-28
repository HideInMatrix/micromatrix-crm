import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { Dashboard, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { DashboardAccessService } from './dashboard-access.service'
import {
  DashboardAddDto,
  DashboardEditPosDto,
  DashboardPageDto,
  DashboardRenameDto,
  DashboardUpdateDto,
} from './dto/dashboard.dto'

const POS_STEP = 1024n

type DashboardWithModule = Dashboard & {
  module: { id: string; name: string }
  collections?: Array<{ id: string }>
}

@Injectable()
export class DashboardResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DashboardAccessService,
  ) {}

  private async assertModule(user: AuthUser, id: string) {
    const module = await this.prisma.dashboardModule.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!module) throw new NotFoundException('仪表板文件夹不存在')
    return module
  }

  private async assertNameUnique(user: AuthUser, moduleId: string, name: string, excludeId?: string) {
    const count = await this.prisma.dashboard.count({
      where: {
        organizationId: user.tenantId,
        dashboardModuleId: moduleId,
        name: name.trim(),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    })
    if (count > 0) throw new ConflictException('同一文件夹下已存在同名仪表板')
  }

  private async nextPos(moduleId: string) {
    const max = await this.prisma.dashboard.aggregate({
      where: { dashboardModuleId: moduleId },
      _max: { pos: true },
    })
    return (max._max.pos ?? 0n) + POS_STEP
  }

  private normalizeUrl(value: string) {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('仪表板 URL 仅允许 HTTP/HTTPS')
    }
    return url.toString()
  }

  private async creatorNames(ids: string[]) {
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })
      : []
    return new Map(users.map((item) => [item.id, item.name]))
  }

  private async toResponse(user: AuthUser, row: DashboardWithModule, userNames?: Map<string, string>) {
    const scopeIds = this.access.parseScope(row.scopeId)
    const names = userNames ?? (await this.creatorNames([row.createUser, row.updateUser]))
    return {
      id: row.id,
      name: row.name,
      resourceUrl: row.resourceUrl,
      dashboardModuleId: row.dashboardModuleId,
      dashboardModuleName: row.module.name,
      organizationId: row.organizationId,
      pos: Number(row.pos),
      scopeId: row.scopeId,
      scopeIds,
      members: await this.access.resolveScopeMembers(user, scopeIds),
      description: row.description,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      createUser: row.createUser,
      updateUser: row.updateUser,
      createUserName: names.get(row.createUser) ?? '',
      updateUserName: names.get(row.updateUser) ?? '',
      myCollect: Boolean(row.collections?.length),
    }
  }

  async add(user: AuthUser, dto: DashboardAddDto) {
    await this.assertModule(user, dto.dashboardModuleId)
    await this.assertNameUnique(user, dto.dashboardModuleId, dto.name)
    const scopeIds = await this.access.validateScopeIds(user, dto.scopeIds)
    const now = BigInt(Date.now())
    const row = await this.prisma.dashboard.create({
      data: {
        name: dto.name.trim(),
        resourceUrl: this.normalizeUrl(dto.resourceUrl),
        dashboardModuleId: dto.dashboardModuleId,
        organizationId: user.tenantId,
        pos: await this.nextPos(dto.dashboardModuleId),
        scopeId: JSON.stringify(scopeIds),
        description: dto.description?.trim() || null,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      },
      include: { module: true },
    })
    return this.toResponse(user, row)
  }

  async detail(user: AuthUser, id: string) {
    const visible = await this.access.assertVisibleDashboard(user, id)
    const row = await this.prisma.dashboard.findUnique({
      where: { id: visible.id },
      include: { module: true, collections: { where: { userId: user.id }, select: { id: true } } },
    })
    if (!row) throw new NotFoundException('仪表板不存在')
    return this.toResponse(user, row)
  }

  async update(user: AuthUser, dto: DashboardUpdateDto) {
    const original = await this.access.assertVisibleDashboard(user, dto.id)
    await this.assertModule(user, dto.dashboardModuleId)
    await this.assertNameUnique(user, dto.dashboardModuleId, dto.name, dto.id)
    const scopeIds = await this.access.validateScopeIds(user, dto.scopeIds)
    const moduleChanged = original.dashboardModuleId !== dto.dashboardModuleId
    const row = await this.prisma.dashboard.update({
      where: { id: dto.id },
      data: {
        name: dto.name.trim(),
        resourceUrl: this.normalizeUrl(dto.resourceUrl),
        dashboardModuleId: dto.dashboardModuleId,
        ...(moduleChanged ? { pos: await this.nextPos(dto.dashboardModuleId) } : {}),
        scopeId: JSON.stringify(scopeIds),
        description: dto.description?.trim() || null,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
      include: { module: true },
    })
    return this.toResponse(user, row)
  }

  async rename(user: AuthUser, dto: DashboardRenameDto) {
    const original = await this.access.assertVisibleDashboard(user, dto.id)
    await this.assertModule(user, dto.dashboardModuleId)
    await this.assertNameUnique(user, dto.dashboardModuleId, dto.name, dto.id)
    const moduleChanged = original.dashboardModuleId !== dto.dashboardModuleId
    const row = await this.prisma.dashboard.update({
      where: { id: dto.id },
      data: {
        name: dto.name.trim(),
        dashboardModuleId: dto.dashboardModuleId,
        ...(moduleChanged ? { pos: await this.nextPos(dto.dashboardModuleId) } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
      include: { module: true },
    })
    return this.toResponse(user, row)
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.access.assertVisibleDashboard(user, id)
    await this.prisma.dashboard.delete({ where: { id: row.id } })
    return { id: row.id, name: row.name }
  }

  private sortRows<T extends { name: string; createTime: bigint; pos: bigint; module: { name: string }; createUser: string }>(
    rows: T[],
    dto: DashboardPageDto,
    userNames: Map<string, string>,
  ) {
    const direction = dto.sort?.type?.toLowerCase() === 'asc' ? 1 : -1
    const field = dto.sort?.name ?? 'create_time'
    return [...rows].sort((a, b) => {
      let left: string | bigint = a.createTime
      let right: string | bigint = b.createTime
      if (field === 'name') {
        left = a.name
        right = b.name
      } else if (field === 'dashboard_module_name') {
        left = a.module.name
        right = b.module.name
      } else if (field === 'create_user_name') {
        left = userNames.get(a.createUser) ?? ''
        right = userNames.get(b.createUser) ?? ''
      } else if (field === 'pos') {
        left = a.pos
        right = b.pos
      }
      if (typeof left === 'bigint' && typeof right === 'bigint') return left === right ? 0 : left > right ? direction : -direction
      return String(left).localeCompare(String(right), 'zh-CN') * direction
    })
  }

  async page(user: AuthUser, dto: DashboardPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const keyword = dto.keyword?.trim()
    const rows = await this.prisma.dashboard.findMany({
      where: {
        organizationId: user.tenantId,
        ...(keyword ? { name: { contains: keyword, mode: 'insensitive' } } : {}),
        ...(dto.dashboardModuleIds?.length ? { dashboardModuleId: { in: dto.dashboardModuleIds } } : {}),
      },
      include: {
        module: true,
        collections: { where: { userId: user.id }, select: { id: true } },
      },
    })
    const visibleIds = await this.access.visibleDashboardIds(user, rows)
    const visible = rows.filter((row) => visibleIds.has(row.id))
    const userNames = await this.creatorNames(visible.flatMap((row) => [row.createUser, row.updateUser]))
    const sorted = this.sortRows(visible, dto, userNames)
    const total = sorted.length
    const pageRows = sorted.slice((current - 1) * pageSize, current * pageSize)
    return {
      list: await Promise.all(pageRows.map((row) => this.toResponse(user, row, userNames))),
      total,
      current,
      pageSize,
    }
  }

  private async reindex(tx: Prisma.TransactionClient, moduleId: string, orderedIds: string[]) {
    for (let index = 0; index < orderedIds.length; index++) {
      await tx.dashboard.update({
        where: { id: orderedIds[index]! },
        data: { pos: BigInt(index + 1) * POS_STEP },
      })
    }
  }

  async move(user: AuthUser, dto: DashboardEditPosDto) {
    const moved = await this.access.assertVisibleDashboard(user, dto.moveId)
    await this.assertModule(user, dto.dashboardModuleId)
    if (moved.dashboardModuleId !== dto.dashboardModuleId) {
      await this.assertNameUnique(user, dto.dashboardModuleId, moved.name, moved.id)
    }
    if (dto.moveMode !== 'APPEND' && dto.targetId === dto.moveId) return { id: moved.id, name: moved.name }

    if (dto.moveMode !== 'APPEND') {
      const target = await this.access.assertVisibleDashboard(user, dto.targetId)
      if (target.dashboardModuleId !== dto.dashboardModuleId) {
        throw new BadRequestException('目标仪表板不属于目标文件夹')
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const sourceRows = await tx.dashboard.findMany({
        where: { organizationId: user.tenantId, dashboardModuleId: moved.dashboardModuleId },
        orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
        select: { id: true },
      })
      const targetRows =
        moved.dashboardModuleId === dto.dashboardModuleId
          ? sourceRows
          : await tx.dashboard.findMany({
              where: { organizationId: user.tenantId, dashboardModuleId: dto.dashboardModuleId },
              orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
              select: { id: true },
            })

      const sourceIds = sourceRows.map((row) => row.id).filter((id) => id !== moved.id)
      const destinationIds = targetRows.map((row) => row.id).filter((id) => id !== moved.id)
      let insertIndex = destinationIds.length
      if (dto.moveMode !== 'APPEND') {
        const targetIndex = destinationIds.indexOf(dto.targetId)
        if (targetIndex < 0) throw new BadRequestException('目标仪表板不存在于目标文件夹')
        insertIndex = dto.moveMode === 'BEFORE' ? targetIndex : targetIndex + 1
      }
      destinationIds.splice(insertIndex, 0, moved.id)

      await tx.dashboard.update({
        where: { id: moved.id },
        data: {
          dashboardModuleId: dto.dashboardModuleId,
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (moved.dashboardModuleId !== dto.dashboardModuleId) await this.reindex(tx, moved.dashboardModuleId, sourceIds)
      await this.reindex(tx, dto.dashboardModuleId, destinationIds)
    })

    return { id: moved.id, name: moved.name }
  }
}
