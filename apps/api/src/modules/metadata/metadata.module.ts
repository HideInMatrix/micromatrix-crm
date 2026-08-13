import { Global, Module } from '@nestjs/common'
import { MetadataController } from './metadata.controller'
import { MetadataService } from './metadata.service'

/** 全局模块：业务模块保存/查询时需要字段定义做校验与筛选 */
@Global()
@Module({
  controllers: [MetadataController],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
