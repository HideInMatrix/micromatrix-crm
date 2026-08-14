import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class QueryCustomersDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 10

  @ApiPropertyOptional({ description: '按名称/电话/邮箱模糊搜索' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '高级筛选条件（FilterCondition[] 的 JSON 字符串）' })
  @IsString()
  @IsOptional()
  filters?: string

  @ApiPropertyOptional({ enum: ['mine', 'sea'], description: 'sea=客户公海' })
  @IsIn(['mine', 'sea'])
  @IsOptional()
  scope?: 'mine' | 'sea'
}

export class CheckDuplicateQueryDto {
  @ApiPropertyOptional({ description: '客户名称（模糊）' })
  @IsString()
  @IsOptional()
  name?: string

  @ApiPropertyOptional({ description: '电话（精确）' })
  @IsString()
  @IsOptional()
  phone?: string
}
