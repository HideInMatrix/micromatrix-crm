import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { MessageSettingsController } from './message-settings.controller'
import { MessageSettingsService } from './message-settings.service'

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [MessageSettingsController],
  providers: [MessageSettingsService],
  exports: [MessageSettingsService],
})
export class MessageSettingsModule {}
