import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import {
  PersonalPlanPageDto,
  ResetPersonalPasswordDto,
  UpdatePersonalInfoDto,
} from './dto/personal-center.dto'
import { PersonalCenterService } from './personal-center.service'

@ApiTags('个人中心')
@ApiBearerAuth()
@Controller('personal/center')
export class PersonalCenterController {
  constructor(private readonly service: PersonalCenterService) {}

  @Get('info')
  @ApiOperation({ summary: '当前用户详情（Cordys 个人中心契约）' })
  info(@CurrentUser() user: AuthUser) {
    return this.service.info(user)
  }

  @Post('update')
  @ApiOperation({ summary: '更新当前用户手机号和邮箱' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePersonalInfoDto) {
    return this.service.update(user, dto)
  }

  @Post('info/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改当前用户密码' })
  resetPassword(@CurrentUser() user: AuthUser, @Body() dto: ResetPersonalPasswordDto) {
    return this.service.resetPassword(user, dto)
  }

  @Post('follow/plan/list')
  @ApiOperation({ summary: '当前用户我的计划列表' })
  planList(@CurrentUser() user: AuthUser, @Body() dto: PersonalPlanPageDto) {
    return this.service.planList(user, dto)
  }
}
