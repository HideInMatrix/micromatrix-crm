import { Module } from '@nestjs/common'
import { AttachmentsModule } from '../attachments/attachments.module'
import { EnterpriseAiModelsController } from './enterprise-ai-models.controller'
import { EnterpriseAiModelsService } from './enterprise-ai-models.service'
import { EnterpriseAiRuntimeService } from './enterprise-ai-runtime.service'
import { EnterpriseGlobalTasksController } from './enterprise-global-tasks.controller'
import { EnterpriseGlobalTasksService } from './enterprise-global-tasks.service'
import { EnterpriseMailSettingsService } from './enterprise-mail-settings.service'
import { EnterpriseSettingsController } from './enterprise-settings.controller'
import { EnterpriseTermsController } from './enterprise-terms.controller'
import { EnterpriseTermsService } from './enterprise-terms.service'
import { EnterpriseUiSettingsService } from './enterprise-ui-settings.service'
import { SmtpProbeService } from './smtp-probe.service'

@Module({
  imports: [AttachmentsModule],
  controllers: [
    EnterpriseSettingsController,
    EnterpriseAiModelsController,
    EnterpriseTermsController,
    EnterpriseGlobalTasksController,
  ],
  providers: [
    EnterpriseUiSettingsService,
    EnterpriseMailSettingsService,
    EnterpriseAiModelsService,
    EnterpriseAiRuntimeService,
    EnterpriseTermsService,
    EnterpriseGlobalTasksService,
    SmtpProbeService,
  ],
  exports: [
    EnterpriseUiSettingsService,
    EnterpriseMailSettingsService,
    EnterpriseAiModelsService,
    EnterpriseAiRuntimeService,
    EnterpriseTermsService,
    EnterpriseGlobalTasksService,
  ],
})
export class EnterpriseSettingsModule {}
