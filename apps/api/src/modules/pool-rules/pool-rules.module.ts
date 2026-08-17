import { Module } from '@nestjs/common'
import { PoolRecycleService } from './pool-recycle.service'
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
    ResourcePoolsService,
    ResourceRecycleConditionEvaluator,
  ],
  exports: [ResourcePoolsService],
})
export class PoolRulesModule {}
