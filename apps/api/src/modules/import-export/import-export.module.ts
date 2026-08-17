import { Module } from '@nestjs/common'
import { ExportTasksController } from './export-tasks.controller'
import { ExportTasksService } from './export-tasks.service'
import { SpreadsheetService } from './spreadsheet.service'

@Module({
  controllers: [ExportTasksController],
  providers: [SpreadsheetService, ExportTasksService],
  exports: [SpreadsheetService, ExportTasksService],
})
export class ImportExportModule {}
