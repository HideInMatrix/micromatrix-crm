import { Global, Module } from '@nestjs/common'
import { MessageSettingsModule } from '../message-settings/message-settings.module'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

/** 全局模块：业务模块（分配/审批/回款提醒等）都会调用通知服务 */
@Global()
@Module({
  imports: [MessageSettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
