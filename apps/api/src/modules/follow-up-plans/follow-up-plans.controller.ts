import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import {
  CreateFollowUpPlanDto,
  QueryFollowUpPlansDto,
  UpdateFollowUpPlanDto,
  UpdateFollowUpPlanStatusDto,
} from './dto/follow-up-plan.dto'
import { FollowUpPlansService } from './follow-up-plans.service'

@ApiTags('跟进计划')
@ApiBearerAuth()
@Controller('follow-up-plans')
export class FollowUpPlansController {
  constructor(private readonly service: FollowUpPlansService) {}

  @Get()
  @ApiOperation({ summary: '跟进计划分页列表（全局或指定业务对象）' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryFollowUpPlansDto) {
    return this.service.list(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: '跟进计划详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Post()
  @LogOperation('followUpPlan', 'create')
  @ApiOperation({ summary: '新增跟进计划' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFollowUpPlanDto) {
    return this.service.create(user, dto)
  }

  @Patch(':id')
  @LogOperation('followUpPlan', 'update')
  @ApiOperation({ summary: '编辑跟进计划' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpPlanDto,
  ) {
    return this.service.update(user, id, dto)
  }

  @Post(':id/status')
  @LogOperation('followUpPlan', 'updateStatus')
  @ApiOperation({ summary: '更新跟进计划状态' })
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpPlanStatusDto,
  ) {
    return this.service.updateStatus(user, id, dto.status)
  }

  @Post(':id/convert')
  @LogOperation('followUpPlan', 'convert')
  @ApiOperation({ summary: '原子转换为跟进记录' })
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.convert(user, id)
  }

  @Delete(':id')
  @LogOperation('followUpPlan', 'delete')
  @ApiOperation({ summary: '删除跟进计划' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }
}
