import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { LogsController } from './logs.controller'
import { OperationLogCleanupService } from './operation-log-cleanup.service'
import { OperationLogSettingsService } from './operation-log-settings.service'
import { LogsService } from './logs.service'

@Module({
  imports: [PrismaModule],
  controllers: [LogsController],
  providers: [LogsService, OperationLogSettingsService, OperationLogCleanupService],
})
export class LogsModule {}
