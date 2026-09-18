import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { ModuleConfigsController } from './module-configs.controller'
import { ModuleConfigsService } from './module-configs.service'

@Module({
  imports: [PrismaModule],
  controllers: [ModuleConfigsController],
  providers: [ModuleConfigsService],
  exports: [ModuleConfigsService],
})
export class ModuleConfigsModule {}
