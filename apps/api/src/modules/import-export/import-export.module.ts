import { Module } from '@nestjs/common'
import { AsyncJobsModule } from '../../async-jobs/async-jobs.module'
import { ExportTasksController } from './export-tasks.controller'
import { ExportTasksService } from './export-tasks.service'
import { SpreadsheetService } from './spreadsheet.service'

@Module({
  imports: [AsyncJobsModule],
  controllers: [ExportTasksController],
  providers: [SpreadsheetService, ExportTasksService],
  exports: [SpreadsheetService, ExportTasksService],
})
export class ImportExportModule {}
