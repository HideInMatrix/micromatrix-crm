import { Global, Module } from '@nestjs/common'
import { AttachmentsModule } from '../attachments/attachments.module'
import { MetadataController } from './metadata.controller'
import { MetadataService } from './metadata.service'
import { ModuleFormsService } from './module-forms.service'
import { ResourceFieldAttachmentCleanupService } from './resource-field-attachment-cleanup.service'
import { ResourceFieldValueService } from './resource-field-value.service'

@Global()
@Module({
  imports: [AttachmentsModule],
  controllers: [MetadataController],
  providers: [
    ModuleFormsService,
    MetadataService,
    ResourceFieldValueService,
    ResourceFieldAttachmentCleanupService,
  ],
  exports: [ModuleFormsService, MetadataService, ResourceFieldValueService],
})
export class ModuleFormsModule {}
