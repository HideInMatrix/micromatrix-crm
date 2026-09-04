import { Module } from '@nestjs/common'
import { LogsController } from './logs.controller'
import { OperationLogCleanupService } from './operation-log-cleanup.service'
import { LogsService } from './logs.service'

@Module({
  controllers: [LogsController],
  providers: [LogsService, OperationLogCleanupService],
})
export class LogsModule {}
