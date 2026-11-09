import { Module } from '@nestjs/common'
import { AsyncJobsModule } from '../../async-jobs/async-jobs.module'
import { PrismaModule } from '../../prisma.module'
import { DictionariesModule } from '../dictionaries/dictionaries.module'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { PoolRecycleService } from './pool-recycle.service'
import { PoolRecycleTaskService } from './pool-recycle-task.service'
import { PoolRuleCalculator } from './pool-rule-calculator.service'
import { PoolOptionsController } from './pool-options.controller'
import { ResourcePoolsService } from './resource-pools.service'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'
import { LeadPoolSlaService } from './lead-pool-sla.service'
import { LeadSlaReminderService } from './lead-sla-reminder.service'

@Module({
  imports: [PrismaModule, DictionariesModule, AsyncJobsModule],
  controllers: [PoolOptionsController],
  providers: [
    PoolRecycleService,
    PoolRecycleTaskService,
    PoolRuleCalculator,
    CluePoolRepository,
    CustomerPoolRepository,
    ResourcePoolsService,
    ResourceRecycleConditionEvaluator,
    LeadPoolSlaService,
    LeadSlaReminderService,
  ],
  exports: [
    PoolRecycleService,
    ResourcePoolsService,
    PoolRecycleTaskService,
    CluePoolRepository,
    CustomerPoolRepository,
    ResourceRecycleConditionEvaluator,
    LeadPoolSlaService,
  ],
})
export class PoolRulesModule {}
