import { Global, Module } from '@nestjs/common'
import { AsyncJobsService } from './async-jobs.service'

@Global()
@Module({
  providers: [AsyncJobsService],
  exports: [AsyncJobsService],
})
export class AsyncJobsModule {}
