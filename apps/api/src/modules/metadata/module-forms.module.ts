import { Global, Module } from '@nestjs/common'
import { MetadataController } from './metadata.controller'
import { MetadataService } from './metadata.service'
import { ModuleFormsService } from './module-forms.service'
import { ResourceFieldValueService } from './resource-field-value.service'

@Global()
@Module({
  controllers: [MetadataController],
  providers: [ModuleFormsService, MetadataService, ResourceFieldValueService],
  exports: [ModuleFormsService, MetadataService, ResourceFieldValueService],
})
export class ModuleFormsModule {}
