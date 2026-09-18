import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {
  NAVIGATION_MODULES,
  TOP_NAVIGATION_DEFINITIONS,
  type ModuleConfigVO,
  type NavigationModuleKey,
  type TopNavigationConfigVO,
  type TopNavigationKey,
} from '@micromatrix/shared'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { Prisma8Service } from '../../prisma/prisma8.service'

const definitionMap = new Map(NAVIGATION_MODULES.map((definition) => [definition.key, definition]))
const topNavigationDefinitionMap = new Map(
  TOP_NAVIGATION_DEFINITIONS.map((definition) => [definition.key, definition]),
)
const CACHE_NAMESPACE = 'module-config'
const CACHE_TTL_SECONDS = 10 * 60

@Injectable()
export class ModuleConfigsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  async list(tenantId: string): Promise<ModuleConfigVO[]> {
    if (this.cache) {
      return this.cache.remember({
        tenantId,
        namespace: CACHE_NAMESPACE,
        key: 'list',
        ttlSeconds: CACHE_TTL_SECONDS,
        loader: () => this.loadList(tenantId),
      })
    }
    return this.loadList(tenantId)
  }

  private async loadList(tenantId: string): Promise<ModuleConfigVO[]> {
    await this.ensureDefaults(tenantId)
    const rows = await this.prisma8.client.orm.public.ModuleConfigs.where({ tenantId })
      .orderBy((row) => row.sort.asc())
      .orderBy((row) => row.key.asc())
      .all()
    return rows.map((row) => this.toVO(row))
  }

  async update(tenantId: string, moduleKey: string, enabled: boolean): Promise<ModuleConfigVO> {
    const definition = this.getDefinition(moduleKey)
    if (!definition.configurable) throw new BadRequestException(`${definition.label}模块不可关闭`)
    await this.ensureDefaults(tenantId)
    const row = await this.prisma8.client.orm.public.ModuleConfigs.where({
      tenantId,
      key: definition.key,
    }).update({ enabled })
    if (!row) throw new NotFoundException('模块不存在')
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.toVO(row)
  }

  async reorder(tenantId: string, moduleKeys: string[]): Promise<ModuleConfigVO[]> {
    await this.ensureDefaults(tenantId)
    const expected = NAVIGATION_MODULES.map(({ key }) => key)
    const uniqueKeys = [...new Set(moduleKeys)]
    if (
      uniqueKeys.length !== expected.length ||
      expected.some((key) => !uniqueKeys.includes(key))
    ) {
      throw new BadRequestException('模块排序必须包含全部模块且不能重复')
    }

    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, key] of uniqueKeys.entries()) {
        const updated = await tx.orm.public.ModuleConfigs.where({ tenantId, key }).update({
          sort: index + 1,
        })
        if (!updated) throw new NotFoundException('模块不存在')
      }
    })
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.list(tenantId)
  }

  async listTopNavigation(tenantId: string): Promise<TopNavigationConfigVO[]> {
    if (this.cache) {
      return this.cache.remember({
        tenantId,
        namespace: CACHE_NAMESPACE,
        key: 'top-navigation',
        ttlSeconds: CACHE_TTL_SECONDS,
        loader: () => this.loadTopNavigation(tenantId),
      })
    }
    return this.loadTopNavigation(tenantId)
  }

  private async loadTopNavigation(tenantId: string): Promise<TopNavigationConfigVO[]> {
    await this.ensureTopNavigationDefaults(tenantId)
    const rows = await this.prisma8.client.orm.public.TopNavigationConfigs.where({ tenantId })
      .orderBy((row) => row.sort.asc())
      .orderBy((row) => row.key.asc())
      .all()
    return rows.map((row) => this.toTopNavigationVO(row))
  }

  async reorderTopNavigation(
    tenantId: string,
    navigationKeys: string[],
  ): Promise<TopNavigationConfigVO[]> {
    await this.ensureTopNavigationDefaults(tenantId)
    const expected = TOP_NAVIGATION_DEFINITIONS.map(({ key }) => key)
    const uniqueKeys = [...new Set(navigationKeys)]
    if (
      uniqueKeys.length !== expected.length ||
      expected.some((key) => !uniqueKeys.includes(key))
    ) {
      throw new BadRequestException('顶部导航排序必须包含全部入口且不能重复')
    }

    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, key] of uniqueKeys.entries()) {
        const updated = await tx.orm.public.TopNavigationConfigs.where({ tenantId, key }).update({
          sort: index + 1,
        })
        if (!updated) throw new NotFoundException('顶部导航入口不存在')
      }
    })
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.listTopNavigation(tenantId)
  }

  private async ensureDefaults(tenantId: string) {
    const rows = this.prisma8.client.orm.public.ModuleConfigs
    for (const [index, definition] of NAVIGATION_MODULES.entries()) {
      if (await rows.where({ tenantId, key: definition.key }).first()) continue
      try {
        await rows.create({
          tenantId,
          key: definition.key,
          enabled: definition.defaultEnabled,
          sort: index + 1,
        })
      } catch (error) {
        if ((error as { sqlState?: string }).sqlState !== '23505') throw error
      }
    }
  }

  private async ensureTopNavigationDefaults(tenantId: string) {
    const rows = this.prisma8.client.orm.public.TopNavigationConfigs
    for (const [index, definition] of TOP_NAVIGATION_DEFINITIONS.entries()) {
      if (await rows.where({ tenantId, key: definition.key }).first()) continue
      try {
        await rows.create({
          tenantId,
          key: definition.key,
          enabled: definition.defaultEnabled,
          sort: index + 1,
        })
      } catch (error) {
        if ((error as { sqlState?: string }).sqlState !== '23505') throw error
      }
    }
  }

  private getDefinition(moduleKey: string) {
    const definition = definitionMap.get(moduleKey as NavigationModuleKey)
    if (!definition) throw new NotFoundException('模块不存在')
    return definition
  }

  private toVO(row: { id: string; key: string; enabled: boolean; sort: number }): ModuleConfigVO {
    const definition = this.getDefinition(row.key)
    return {
      id: row.id,
      moduleKey: definition.key,
      enabled: row.enabled,
      sort: row.sort,
      configurable: definition.configurable,
    }
  }

  private getTopNavigationDefinition(navigationKey: string) {
    const definition = topNavigationDefinitionMap.get(navigationKey as TopNavigationKey)
    if (!definition) throw new NotFoundException('顶部导航入口不存在')
    return definition
  }

  private toTopNavigationVO(row: {
    id: string
    key: string
    enabled: boolean
    sort: number
  }): TopNavigationConfigVO {
    const definition = this.getTopNavigationDefinition(row.key)
    return {
      id: row.id,
      navigationKey: definition.key,
      enabled: row.enabled,
      sort: row.sort,
    }
  }
}
