import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { HomeStatisticSearchDto } from './dto/home-statistic.dto'
import { HomeStatisticService } from './home-statistic.service'

@ApiTags('首页统计')
@ApiBearerAuth()
@Controller('home/statistic')
export class HomeStatisticController {
  constructor(private readonly homeStatisticService: HomeStatisticService) {}

  @Get('department/tree')
  @ApiOperation({ summary: '当前用户首页可选部门权限树' })
  departmentTree(@CurrentUser() user: AuthUser) {
    return this.homeStatisticService.departmentTree(user)
  }

  @Post('lead')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '首页线索统计' })
  lead(@CurrentUser() user: AuthUser, @Body() request: HomeStatisticSearchDto) {
    return this.homeStatisticService.lead(user, request)
  }

  @Post('opportunity')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '首页商机统计' })
  opportunity(@CurrentUser() user: AuthUser, @Body() request: HomeStatisticSearchDto) {
    return this.homeStatisticService.opportunity(user, request)
  }

  @Post('opportunity/underway')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '首页进行中商机统计' })
  underwayOpportunity(@CurrentUser() user: AuthUser, @Body() request: HomeStatisticSearchDto) {
    return this.homeStatisticService.underwayOpportunity(user, request)
  }

  @Post('opportunity/success')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '首页赢单统计' })
  successOpportunity(@CurrentUser() user: AuthUser, @Body() request: HomeStatisticSearchDto) {
    return this.homeStatisticService.successOpportunity(user, request)
  }
}
