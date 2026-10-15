import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import type { LogCategory } from '@micromatrix/shared'

export class QueryLogCategoryDto {
  @ApiPropertyOptional({ enum: ['operation', 'login', 'event'], description: '日志分类' })
  @IsIn(['operation', 'login', 'event'])
  @IsOptional()
  category?: LogCategory
}

export class QueryClearLogCategoryDto {
  @ApiPropertyOptional({ enum: ['operation', 'event'], description: '清空操作日志或事件日志' })
  @IsIn(['operation', 'event'])
  @IsOptional()
  category?: 'operation' | 'event'
}
