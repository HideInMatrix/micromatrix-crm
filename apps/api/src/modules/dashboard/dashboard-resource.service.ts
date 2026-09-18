import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { DashboardAccessService } from './dashboard-access.service'
import {
  DashboardAddDto,
  DashboardEditPosDto,
  DashboardPageDto,
  DashboardRenameDto,
  DashboardUpdateDto,
} from './dto/dashboard.dto'

const POS_STEP = 1024n

type DashboardWithModule = {
  id: string
  name: string
  resourceUrl: string
  dashboardModuleId: string
  organizationId: string
  pos: bigint
  scopeId: string
  description: string | null
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
  module: { id: string; name: string }
  collections?: Array<{ id: string }>
}

type DashboardRow = Omit<DashboardWithModule, 'module' | 'collections'>

@Injectable()
export class DashboardResourceService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly access: DashboardAccessService,
  ) {}

  private async assertModule(user: AuthUser, id: string) {
    const module = await this.prisma8.client.orm.public.DashboardModule.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!module) throw new NotFoundException('仪表板文件夹不存在')
    return module
  }

  private async assertNameUnique(user: AuthUser, moduleId: string, name: string, excludeId?: string) {
    const duplicate = await this.prisma8.client.orm.public.Dashboard.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      dashboardModuleId: prisma8Varchar(moduleId, 32),
      name: prisma8Varchar(name.trim(), 255),
    })
      .select('id')
      .first()
    if (duplicate && duplicate.id !== excludeId) {
      throw new ConflictException('同一文件夹下已存在同名仪表板')
    }
  }

  private async nextPos(moduleId: string) {
    const rows = await this.prisma8.client.orm.public.Dashboard.where({
      dashboardModuleId: prisma8Varchar(moduleId, 32),
    })
      .select('pos')
      .all()
    return rows.reduce((max, row) => (row.pos > max ? row.pos : max), 0n) + POS_STEP
  }

  private normalizeUrl(value: string) {
    let url: URL
    try {
      url = new URL(value.trim())
    } catch {
      throw new BadRequestException('仪表板 URL 格式无效')
    }
    if (url.username || url.password) {
      throw new BadRequestException('仪表板 URL 禁止携带用户名或密码')
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const localHttp =
      process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1')
    if (url.protocol !== 'https:' && !localHttp) {
      throw new BadRequestException('仪表板 URL 仅允许 HTTPS；开发环境仅允许 localhost HTTP')
    }
    return url.toString()
  }

  private async creatorNames(ids: string[]) {
    const users = ids.length
      ? await this.prisma8.client.orm.public.Users.where((row) => row.id.in([...new Set(ids)]))
          .select('id', 'name')
          .all()
      : []
    return new Map(users.map((item) => [item.id, item.name]))
  }

  private async attachRelations(user: AuthUser, rows: DashboardRow[]): Promise<DashboardWithModule[]> {
    if (rows.length === 0) return []
    const moduleIds = [...new Set(rows.map((row) => row.dashboardModuleId))]
    const dashboardIds = rows.map((row) => row.id)
    const [modules, collections] = await Promise.all([
      this.prisma8.client.orm.public.DashboardModule.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      })
        .where((row) => row.id.in(prisma8Varchars(moduleIds, 32)))
        .select('id', 'name')
        .all(),
      this.prisma8.client.orm.public.DashboardCollection.where({
        userId: prisma8Varchar(user.id, 32),
      })
        .where((row) => row.dashboardId.in(prisma8Varchars(dashboardIds, 32)))
        .select('id', 'dashboardId')
        .all(),
    ])
    const moduleMap = new Map<string, { id: string; name: string }>(
      modules.map((item) => [item.id, item]),
    )
    const collectionMap = new Map<string, Array<{ id: string }>>()
    for (const item of collections) {
      const list = collectionMap.get(item.dashboardId) ?? []
      list.push({ id: item.id })
      collectionMap.set(item.dashboardId, list)
    }
    return rows.map((row) => {
      const module = moduleMap.get(row.dashboardModuleId)
      if (!module) throw new NotFoundException('仪表板文件夹不存在')
      return { ...row, module, collections: collectionMap.get(row.id) ?? [] }
    })
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
    const module = await this.assertModule(user, dto.dashboardModuleId)
    await this.assertNameUnique(user, dto.dashboardModuleId, dto.name)
    const scopeIds = await this.access.validateScopeIds(user, dto.scopeIds)
    const now = BigInt(Date.now())
    const row = await this.prisma8.client.orm.public.Dashboard.create({
      id: prisma8Id32(),
      name: prisma8Varchar(dto.name.trim(), 255),
      resourceUrl: prisma8Varchar(this.normalizeUrl(dto.resourceUrl), 500),
      dashboardModuleId: prisma8Varchar(dto.dashboardModuleId, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
      pos: await this.nextPos(dto.dashboardModuleId),
      scopeId: JSON.stringify(scopeIds),
      description: dto.description?.trim() ? prisma8Varchar(dto.description.trim(), 1000) : null,
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(user.id, 32),
      updateUser: prisma8Varchar(user.id, 32),
    })
    return this.toResponse(user, { ...row, module })
  }

  async detail(user: AuthUser, id: string) {
    const visible = await this.access.assertVisibleDashboard(user, id)
    const collections = await this.prisma8.client.orm.public.DashboardCollection.where({
      userId: prisma8Varchar(user.id, 32),
      dashboardId: visible.id,
    })
      .select('id')
      .all()
    return this.toResponse(user, { ...visible, collections })
  }

  async update(user: AuthUser, dto: DashboardUpdateDto) {
    const original = await this.access.assertVisibleDashboard(user, dto.id)
    const module = await this.assertModule(user, dto.dashboardModuleId)
    await this.assertNameUnique(user, dto.dashboardModuleId, dto.name, dto.id)
    const scopeIds = await this.access.validateScopeIds(user, dto.scopeIds)
    const moduleChanged = original.dashboardModuleId !== dto.dashboardModuleId
    const row = await this.prisma8.client.orm.public.Dashboard.where({
      id: prisma8Varchar(dto.id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      name: prisma8Varchar(dto.name.trim(), 255),
      resourceUrl: prisma8Varchar(this.normalizeUrl(dto.resourceUrl), 500),
      dashboardModuleId: prisma8Varchar(dto.dashboardModuleId, 32),
      ...(moduleChanged ? { pos: await this.nextPos(dto.dashboardModuleId) } : {}),
      scopeId: JSON.stringify(scopeIds),
      description: dto.description?.trim() ? prisma8Varchar(dto.description.trim(), 1000) : null,
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
    if (!row) throw new NotFoundException('仪表板不存在')
    return this.toResponse(user, { ...row, module })
  }

  async rename(user: AuthUser, dto: DashboardRenameDto) {
    const original = await this.access.assertVisibleDashboard(user, dto.id)
    const module = await this.assertModule(user, dto.dashboardModuleId)
    await this.assertNameUnique(user, dto.dashboardModuleId, dto.name, dto.id)
    const moduleChanged = original.dashboardModuleId !== dto.dashboardModuleId
    const row = await this.prisma8.client.orm.public.Dashboard.where({
      id: prisma8Varchar(dto.id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      name: prisma8Varchar(dto.name.trim(), 255),
      dashboardModuleId: prisma8Varchar(dto.dashboardModuleId, 32),
      ...(moduleChanged ? { pos: await this.nextPos(dto.dashboardModuleId) } : {}),
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
    if (!row) throw new NotFoundException('仪表板不存在')
    return this.toResponse(user, { ...row, module })
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.access.assertVisibleDashboard(user, id)
    await this.prisma8.client.orm.public.Dashboard.where({
      id: row.id,
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).delete()
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
    const query = this.prisma8.client.orm.public.Dashboard.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    const rawRows = dto.dashboardModuleIds?.length
      ? await query
          .where((row) => row.dashboardModuleId.in(prisma8Varchars(dto.dashboardModuleIds!, 32)))
          .all()
      : await query.all()
    const keywordRows = keyword
      ? rawRows.filter((row) => row.name.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
      : rawRows
    const rows = await this.attachRelations(user, keywordRows)
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

  async collect(user: AuthUser, id: string) {
    const dashboard = await this.access.assertVisibleDashboard(user, id)
    const exists = await this.prisma8.client.orm.public.DashboardCollection.where({
      userId: prisma8Varchar(user.id, 32),
      dashboardId: dashboard.id,
    }).first()
    if (exists) throw new ConflictException('仪表板已收藏')
    const now = BigInt(Date.now())
    try {
      await this.prisma8.client.orm.public.DashboardCollection.create({
        id: prisma8Id32(),
        userId: prisma8Varchar(user.id, 32),
        dashboardId: dashboard.id,
        createTime: now,
        updateTime: now,
        createUser: prisma8Varchar(user.id, 32),
        updateUser: prisma8Varchar(user.id, 32),
      })
    } catch (error) {
      if ((error as { sqlState?: string }).sqlState === '23505') {
        throw new ConflictException('仪表板已收藏')
      }
      throw error
    }
    return { id: dashboard.id, name: dashboard.name, collected: true }
  }

  async unCollect(user: AuthUser, id: string) {
    const dashboard = await this.access.assertVisibleDashboard(user, id)
    await this.prisma8.client.orm.public.DashboardCollection.where({
      userId: prisma8Varchar(user.id, 32),
      dashboardId: dashboard.id,
    }).deleteAll()
    return { id: dashboard.id, name: dashboard.name, collected: false }
  }

  async collectPage(user: AuthUser, dto: DashboardPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const keyword = dto.keyword?.trim()
    const collections = await this.prisma8.client.orm.public.DashboardCollection.where({
      userId: prisma8Varchar(user.id, 32),
    })
      .select('id', 'dashboardId')
      .all()
    const collectionDashboardIds = collections.map((item) => item.dashboardId)
    const dashboardQuery = this.prisma8.client.orm.public.Dashboard.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    const scopedRows = collectionDashboardIds.length
      ? await dashboardQuery
          .where((row) => row.id.in(prisma8Varchars(collectionDashboardIds, 32)))
          .all()
      : []
    const moduleRows = dto.dashboardModuleIds?.length
      ? scopedRows.filter((row) => dto.dashboardModuleIds!.includes(row.dashboardModuleId))
      : scopedRows
    const keywordRows = keyword
      ? moduleRows.filter((row) => row.name.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
      : moduleRows
    const rows = await this.attachRelations(user, keywordRows)
    const visibleIds = await this.access.visibleDashboardIds(user, rows)
    const visible = rows.filter((row) => visibleIds.has(row.id))
    const userNames = await this.creatorNames(
      visible.flatMap((row) => [row.createUser, row.updateUser]),
    )
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

  async embedPolicy(user: AuthUser, id: string) {
    const dashboard = await this.access.assertVisibleDashboard(user, id)
    const resourceUrl = this.normalizeUrl(dashboard.resourceUrl)
    const origin = new URL(resourceUrl).origin
    return {
      dashboardId: dashboard.id,
      resourceUrl,
      origin,
      postMessageOrigin: origin,
      frameSrc: [origin],
      csp: `frame-src 'self' ${origin};`,
      sandbox: 'allow-scripts allow-forms allow-popups allow-downloads',
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

    await this.prisma8.client.transaction(async (tx) => {
      const sourceRows = await tx.orm.public.Dashboard.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
        dashboardModuleId: moved.dashboardModuleId,
      })
        .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
        .select('id')
        .all()
      const targetRows =
        moved.dashboardModuleId === dto.dashboardModuleId
          ? sourceRows
          : await tx.orm.public.Dashboard.where({
              organizationId: prisma8Varchar(user.tenantId, 32),
              dashboardModuleId: prisma8Varchar(dto.dashboardModuleId, 32),
            })
              .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
              .select('id')
              .all()

      const sourceIds: string[] = sourceRows.map((row) => row.id).filter((id) => id !== moved.id)
      const destinationIds: string[] = targetRows.map((row) => row.id).filter((id) => id !== moved.id)
      let insertIndex = destinationIds.length
      if (dto.moveMode !== 'APPEND') {
        const targetIndex = destinationIds.indexOf(dto.targetId)
        if (targetIndex < 0) throw new BadRequestException('目标仪表板不存在于目标文件夹')
        insertIndex = dto.moveMode === 'BEFORE' ? targetIndex : targetIndex + 1
      }
      destinationIds.splice(insertIndex, 0, moved.id)

      const updated = await tx.orm.public.Dashboard.where({
        id: moved.id,
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).update({
        dashboardModuleId: prisma8Varchar(dto.dashboardModuleId, 32),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
      if (!updated) throw new NotFoundException('仪表板不存在')
      const reindex = async (orderedIds: readonly string[]) => {
        for (let index = 0; index < orderedIds.length; index++) {
          await tx.orm.public.Dashboard.where({
            id: prisma8Varchar(orderedIds[index]!, 32),
            organizationId: prisma8Varchar(user.tenantId, 32),
          }).update({ pos: BigInt(index + 1) * POS_STEP })
        }
      }
      if (moved.dashboardModuleId !== dto.dashboardModuleId) await reindex(sourceIds)
      await reindex(destinationIds)
    })

    return { id: moved.id, name: moved.name }
  }
}
