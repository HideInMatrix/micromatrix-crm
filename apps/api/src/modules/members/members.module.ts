import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { RolesModule } from '../roles/roles.module'
import { MembersController } from './members.controller'
import { MembersService } from './members.service'

@Module({
  imports: [Prisma8Module, RolesModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
