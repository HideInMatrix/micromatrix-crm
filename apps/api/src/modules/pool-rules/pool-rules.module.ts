import { Module } from '@nestjs/common'
import { PoolRecycleService } from './pool-recycle.service'
import { PoolRulesController } from './pool-rules.controller'
import { PoolRulesService } from './pool-rules.service'

@Module({
  controllers: [PoolRulesController],
  providers: [PoolRulesService, PoolRecycleService],
})
export class PoolRulesModule {}
