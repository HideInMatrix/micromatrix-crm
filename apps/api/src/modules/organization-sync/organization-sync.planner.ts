import { Injectable } from '@nestjs/common'
import type { OrganizationSyncCounts } from '@micromatrix/shared'
import type {
  WeComDepartmentSnapshot,
  WeComOrganizationSnapshot,
  WeComUserSnapshot,
} from '../enterprise-integrations/wecom.client'

export interface PlannerDepartment {
  id: string
  name: string
  parentId: string | null
  sort: number
}

export interface PlannerUser {
  id: string
  email: string | null
  name: string
  status: 'ACTIVE' | 'DISABLED'
  deptId: string | null
  position: string | null
  phone: string | null
}

export interface PlannerDepartmentMapping {
  externalId: string
  externalKey: string
  departmentId: string
  active: boolean
}

export interface PlannerUserMapping {
  externalId: string
  externalKey: string
  userId: string
  active: boolean
}

export interface OrganizationSyncPlanItem {
  resourceType: 'DEPARTMENT' | 'USER'
  externalId: string
  externalKey: string
  action: 'CREATE' | 'UPDATE' | 'DISABLE' | 'UNCHANGED' | 'CONFLICT' | 'SKIP'
  localId: string | null
  parentExternalKey: string | null
  sourceData: Record<string, unknown>
  changes: Record<string, { before: unknown; after: unknown }> | null
  conflictType: string | null
  conflictMessage: string | null
  sort: number
}

export interface OrganizationSyncPlan {
  items: OrganizationSyncPlanItem[]
  counts: OrganizationSyncCounts
}

export interface OrganizationSyncPlannerInput {
  tenantId: string
  targetDepartmentId: string
  snapshot: WeComOrganizationSnapshot
  departments: PlannerDepartment[]
  users: PlannerUser[]
  departmentMappings: PlannerDepartmentMapping[]
  userMappings: PlannerUserMapping[]
}

@Injectable()
export class OrganizationSyncPlanner {
  plan(input: OrganizationSyncPlannerInput): OrganizationSyncPlan {
    const departmentItems = this.planDepartments(input)
    const userItems = this.planUsers(input, departmentItems)
    const items = [...departmentItems, ...userItems]
    return { items, counts: this.count(items) }
  }

  private planDepartments(input: OrganizationSyncPlannerInput): OrganizationSyncPlanItem[] {
    const localById = new Map(input.departments.map((department) => [department.id, department]))
    const mappingByKey = new Map(
      input.departmentMappings.map((mapping) => [mapping.externalKey, mapping]),
    )
    const root = input.departments.filter((department) => department.parentId === null)
    if (root.length !== 1) throw new Error('当前企业必须且只能有一个组织根部门')
    const target = localById.get(input.targetDepartmentId)
    if (!target) throw new Error('同步目标部门不存在')

    const ordered = this.sortDepartments(input.snapshot.departments)
    const resolvedLocalIds = new Map<string, string>()
    const items: OrganizationSyncPlanItem[] = []

    for (const source of ordered) {
      const mapping = mappingByKey.get(source.externalKey)
      const mappedLocal = mapping ? localById.get(mapping.departmentId) : undefined
      const parentLocalId = source.isRoot
        ? target.id
        : (resolvedLocalIds.get(source.parentExternalKey) ?? null)
      let local = mappedLocal
      let conflictType: string | null = null
      let conflictMessage: string | null = null

      if (!local && !mapping && parentLocalId) {
        const duplicate = input.departments.find(
          (department) =>
            department.parentId === parentLocalId &&
            department.name.localeCompare(source.name, undefined, { sensitivity: 'accent' }) === 0,
        )
        if (duplicate) {
          local = duplicate
          conflictType = 'DEPARTMENT_NAME'
          conflictMessage = `同一上级部门下已存在“${source.name}”，请选择绑定或跳过`
        }
      }

      if (local) resolvedLocalIds.set(source.externalKey, local.id)
      const changes = local ? this.departmentChanges(local, source, parentLocalId) : null
      const action = conflictType
        ? 'CONFLICT'
        : !local
          ? 'CREATE'
          : changes
            ? 'UPDATE'
            : 'UNCHANGED'
      items.push({
        resourceType: 'DEPARTMENT',
        externalId: source.id,
        externalKey: source.externalKey,
        action,
        localId: local?.id ?? null,
        parentExternalKey: source.isRoot ? null : source.parentExternalKey,
        sourceData: { ...source },
        changes,
        conflictType,
        conflictMessage,
        sort: items.length,
      })
    }

    const sourceKeys = new Set(input.snapshot.departments.map(({ externalKey }) => externalKey))
    for (const mapping of input.departmentMappings) {
      if (!mapping.active || sourceKeys.has(mapping.externalKey)) continue
      const local = localById.get(mapping.departmentId)
      if (!local) continue
      items.push({
        resourceType: 'DEPARTMENT',
        externalId: mapping.externalId,
        externalKey: mapping.externalKey,
        action: 'DISABLE',
        localId: local.id,
        parentExternalKey: null,
        sourceData: { id: mapping.externalId, name: local.name, missing: true },
        changes: { mappingActive: { before: true, after: false } },
        conflictType: null,
        conflictMessage: null,
        sort: items.length,
      })
    }
    return items
  }

