import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma.module.js'
import { AttachmentsModule } from '../attachments/attachments.module'
import { MetadataController } from './metadata.controller'
import { MetadataService } from './metadata.service'
import { ModuleFormsService } from './module-forms.service'
import { ResourceFieldAttachmentCleanupService } from './resource-field-attachment-cleanup.service'
import { ResourceFieldValueService } from './resource-field-value.service'
import { CustomerFollowUpCompletionService } from './customer-follow-up-completion.service'

@Global()
@Module({
  imports: [AttachmentsModule, PrismaModule],
  controllers: [MetadataController],
  providers: [
    ModuleFormsService,
    MetadataService,
    ResourceFieldValueService,
    CustomerFollowUpCompletionService,
    ResourceFieldAttachmentCleanupService,
  ],
  exports: [ModuleFormsService, MetadataService, ResourceFieldValueService, CustomerFollowUpCompletionService],
})
export class ModuleFormsModule {}
