import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { DictionariesController } from './dictionaries.controller'
import { DictionariesService } from './dictionaries.service'

@Module({
  imports: [Prisma8Module],
  controllers: [DictionariesController],
  providers: [DictionariesService],
  exports: [DictionariesService],
})
export class DictionariesModule {}
