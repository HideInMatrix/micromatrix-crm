import { Module } from '@nestjs/common'
import { ImportExportModule } from '../import-export/import-export.module'
import { ModuleFormsModule } from '../metadata/module-forms.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { OrderFieldsService } from './order-fields.service'
import { OrderStageController } from './order-stage.controller'
import { OrderStageService } from './order-stage.service'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'

@Module({
  imports: [ModuleFormsModule, UserViewsModule, ImportExportModule],
  controllers: [OrdersController, OrderStageController],
  providers: [OrdersService, OrderFieldsService, OrderStageService],
  exports: [OrdersService, OrderStageService],
})
export class OrdersModule {}
