import { Injectable } from '@nestjs/common'
import { PoolRuleVO } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { UpdatePoolRuleDto } from './dto/pool-rule.dto'

@Injectable()
export class PoolRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<PoolRuleVO[]> {
    const rules = await this.prisma.poolRule.findMany({ where: { tenantId } })
    const modules: Array<'lead' | 'customer'> = ['lead', 'customer']
    return modules.map((module) => {
      const rule = rules.find((r) => r.module === module)
      return {
        module,
        enabled: rule?.enabled ?? false,
        recycleDays: rule?.recycleDays ?? 30,
        notifyDays: rule?.notifyDays ?? 3,
      }
    })
  }

  async update(tenantId: string, dto: UpdatePoolRuleDto) {
    await this.prisma.poolRule.upsert({
      where: { tenantId_module: { tenantId, module: dto.module } },
      update: { enabled: dto.enabled, recycleDays: dto.recycleDays, notifyDays: dto.notifyDays },
      create: {
        tenantId,
        module: dto.module,
        enabled: dto.enabled,
        recycleDays: dto.recycleDays,
        notifyDays: dto.notifyDays,
      },
    })
    return { name: `${dto.module} 回收规则` }
  }
}
