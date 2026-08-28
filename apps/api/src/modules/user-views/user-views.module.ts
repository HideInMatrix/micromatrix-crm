import { Module } from '@nestjs/common'
import {
  CluePoolUserViewsController,
  ClueUserViewsController,
  CustomerContactUserViewsController,
  CustomerPoolUserViewsController,
  CustomerUserViewsController,
  OpportunityUserViewsController,
} from './user-views.controller'
import { UserViewsService } from './user-views.service'

@Module({
  controllers: [
    ClueUserViewsController,
    CluePoolUserViewsController,
    CustomerUserViewsController,
    CustomerContactUserViewsController,
    CustomerPoolUserViewsController,
    OpportunityUserViewsController,
  ],
  providers: [UserViewsService],
  exports: [UserViewsService],
})
export class UserViewsModule {}
