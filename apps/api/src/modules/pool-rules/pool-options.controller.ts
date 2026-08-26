import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CluePool, CustomerPool } from '../../generated/prisma/client'
import type { PoolModule, ResourcePoolRecycleCondition } from './pool-domain.types'
import { parseStringArray } from './pool-repository.helpers'
import { ResourcePoolsService } from './resource-pools.service'

type PoolWithRelations = (CluePool | CustomerPool) & {
  hiddenFields: Array<{ fieldId: string }>
  pickRule: {
    limitOnNumber: boolean
    pickNumber: number | null
    limitPreOwner: boolean
    pickIntervalDays: number | null
    limitNew: boolean
    newPickInterval: number | null
  } | null
  recycleRule: {
    operator: string | null
    condition: string | null
  } | null
}

function parseRecycleConditions(raw: string | null): ResourcePoolRecycleCondition[] | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? (value as ResourcePoolRecycleCondition[]) : null
  } catch {
    return null
  }
}

export function toResourcePoolOption(module: PoolModule, pool: PoolWithRelations) {
  return {
    id: pool.id,
    module,
    name: pool.name,
    scopeIds: parseStringArray(pool.scopeId),
    managerIds: parseStringArray(pool.ownerId),
    enabled: pool.enable,
    autoRecycle: pool.auto,
    hiddenFieldIds: pool.hiddenFields.map((item) => item.fieldId),
    pickRule: pool.pickRule
      ? {
          limitDailyPick: pool.pickRule.limitOnNumber,
          dailyPickLimit: pool.pickRule.pickNumber,
          limitPreviousOwner: pool.pickRule.limitPreOwner,
          previousOwnerCooldownDays: pool.pickRule.pickIntervalDays,
          limitNewData: pool.pickRule.limitNew,
          newDataCooldownDays: pool.pickRule.newPickInterval,
        }
      : null,
    recycleRule: pool.recycleRule
      ? {
          operator: pool.recycleRule.operator === 'OR' ? ('OR' as const) : ('AND' as const),
          conditions: parseRecycleConditions(pool.recycleRule.condition),
        }
      : null,
  }
}

/**
 * W3.4 只读兼容 facade。
 *
 * 页面仍需要按当前用户范围选择线索池/客户公海，但旧通用 ResourcePool CRUD 已在
 * 直接模型迁移中删除。这里只保留 options 查询契约，数据源始终是 clue/customer
 * 分域直接表，不恢复旧通用模型或写接口。
 */
@ApiTags('池选项')
@ApiBearerAuth()
@Controller('resource-pools')
export class PoolOptionsController {
  constructor(private readonly resourcePools: ResourcePoolsService) {}

  @Get('options')
  @ApiOperation({ summary: '当前用户可访问的线索池/客户公海选项' })
  async options(@CurrentUser() user: AuthUser, @Query('module') module: PoolModule) {
    const pools = await this.resourcePools.options(user, module)
    return pools.map((pool) => toResourcePoolOption(module, pool))
  }
}
