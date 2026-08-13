import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Sse,
  UnauthorizedException,
  type MessageEvent,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Observable } from 'rxjs'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { NotificationsService } from './notifications.service'

@ApiTags('消息通知')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** EventSource 无法携带请求头，令牌通过 query 传入并手动校验 */
  @Public()
  @Sse('stream')
  @ApiOperation({ summary: 'SSE 实时通知流' })
  stream(@Query('token') token: string): Observable<MessageEvent> {
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      })
      return this.notificationsService.subscribe(payload.sub)
    } catch {
      throw new UnauthorizedException('令牌无效')
    }
  }

  @Get()
  @ApiOperation({ summary: '我的通知列表' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.list(
      user.tenantId,
      user.id,
      query.page ?? 1,
      query.pageSize ?? 10,
      unreadOnly === 'true',
    )
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读数量' })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.unreadCount(user.tenantId, user.id)
  }

  @Post(':id/read')
  @ApiOperation({ summary: '标记已读' })
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificationsService.markRead(user.tenantId, user.id, id)
  }

  @Post('read-all')
  @ApiOperation({ summary: '全部已读' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(user.tenantId, user.id)
  }
}
