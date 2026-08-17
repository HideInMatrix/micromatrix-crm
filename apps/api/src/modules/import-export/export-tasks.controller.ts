import { Controller, Delete, Get, Param, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ExportTasksService } from './export-tasks.service'

@ApiTags('导出任务')
@ApiBearerAuth()
@Controller('export-tasks')
export class ExportTasksController {
  constructor(private readonly tasks: ExportTasksService) {}

  @Get()
  @ApiOperation({ summary: '我的导出任务（保留 24 小时）' })
  list(@CurrentUser() user: AuthUser) {
    return this.tasks.list(user)
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载本人已完成的导出任务' })
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.tasks.download(user, id)
    return new StreamableFile(result.stream, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    })
  }

  @Delete(':id')
  @ApiOperation({ summary: '取消/清理本人导出任务' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.cancel(user, id)
  }
}
