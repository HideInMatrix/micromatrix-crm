import { Module } from '@nestjs/common'
import { AsyncJobsModule } from '../../async-jobs/async-jobs.module'
import { Prisma8Module } from '../../prisma/prisma8.module.js'
import { ExportTasksController } from './export-tasks.controller'
import { ExportTasksService } from './export-tasks.service'
import { SpreadsheetService } from './spreadsheet.service'

@Module({
  imports: [AsyncJobsModule, Prisma8Module],
  controllers: [ExportTasksController],
  providers: [SpreadsheetService, ExportTasksService],
  exports: [SpreadsheetService, ExportTasksService],
})
export class ImportExportModule {}
