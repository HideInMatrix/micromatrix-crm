import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { BiddingController } from './bidding.controller'
import { BiddingService } from './bidding.service'
import { DemoBiddingProvider } from './providers/demo.provider'

@Module({
  imports: [PrismaModule],
  controllers: [BiddingController],
  providers: [BiddingService, DemoBiddingProvider],
})
export class BiddingModule {}
