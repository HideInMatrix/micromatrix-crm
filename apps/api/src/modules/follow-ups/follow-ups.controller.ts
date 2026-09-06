import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { CreateFollowUpDto, FollowUpRecordPageDto, UpdateFollowUpDto } from './dto/follow-up.dto'
import { FollowUpsService } from './follow-ups.service'

@ApiTags('跟进记录')
@ApiBearerAuth()
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Get('module/form')
  @ApiOperation({ summary: '跟进记录表单配置' })
  form(@CurrentUser() user: AuthUser) {
    return this.followUpsService.form(user)
  }

  @Post('page')
  @ApiOperation({ summary: '跟进记录统一分页查询' })
  page(@CurrentUser() user: AuthUser, @Body() dto: FollowUpRecordPageDto) {
    return this.followUpsService.page(user, dto)
  }

  @Get(':id')
  @ApiOperation({ summary: '跟进记录详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.followUpsService.get(user, id)
  }

  @Get(':id/attachments/:attachmentId/download')
  @ApiOperation({ summary: '下载跟进记录动态字段附件' })
  downloadAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.followUpsService.viewAttachment(user, id, attachmentId)
  }

  @Post()
  @LogOperation('followUp', 'create')
  @ApiOperation({ summary: '新增跟进记录（自动更新对象最近跟进时间）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFollowUpDto) {
    return this.followUpsService.create(user, dto)
  }

  @Patch(':id')
  @LogOperation('followUp', 'update')
  @ApiOperation({ summary: '编辑跟进记录' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFollowUpDto) {
    return this.followUpsService.update(user, id, dto)
  }

  @Delete(':id')
  @LogOperation('followUp', 'delete')
  @ApiOperation({ summary: '删除跟进记录' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.followUpsService.remove(user, id)
  }
}
