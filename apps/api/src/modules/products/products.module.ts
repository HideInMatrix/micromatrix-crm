import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { ImportExportModule } from '../import-export/import-export.module'
import { ProductPriceController } from './product-price.controller'
import { ProductPriceFieldsService } from './product-price-fields.service'
import { ProductPriceService } from './product-price.service'
import { ProductsController } from './products.controller'
import { ProductsService } from './products.service'

@Module({
  imports: [PrismaModule, ImportExportModule],
  controllers: [ProductsController, ProductPriceController],
  providers: [ProductsService, ProductPriceService, ProductPriceFieldsService],
  exports: [ProductsService, ProductPriceService],
})
export class ProductsModule {}
