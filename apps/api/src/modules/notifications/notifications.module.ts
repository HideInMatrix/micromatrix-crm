import { Global, Module } from '@nestjs/common'
import { MessageSettingsModule } from '../message-settings/message-settings.module'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { BusinessNotificationsService } from './business-notifications.service'
import { MessageExpiryService } from './message-expiry.service'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'
import { MessageDeliveriesController } from './message-deliveries.controller'
import { MessageDeliveryService } from './message-delivery.service'

/** 全局模块：业务模块（分配/审批/回款提醒等）都会调用通知服务 */
@Global()
@Module({
  imports: [MessageSettingsModule, EnterpriseIntegrationsModule],
  controllers: [NotificationsController, MessageDeliveriesController],
  providers: [
    NotificationsService,
    BusinessNotificationsService,
    MessageExpiryService,
    MessageDeliveryService,
  ],
  exports: [NotificationsService, BusinessNotificationsService, MessageDeliveryService],
})
export class NotificationsModule {}
