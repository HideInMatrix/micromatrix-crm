import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { ModuleConfigsController } from './module-configs.controller'
import { ModuleConfigsService } from './module-configs.service'

@Module({
  imports: [Prisma8Module],
  controllers: [ModuleConfigsController],
  providers: [ModuleConfigsService],
  exports: [ModuleConfigsService],
})
export class ModuleConfigsModule {}
