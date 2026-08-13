import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { CreateFollowUpDto, QueryFollowUpsDto } from './dto/follow-up.dto'
import { FollowUpsService } from './follow-ups.service'

@ApiTags('跟进记录')
@ApiBearerAuth()
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Get()
  @ApiOperation({ summary: '某对象的跟进记录' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryFollowUpsDto) {
    return this.followUpsService.list(user, query)
  }

  @Post()
  @LogOperation('followUp', 'create')
  @ApiOperation({ summary: '新增跟进记录（自动更新对象最近跟进时间）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFollowUpDto) {
    return this.followUpsService.create(user, dto)
  }
}
