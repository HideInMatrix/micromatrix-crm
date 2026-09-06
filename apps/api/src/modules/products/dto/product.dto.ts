import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import type { FilterCondition } from '@micromatrix/shared'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class ProductModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional({ description: '动态字段值' })
  @IsOptional()
  fieldValue?: unknown
}

export class ProductAddDto {
  @ApiProperty({ description: '产品名称' })
  @IsString()
  @IsNotEmpty({ message: '产品名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ description: '产品价格' })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  price?: number

  @ApiProperty({ description: '1=上架，2=下架', enum: ['1', '2'] })
  @IsIn(['1', '2'])
  status!: '1' | '2'

  @ApiPropertyOptional({ type: [ProductModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ProductModuleFieldValueDto[]
}

export class ProductUpdateDto extends PartialType(ProductAddDto) {
  @ApiProperty({ description: '产品 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string
}

export class ProductPageDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  current?: number = 1

  @ApiPropertyOptional({ default: 10, maximum: 500 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  pageSize?: number = 10

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ enum: ['1', '2'] })
  @IsIn(['1', '2'])
  @IsOptional()
  status?: '1' | '2'

  @ApiPropertyOptional({ description: '高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND', description: '筛选条件组合方式' })
  @IsIn(['AND', 'OR'])
  @IsOptional()
  filterMode?: 'AND' | 'OR'
}

export class ProductExportDto extends ProductPageDto {
  @ApiProperty({ description: '导出文件名（不含 .xlsx）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ description: '导出字段 key', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]
}

export class ProductExportSelectDto {
  @ApiProperty({ description: '导出文件名（不含 .xlsx）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ description: '导出字段 key', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]

  @ApiProperty({ description: '选中的产品 ID', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class ProductSortDto {
  @ApiProperty({ description: '被拖拽产品 ID' })
  @IsString()
  @IsNotEmpty()
  dragNodeId!: string

  @ApiPropertyOptional({ description: '目标产品 ID；为空时放到末尾' })
  @IsString()
  @IsOptional()
  dropNodeId?: string

  @ApiProperty({ description: '-1=目标前，1=目标后' })
  @Type(() => Number)
  @IsInt()
  @IsIn([-1, 1])
  dropPosition!: number
}
