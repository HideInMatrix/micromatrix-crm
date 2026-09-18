import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { DepartmentsController } from './departments.controller'
import { DepartmentsService } from './departments.service'

@Module({
  imports: [Prisma8Module],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
})
export class DepartmentsModule {}
