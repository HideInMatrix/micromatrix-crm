import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Public } from '../common/decorators/public.decorator'
import { AuthService } from './auth.service'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshTokenDto } from './dto/refresh-token.dto'
import { RegisterDto } from './dto/register.dto'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册租户及管理员账号' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录' })
  login(@Body() dto: LoginDto, @Ip() ip: string, @Req() req: Request) {
    return this.authService.login(dto, { ip, userAgent: req.headers['user-agent'] })
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken)
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id)
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改当前用户密码并清除默认密码提醒' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto.oldPassword, dto.newPassword)
  }

}
