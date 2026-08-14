import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { AttachmentsService } from './attachments.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('附件')
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @ApiOperation({ summary: '列出某对象下的附件' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ) {
    return this.attachments.list(user, targetType, targetId)
  }

  @Post('upload')
  @LogOperation('attachment', 'upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        targetType: { type: 'string' },
        targetId: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: '上传附件（≤20MB）' })
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('targetType') targetType?: string,
    @Body('targetId') targetId?: string,
  ) {
    return this.attachments.upload(user, file, targetType, targetId)
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载附件' })
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StreamableFile> {
    return this.attachments.download(user, id)
  }

  @Delete(':id')
  @LogOperation('attachment', 'delete')
  @ApiOperation({ summary: '删除附件' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attachments.remove(user, id)
  }
}
