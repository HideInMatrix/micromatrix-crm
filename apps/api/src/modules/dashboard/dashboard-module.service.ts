import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { DashboardAccessService } from './dashboard-access.service'
import {
  DashboardModuleAddDto,
  DashboardModuleMoveDto,
  DashboardModuleRenameDto,
} from './dto/dashboard.dto'

const POS_STEP = 1024n

interface DashboardTreeNode {
  id: string
  name: string
  parentId: string
  type: 'MODULE' | 'DASHBOARD'
  pos: number
  resourceUrl?: string
  myCollect?: boolean
  children?: DashboardTreeNode[]
}

@Injectable()
export class DashboardModuleService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly access: DashboardAccessService,
  ) {}

  private async assertModule(user: AuthUser, id: string) {
    const row = await this.prisma8.client.orm.public.DashboardModule.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!row) throw new NotFoundException('仪表板文件夹不存在')
    return row
  }

  private async assertParent(user: AuthUser, parentId: string) {
    if (parentId === 'NONE') return
    await this.assertModule(user, parentId)
  }

  private async assertNameUnique(user: AuthUser, parentId: string, name: string, excludeId?: string) {
    const duplicate = await this.prisma8.client.orm.public.DashboardModule.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      parentId: prisma8Varchar(parentId, 32),
      name: prisma8Varchar(name.trim(), 255),
    })
      .select('id')
      .first()
    if (duplicate && duplicate.id !== excludeId) {
      throw new ConflictException('同一级下已存在同名仪表板文件夹')
    }
  }

  private async nextPos(user: AuthUser, parentId: string) {
    const rows = await this.prisma8.client.orm.public.DashboardModule.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      parentId: prisma8Varchar(parentId, 32),
    })
      .select('pos')
      .all()
    return rows.reduce((max, row) => (row.pos > max ? row.pos : max), 0n) + POS_STEP
  }

  private mapModule(row: {
    id: string
    organizationId: string
    name: string
    parentId: string
    pos: bigint
    createTime: bigint
    updateTime: bigint
    createUser: string
    updateUser: string
  }) {
    return {
      ...row,
      pos: Number(row.pos),
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
    }
  }

  async add(user: AuthUser, dto: DashboardModuleAddDto) {
    await this.assertParent(user, dto.parentId)
    await this.assertNameUnique(user, dto.parentId, dto.name)
    const now = BigInt(Date.now())
    const row = await this.prisma8.client.orm.public.DashboardModule.create({
      id: prisma8Id32(),
      organizationId: prisma8Varchar(user.tenantId, 32),
      name: prisma8Varchar(dto.name.trim(), 255),
      parentId: prisma8Varchar(dto.parentId, 32),
      pos: await this.nextPos(user, dto.parentId),
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(user.id, 32),
      updateUser: prisma8Varchar(user.id, 32),
    })
    return this.mapModule(row)
  }

  async rename(user: AuthUser, dto: DashboardModuleRenameDto) {
    const original = await this.assertModule(user, dto.id)
    await this.assertNameUnique(user, original.parentId, dto.name, dto.id)
    const row = await this.prisma8.client.orm.public.DashboardModule.where({
      id: prisma8Varchar(dto.id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      name: prisma8Varchar(dto.name.trim(), 255),
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
    if (!row) throw new NotFoundException('仪表板文件夹不存在')
    return this.mapModule(row)
  }

  async remove(user: AuthUser, rawIds: string[]) {
    const ids = [...new Set(rawIds)]
    const varcharIds = prisma8Varchars(ids, 32)
    const rows = await this.prisma8.client.orm.public.DashboardModule.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .where((row) => row.id.in(varcharIds))
      .all()
    if (rows.length !== ids.length) throw new NotFoundException('存在无效仪表板文件夹')
    const [dashboards, children] = await Promise.all([
      this.prisma8.client.orm.public.Dashboard.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      })
        .where((row) => row.dashboardModuleId.in(varcharIds))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.DashboardModule.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      })
        .where((row) => row.parentId.in(varcharIds))
        .select('id', 'parentId')
        .all(),
    ])
    if (dashboards.length > 0) throw new BadRequestException('文件夹下存在仪表板，不能删除')
    const selected = new Set(ids)
    if (children.some((child) => !selected.has(child.id))) {
      throw new BadRequestException('文件夹下存在子文件夹，不能删除')
    }
    await this.prisma8.client.orm.public.DashboardModule.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .where((row) => row.id.in(varcharIds))
      .deleteAll()
    return { id: ids[0], name: rows[0]?.name ?? '', deleted: ids.length }
  }

  private buildTree(nodes: DashboardTreeNode[]) {
    const map = new Map<string, DashboardTreeNode>()
    nodes.forEach((node) => map.set(node.id, { ...node, children: [] }))
    const roots: DashboardTreeNode[] = []
    for (const node of map.values()) {
      const parent = map.get(node.parentId)
      if (parent?.type === 'MODULE') parent.children!.push(node)
      else roots.push(node)
    }
    const sortRecursively = (list: DashboardTreeNode[]) => {
      list.sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name, 'zh-CN'))
      list.forEach((node) => {
        if (node.children?.length) sortRecursively(node.children)
        else delete node.children
      })
    }
    sortRecursively(roots)
    return roots
  }

  async tree(user: AuthUser) {
    const [modules, dashboards] = await Promise.all([
      this.prisma8.client.orm.public.DashboardModule.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).all(),
      this.prisma8.client.orm.public.Dashboard.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).all(),
    ])
    const visibleIds = await this.access.visibleDashboardIds(user, dashboards)
    const visibleDashboardIds = [...visibleIds]
    const collections = visibleDashboardIds.length
      ? await this.prisma8.client.orm.public.DashboardCollection.where({
          userId: prisma8Varchar(user.id, 32),
        })
          .where((row) => row.dashboardId.in(prisma8Varchars(visibleDashboardIds, 32)))
          .select('dashboardId')
          .all()
      : []
    const collectedIds = new Set(collections.map((item) => item.dashboardId))
    const nodes: DashboardTreeNode[] = [
      ...modules.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        type: 'MODULE' as const,
        pos: Number(row.pos),
      })),
      ...dashboards
        .filter((row) => visibleIds.has(row.id))
        .map((row) => ({
          id: row.id,
          name: row.name,
          parentId: row.dashboardModuleId,
          type: 'DASHBOARD' as const,
          pos: Number(row.pos),
          resourceUrl: row.resourceUrl,
          myCollect: collectedIds.has(row.id),
        })),
    ]
    return this.buildTree(nodes)
  }

  async count(user: AuthUser) {
    const [modules, dashboards] = await Promise.all([
      this.prisma8.client.orm.public.DashboardModule.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      })
        .select('id', 'parentId')
        .all(),
      this.prisma8.client.orm.public.Dashboard.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).all(),
    ])
    const visibleIds = await this.access.visibleDashboardIds(user, dashboards)
    const visibleDashboardIds = [...visibleIds]
    const myCollect = visibleDashboardIds.length
      ? (
          await this.prisma8.client.orm.public.DashboardCollection.where({
            userId: prisma8Varchar(user.id, 32),
          })
            .where((row) => row.dashboardId.in(prisma8Varchars(visibleDashboardIds, 32)))
            .select('id')
            .all()
        ).length
      : 0
    const direct = new Map<string, number>()
    dashboards.filter((row) => visibleIds.has(row.id)).forEach((row) => {
      direct.set(row.dashboardModuleId, (direct.get(row.dashboardModuleId) ?? 0) + 1)
    })
    const children = new Map<string, string[]>()
    modules.forEach((row) => {
      const list = children.get(row.parentId) ?? []
      list.push(row.id)
      children.set(row.parentId, list)
    })
    const result: Record<string, number> = { myCollect }
    const countOne = (id: string, visiting = new Set<string>()): number => {
      if (visiting.has(id)) return 0
      const next = new Set(visiting).add(id)
      const total = (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, child) => sum + countOne(child, next), 0)
      result[id] = total
      return total
    }
    modules.forEach((row) => countOne(row.id))
    return result
  }

  private async assertNoCycle(user: AuthUser, dragId: string, newParentId: string) {
    if (newParentId === 'NONE') return
    if (newParentId === dragId) throw new BadRequestException('文件夹不能移动到自身')
    const modules = await this.prisma8.client.orm.public.DashboardModule.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .select('id', 'parentId')
      .all()
    const parentMap = new Map<string, string>(modules.map((row) => [row.id, row.parentId]))
    const visited = new Set<string>()
    let current: string | undefined = newParentId
    while (current && current !== 'NONE' && !visited.has(current)) {
      if (current === dragId) throw new BadRequestException('文件夹不能移动到自身后代')
      visited.add(current)
      current = parentMap.get(current)
    }
  }

  async move(user: AuthUser, dto: DashboardModuleMoveDto) {
    if (dto.dragNodeId === dto.dropNodeId) throw new BadRequestException('拖拽节点和目标节点不能相同')
    const [drag, drop] = await Promise.all([
      this.assertModule(user, dto.dragNodeId),
      this.assertModule(user, dto.dropNodeId),
    ])
    const newParentId = dto.dropPosition === 0 ? drop.id : drop.parentId
    await this.assertNoCycle(user, drag.id, newParentId)
    if (drag.parentId !== newParentId) await this.assertNameUnique(user, newParentId, drag.name, drag.id)

    await this.prisma8.client.transaction(async (tx) => {
      const sourceRows = await tx.orm.public.DashboardModule.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
        parentId: drag.parentId,
      })
        .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
        .select('id')
        .all()
      const destinationRows =
        drag.parentId === newParentId
          ? sourceRows
          : await tx.orm.public.DashboardModule.where({
              organizationId: prisma8Varchar(user.tenantId, 32),
              parentId: prisma8Varchar(newParentId, 32),
            })
              .orderBy([(row) => row.pos.asc(), (row) => row.createTime.asc()])
              .select('id')
              .all()
      const sourceIds = sourceRows.map((row) => row.id).filter((id) => id !== drag.id)
      const destinationIds = destinationRows.map((row) => row.id).filter((id) => id !== drag.id)
      let insertIndex = destinationIds.length
      if (dto.dropPosition !== 0) {
        const dropIndex = destinationIds.indexOf(drop.id)
        if (dropIndex < 0) throw new BadRequestException('目标文件夹不在目标层级')
        insertIndex = dto.dropPosition === -1 ? dropIndex : dropIndex + 1
      }
      destinationIds.splice(insertIndex, 0, drag.id)

      const moved = await tx.orm.public.DashboardModule.where({
        id: drag.id,
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).update({
        parentId: prisma8Varchar(newParentId, 32),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
      if (!moved) throw new NotFoundException('仪表板文件夹不存在')
      const reindex = async (orderedIds: readonly string[]) => {
        for (let index = 0; index < orderedIds.length; index++) {
          await tx.orm.public.DashboardModule.where({
            id: prisma8Varchar(orderedIds[index]!, 32),
            organizationId: prisma8Varchar(user.tenantId, 32),
          }).update({ pos: BigInt(index + 1) * POS_STEP })
        }
      }
      if (drag.parentId !== newParentId) await reindex(sourceIds)
      await reindex(destinationIds)
    })
    return { id: drag.id, name: drag.name }
  }
}
