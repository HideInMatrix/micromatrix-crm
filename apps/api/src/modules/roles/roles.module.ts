import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { RolesController } from './roles.controller'
import { RolesService } from './roles.service'

@Module({
  imports: [Prisma8Module],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
