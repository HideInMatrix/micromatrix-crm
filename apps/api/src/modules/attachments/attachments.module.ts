import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { AttachmentsController } from './attachments.controller'
import { AttachmentsService } from './attachments.service'

@Module({
  imports: [Prisma8Module],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
