import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  NAVIGATION_MODULES,
  type ModuleConfigVO,
  type NavigationModuleKey,
} from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'

const definitionMap = new Map(NAVIGATION_MODULES.map((definition) => [definition.key, definition]))

@Injectable()
export class ModuleConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<ModuleConfigVO[]> {
    await this.ensureDefaults(tenantId)
    const rows = await this.prisma.moduleConfig.findMany({
      where: { tenantId },
      orderBy: [{ sort: 'asc' }, { key: 'asc' }],
    })
    return rows.map((row) => this.toVO(row))
  }

  async update(tenantId: string, moduleKey: string, enabled: boolean): Promise<ModuleConfigVO> {
    const definition = this.getDefinition(moduleKey)
    if (!definition.configurable) throw new BadRequestException(`${definition.label}模块不可关闭`)
    await this.ensureDefaults(tenantId)
    const row = await this.prisma.moduleConfig.update({
      where: { tenantId_key: { tenantId, key: definition.key } },
      data: { enabled },
    })
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

    await this.prisma.$transaction(
      uniqueKeys.map((key, index) =>
        this.prisma.moduleConfig.update({
          where: { tenantId_key: { tenantId, key } },
          data: { sort: index + 1 },
        }),
      ),
    )
    return this.list(tenantId)
  }

  private async ensureDefaults(tenantId: string) {
    await this.prisma.moduleConfig.createMany({
      data: NAVIGATION_MODULES.map((definition, index) => ({
        tenantId,
        key: definition.key,
        enabled: definition.defaultEnabled,
        sort: index + 1,
      })),
      skipDuplicates: true,
    })
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
}
