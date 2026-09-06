import { Body, Controller, Delete, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import {
  AddFollowCommentDto,
  FollowCommentPageDto,
  UpdateFollowCommentDto,
} from '../follow-ups/dto/follow-comment.dto'
import { FollowPlanCommentsService } from './follow-plan-comments.service'

@ApiTags('跟进计划评论')
@ApiBearerAuth()
@Controller('follow/plan/comment')
export class FollowPlanCommentsController {
  constructor(private readonly comments: FollowPlanCommentsService) {}

  @Post('page')
  @ApiOperation({ summary: '分页查询跟进计划顶层评论' })
  page(@CurrentUser() user: AuthUser, @Body() dto: FollowCommentPageDto) {
    return this.comments.page(user, dto)
  }

  @Post('add')
  @LogOperation('followUpPlan', 'commentAdd')
  @ApiOperation({ summary: '添加跟进计划评论' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddFollowCommentDto) {
    return this.comments.add(user, dto)
  }

  @Post('update')
  @LogOperation('followUpPlan', 'commentUpdate')
  @ApiOperation({ summary: '编辑跟进计划评论' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateFollowCommentDto) {
    return this.comments.update(user, dto)
  }

  @Delete(':id')
  @LogOperation('followUpPlan', 'commentDelete')
  @ApiOperation({ summary: '删除跟进计划评论' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.remove(user, id)
  }
}
