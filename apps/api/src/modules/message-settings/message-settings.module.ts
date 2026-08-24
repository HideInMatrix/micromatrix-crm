import { Global, Module } from '@nestjs/common'
import { MessageSettingsController } from './message-settings.controller'
import { MessageSettingsService } from './message-settings.service'

@Global()
@Module({
  controllers: [MessageSettingsController],
  providers: [MessageSettingsService],
  exports: [MessageSettingsService],
})
export class MessageSettingsModule {}
