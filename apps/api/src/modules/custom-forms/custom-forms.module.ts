import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AttachmentsModule } from '../attachments/attachments.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { CustomFormDataController, CustomFormsController } from './custom-forms.controller'
import { CustomFormsService } from './custom-forms.service'

@Module({
  imports: [AttachmentsModule, ImportExportModule, UserViewsModule, PrismaModule],
  controllers: [CustomFormsController, CustomFormDataController],
  providers: [CustomFormsService],
  exports: [CustomFormsService],
})
export class CustomFormsModule {}
