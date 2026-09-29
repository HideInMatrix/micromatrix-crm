import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { HomeStatisticSearchDto } from './dto/home-statistic.dto'
import { HomeAnalyticsService } from './home-analytics.service'
import { HomeStatisticService } from './home-statistic.service'

@ApiTags('首页统计')
@ApiBearerAuth()
@Controller('home/statistic')
export class HomeStatisticController {
  constructor(
    private readonly homeStatisticService: HomeStatisticService,
    private readonly homeAnalyticsService: HomeAnalyticsService,
  ) {}

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

  @Post('lead/overdue')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '首页超时未跟进线索统计' })
  overdueLead(@CurrentUser() user: AuthUser, @Body() request: HomeStatisticSearchDto) {
    return this.homeStatisticService.overdueLead(user, request)
  }

  @Post('analytics')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '首页通用业务分析：漏斗、趋势、渠道、人员和 Customer 结果指标' })
  analytics(@CurrentUser() user: AuthUser, @Body() request: HomeStatisticSearchDto) {
    return this.homeAnalyticsService.overview(user, request)
  }

}
