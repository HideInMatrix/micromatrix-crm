import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { DictionariesModule } from '../dictionaries/dictionaries.module'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { PoolRecycleService } from './pool-recycle.service'
import { PoolRuleCalculator } from './pool-rule-calculator.service'
import { PoolOptionsController } from './pool-options.controller'
import { ResourcePoolsService } from './resource-pools.service'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

@Module({
  imports: [Prisma8Module, DictionariesModule],
  controllers: [PoolOptionsController],
  providers: [
    PoolRecycleService,
    PoolRuleCalculator,
    CluePoolRepository,
    CustomerPoolRepository,
    ResourcePoolsService,
    ResourceRecycleConditionEvaluator,
  ],
  exports: [ResourcePoolsService, CluePoolRepository, CustomerPoolRepository],
})
export class PoolRulesModule {}
