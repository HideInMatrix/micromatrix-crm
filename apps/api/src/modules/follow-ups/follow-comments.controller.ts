import { Body, Controller, Delete, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import {
  AddFollowCommentDto,
  FollowCommentPageDto,
  UpdateFollowCommentDto,
} from './dto/follow-comment.dto'
import { FollowCommentsService } from './follow-comments.service'

@ApiTags('跟进记录评论')
@ApiBearerAuth()
@Controller('follow/record/comment')
export class FollowCommentsController {
  constructor(private readonly comments: FollowCommentsService) {}

  @Post('page')
  @ApiOperation({ summary: '分页查询跟进记录顶层评论' })
  page(@CurrentUser() user: AuthUser, @Body() dto: FollowCommentPageDto) {
    return this.comments.page(user, dto)
  }

  @Post('add')
  @LogOperation('followUp', 'commentAdd')
  @ApiOperation({ summary: '添加跟进记录评论' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddFollowCommentDto) {
    return this.comments.add(user, dto)
  }

  @Post('update')
  @LogOperation('followUp', 'commentUpdate')
  @ApiOperation({ summary: '编辑跟进记录评论' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateFollowCommentDto) {
    return this.comments.update(user, dto)
  }

  @Delete(':id')
  @LogOperation('followUp', 'commentDelete')
  @ApiOperation({ summary: '删除跟进记录评论' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.remove(user, id)
  }
}
