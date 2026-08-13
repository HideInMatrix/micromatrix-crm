import { Module } from '@nestjs/common'
import { ContractsModule } from '../contracts/contracts.module'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'

@Module({
  imports: [ContractsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
