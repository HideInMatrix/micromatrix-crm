import { Module } from '@nestjs/common'
import { BiddingController } from './bidding.controller'
import { BiddingService } from './bidding.service'
import { DemoBiddingProvider } from './providers/demo.provider'

@Module({
  controllers: [BiddingController],
  providers: [BiddingService, DemoBiddingProvider],
})
export class BiddingModule {}
