import { Module } from '@nestjs/common'
import { HomeModule } from '../home/home.module'
import { OpportunitiesController } from './opportunities.controller'
import { OpportunitiesService } from './opportunities.service'

@Module({
  imports: [HomeModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
