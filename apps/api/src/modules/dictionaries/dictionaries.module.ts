import { Module } from '@nestjs/common'
import { DictionariesController } from './dictionaries.controller'
import { DictionariesService } from './dictionaries.service'

@Module({
  controllers: [DictionariesController],
  providers: [DictionariesService],
  exports: [DictionariesService],
})
export class DictionariesModule {}
