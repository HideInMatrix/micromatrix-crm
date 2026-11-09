import { Module } from '@nestjs/common'
import { AsyncJobsModule } from '../async-jobs/async-jobs.module'
import { ModuleFormsModule } from '../modules/metadata/module-forms.module'
import { PoolRulesModule } from '../modules/pool-rules/pool-rules.module'
import { PrismaModule } from '../prisma.module.js'
import { PoolRecycleWorkerService } from './pool-recycle-worker.service'

@Module({
  imports: [AsyncJobsModule, ModuleFormsModule, PoolRulesModule, PrismaModule],
  providers: [PoolRecycleWorkerService],
})
export class PoolRecycleWorkerModule {}
