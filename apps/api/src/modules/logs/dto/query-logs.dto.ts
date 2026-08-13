import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class QueryOperationLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '按模块筛选' })
  @IsString()
  @IsOptional()
  module?: string
}

export class QueryLoginLogsDto extends PaginationQueryDto {}
