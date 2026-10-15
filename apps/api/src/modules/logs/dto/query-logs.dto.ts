import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class QueryOperationLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '按模块筛选' })
  @IsString()
  @IsOptional()
  module?: string

  @ApiPropertyOptional({ description: '排除指定模块，适用于独立分类日志视图' })
  @IsString()
  @IsOptional()
  excludeModule?: string
}

export class QueryLoginLogsDto extends PaginationQueryDto {}
