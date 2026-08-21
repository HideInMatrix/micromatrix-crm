import { Module } from '@nestjs/common'
import { ModuleConfigsController } from './module-configs.controller'
import { ModuleConfigsService } from './module-configs.service'

@Module({
  controllers: [ModuleConfigsController],
  providers: [ModuleConfigsService],
  exports: [ModuleConfigsService],
})
export class ModuleConfigsModule {}
