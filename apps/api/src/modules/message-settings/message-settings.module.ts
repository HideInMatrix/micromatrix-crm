import { Global, Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { MessageSettingsController } from './message-settings.controller'
import { MessageSettingsService } from './message-settings.service'

@Global()
@Module({
  imports: [Prisma8Module],
  controllers: [MessageSettingsController],
  providers: [MessageSettingsService],
  exports: [MessageSettingsService],
})
export class MessageSettingsModule {}
