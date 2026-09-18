import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { BiddingController } from './bidding.controller'
import { BiddingService } from './bidding.service'
import { DemoBiddingProvider } from './providers/demo.provider'

@Module({
  imports: [Prisma8Module],
  controllers: [BiddingController],
  providers: [BiddingService, DemoBiddingProvider],
})
export class BiddingModule {}
