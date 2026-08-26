import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { EnterpriseUiAssetSlot } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { SaveEnterpriseMailSettingDto, TestEnterpriseMailSettingDto } from './dto/mail-setting.dto'
import { UpdateEnterpriseUiSettingDto } from './dto/ui-setting.dto'
import { EnterpriseMailSettingsService } from './enterprise-mail-settings.service'
import { EnterpriseUiSettingsService } from './enterprise-ui-settings.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('企业设置')
@ApiBearerAuth()
@Controller('enterprise-settings')
export class EnterpriseSettingsController {
  constructor(
    private readonly ui: EnterpriseUiSettingsService,
    private readonly mail: EnterpriseMailSettingsService,
  ) {}

  @Get('ui')
  @RequirePermissions('system:setting')
  @ApiOperation({ summary: '获取独立界面设置' })
  getUi(@CurrentUser() user: AuthUser) {
    return this.ui.get(user)
  }

  @Put('ui')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'update-ui')
  @ApiOperation({ summary: '更新独立界面设置' })
  updateUi(@CurrentUser() user: AuthUser, @Body() input: UpdateEnterpriseUiSettingDto) {
    return this.ui.update(user, input)
  }

  @Post('ui/assets/:slot')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'replace-ui-asset')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: '替换界面图片资源' })
  replaceUiAsset(
    @CurrentUser() user: AuthUser,
    @Param('slot') slot: EnterpriseUiAssetSlot,
    @UploadedFile() file: UploadedBufferFile | undefined,
  ) {
    return this.ui.replaceAsset(user, slot, file)
  }

  @Delete('ui/assets/:slot')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'clear-ui-asset')
  @ApiOperation({ summary: '恢复默认界面图片资源' })
  clearUiAsset(@CurrentUser() user: AuthUser, @Param('slot') slot: EnterpriseUiAssetSlot) {
    return this.ui.clearAsset(user, slot)
  }

  @Get('mail')
  @RequirePermissions('system:setting')
  @ApiOperation({ summary: '获取 SMTP 邮件设置（不返回明文密码）' })
  getMail(@CurrentUser() user: AuthUser) {
    return this.mail.get(user.tenantId)
  }

  @Put('mail')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'update-mail')
  @ApiOperation({ summary: '更新 SMTP 邮件设置' })
  updateMail(@CurrentUser() user: AuthUser, @Body() input: SaveEnterpriseMailSettingDto) {
    return this.mail.save(user, input)
  }

  @Post('mail/test')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'test-mail')
  @ApiOperation({ summary: '测试 SMTP 连接与认证' })
  testMail(@CurrentUser() user: AuthUser, @Body() input: TestEnterpriseMailSettingDto) {
    return this.mail.test(user, input)
  }
}
