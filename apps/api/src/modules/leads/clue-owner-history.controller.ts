import { Controller, Get, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator'
import { LeadsService } from './leads.service'

@ApiTags('线索负责人历史')
@ApiBearerAuth()
@Controller('lead/owner/history')
export class ClueOwnerHistoryController {
  constructor(private readonly service: LeadsService) {}

  @Get('list/:clueId')
  @RequireAnyPermissions('menu:lead', 'leadPool:read')
  @ApiOperation({ summary: '线索负责人历史列表' })
  list(@CurrentUser() user: AuthUser, @Param('clueId') clueId: string) {
    return this.service.ownerHistory(user, clueId)
  }
}
