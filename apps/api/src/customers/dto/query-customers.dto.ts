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

  @ApiPropertyOptional({ description: '保存的用户视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({
    enum: ['sea'],
    description: '资源模式；sea=客户公海。普通客户页使用 view 切换系统视图',
  })
  @IsIn(['sea'])
  @IsOptional()
  scope?: 'sea'

  @ApiPropertyOptional({
    enum: ['ALL', 'SELF', 'DEPARTMENT', 'COLLABORATION'],
    description: 'Cordys 客户系统视图；ALL 仍受当前角色数据范围约束',
  })
  @IsIn(['ALL', 'SELF', 'DEPARTMENT', 'COLLABORATION'])
  @IsOptional()
  view?: 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'

  @ApiPropertyOptional({ description: '公海 ID（scope=sea 时生效）' })
  @IsString()
  @IsOptional()
  poolId?: string
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
