import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { RolesModule } from '../roles/roles.module'
import { MembersController } from './members.controller'
import { MembersService } from './members.service'

@Module({
  imports: [PrismaModule, RolesModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
