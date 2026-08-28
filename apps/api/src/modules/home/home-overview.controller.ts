import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { HomeOverviewService } from './home-overview.service'

@ApiTags('首页概览')
@ApiBearerAuth()
@RequirePermissions('menu:dashboard')
@Controller('home/overview')
export class HomeOverviewController {
  constructor(private readonly homeOverviewService: HomeOverviewService) {}

  @Get('summary')
  @ApiOperation({ summary: '销售简报与待办' })
  summary(@CurrentUser() user: AuthUser) {
    return this.homeOverviewService.summary(user)
  }

  @Get('funnel')
  @ApiOperation({ summary: '商机漏斗' })
  funnel(@CurrentUser() user: AuthUser) {
    return this.homeOverviewService.funnel(user)
  }

  @Get('ranking')
  @ApiOperation({ summary: '本月业绩排行' })
  ranking(@CurrentUser() user: AuthUser) {
    return this.homeOverviewService.ranking(user)
  }

  @Get('trend')
  @ApiOperation({ summary: '近 6 个月赢单/回款趋势' })
  trend(@CurrentUser() user: AuthUser) {
    return this.homeOverviewService.trend(user)
  }

  @Get('conversion')
  @ApiOperation({ summary: '线索转化与输单原因' })
  conversion(@CurrentUser() user: AuthUser) {
    return this.homeOverviewService.conversion(user)
  }
}
