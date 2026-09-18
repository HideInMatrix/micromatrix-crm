import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module.js'
import { AnnouncementsController } from './announcements.controller'
import { AnnouncementsService } from './announcements.service'

@Module({
  imports: [Prisma8Module],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