  private planUsers(
    input: OrganizationSyncPlannerInput,
    departmentItems: OrganizationSyncPlanItem[],
  ): OrganizationSyncPlanItem[] {
    const localById = new Map(input.users.map((user) => [user.id, user]))
    const mappingByKey = new Map(
      input.userMappings.map((mapping) => [mapping.externalKey, mapping]),
    )
    const localEmailMap = new Map(
      input.users
        .filter((user): user is PlannerUser & { email: string } => Boolean(user.email))
        .map((user) => [user.email.toLowerCase(), user]),
    )
    const localPhoneMap = new Map(
      input.users.filter((user) => user.phone).map((user) => [user.phone!, user]),
    )
    const departmentLocalIds = new Map(
      departmentItems
        .filter((item) => item.localId)
        .map((item) => [item.externalKey, item.localId!] as const),
    )
    const items: OrganizationSyncPlanItem[] = []

    for (const source of input.snapshot.users) {
      const mapping = mappingByKey.get(source.externalKey)
      const mappedLocal = mapping ? localById.get(mapping.userId) : undefined
      const emailKey = source.email?.toLowerCase() ?? null
      const emailCollision = !mapping && emailKey ? localEmailMap.get(emailKey) : undefined
      const phoneCollision =
        !mapping && source.mobile ? localPhoneMap.get(source.mobile) : undefined
      const collision = emailCollision ?? phoneCollision
      const conflictingTargets =
        emailCollision && phoneCollision && emailCollision.id !== phoneCollision.id
      const targetDepartmentId = departmentLocalIds.get(source.mainDepartmentExternalKey) ?? null
      const proposedEmail = source.email
      const changes = mappedLocal ? this.userChanges(mappedLocal, source, targetDepartmentId) : null
      const conflictType = collision
        ? conflictingTargets
          ? 'USER_EMAIL_PHONE_DIFFERENT'
          : emailCollision
            ? 'USER_EMAIL'
            : 'USER_PHONE'
        : null
      const action = conflictType
        ? 'CONFLICT'
        : !mappedLocal
          ? 'CREATE'
          : changes
            ? 'UPDATE'
            : 'UNCHANGED'

      items.push({
        resourceType: 'USER',
        externalId: source.userId,
        externalKey: source.externalKey,
        action,
        localId: mappedLocal?.id ?? collision?.id ?? null,
        parentExternalKey: source.mainDepartmentExternalKey,
        sourceData: { ...source, proposedEmail },
        changes,
        conflictType,
        conflictMessage: conflictType
          ? conflictingTargets
            ? '邮箱和手机号分别对应不同成员，请明确选择绑定对象或跳过'
            : `本地已存在相同${emailCollision ? '邮箱' : '手机号'}的成员，请选择绑定或跳过`
          : null,
        sort: 100_000 + items.length,
      })
    }

    const sourceKeys = new Set(input.snapshot.users.map(({ externalKey }) => externalKey))
    for (const mapping of input.userMappings) {
      if (!mapping.active || sourceKeys.has(mapping.externalKey)) continue
      const local = localById.get(mapping.userId)
      if (!local) continue
      items.push({
        resourceType: 'USER',
        externalId: mapping.externalId,
        externalKey: mapping.externalKey,
        action: 'DISABLE',
        localId: local.id,
        parentExternalKey: null,
        sourceData: {
          userId: mapping.externalId,
          name: local.name,
          email: local.email,
          missing: true,
        },
        changes: {
          status: { before: local.status, after: 'DISABLED' },
          mappingActive: { before: true, after: false },
        },
        conflictType: null,
        conflictMessage: null,
        sort: 100_000 + items.length,
      })
    }
    return items
  }

  private departmentChanges(
    local: PlannerDepartment,
    source: WeComDepartmentSnapshot,
    parentLocalId: string | null,
  ): Record<string, { before: unknown; after: unknown }> | null {
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    if (local.name !== source.name) changes['name'] = { before: local.name, after: source.name }
    if (local.sort !== source.order) changes['sort'] = { before: local.sort, after: source.order }
    if (parentLocalId && local.parentId !== parentLocalId) {
      changes['parentId'] = { before: local.parentId, after: parentLocalId }
    }
    return Object.keys(changes).length ? changes : null
  }

  private userChanges(
    local: PlannerUser,
    source: WeComUserSnapshot,
    targetDepartmentId: string | null,
  ): Record<string, { before: unknown; after: unknown }> | null {
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    if (local.name !== source.name) changes['name'] = { before: local.name, after: source.name }
    if (targetDepartmentId && local.deptId !== targetDepartmentId) {
      changes['deptId'] = { before: local.deptId, after: targetDepartmentId }
    }
    if (local.position !== source.position) {
      changes['position'] = { before: local.position, after: source.position }
    }
    if (local.phone !== source.mobile)
      changes['phone'] = { before: local.phone, after: source.mobile }
    if (local.status !== 'ACTIVE') {
      changes['status'] = { before: local.status, after: 'ACTIVE' }
    }
    return Object.keys(changes).length ? changes : null
  }

  private sortDepartments(departments: WeComDepartmentSnapshot[]): WeComDepartmentSnapshot[] {
    const byKey = new Map(departments.map((department) => [department.externalKey, department]))
    const depthCache = new Map<string, number>()
    const depth = (department: WeComDepartmentSnapshot): number => {
      const cached = depthCache.get(department.externalKey)
      if (cached !== undefined) return cached
      const value = department.isRoot ? 0 : 1 + depth(byKey.get(department.parentExternalKey)!)
      depthCache.set(department.externalKey, value)
      return value
    }
    return [...departments].sort(
      (a, b) => depth(a) - depth(b) || b.order - a.order || a.id.localeCompare(b.id),
    )
  }

  private count(items: OrganizationSyncPlanItem[]): OrganizationSyncCounts {
    const counts: OrganizationSyncCounts = {
      create: 0,
      update: 0,
      disable: 0,
      unchanged: 0,
      conflict: 0,
      skip: 0,
      failed: 0,
    }
    for (const item of items) counts[item.action.toLowerCase() as keyof OrganizationSyncCounts]++
    return counts
  }
}
