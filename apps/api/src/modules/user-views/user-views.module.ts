import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma.module'
import {
  CluePoolUserViewsController,
  ClueUserViewsController,
  FollowRecordUserViewsController,
  CustomerPoolUserViewsController,
  CustomerUserViewsController,
} from './user-views.controller'
import { UserViewsService } from './user-views.service'

@Module({
  imports: [PrismaModule],
  controllers: [
    ClueUserViewsController,
    CluePoolUserViewsController,
    CustomerUserViewsController,
    CustomerPoolUserViewsController,
    FollowRecordUserViewsController,
  ],
  providers: [UserViewsService],
  exports: [UserViewsService],
})
export class UserViewsModule {}
