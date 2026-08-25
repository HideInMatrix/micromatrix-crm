import { Module } from '@nestjs/common'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { PoolRecycleService } from './pool-recycle.service'
import { PoolRuleCalculator } from './pool-rule-calculator.service'
import { PoolRulesController } from './pool-rules.controller'
import { PoolRulesService } from './pool-rules.service'
import { ResourcePoolsController } from './resource-pools.controller'
import { ResourcePoolsService } from './resource-pools.service'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

@Module({
  controllers: [PoolRulesController, ResourcePoolsController],
  providers: [
    PoolRulesService,
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
