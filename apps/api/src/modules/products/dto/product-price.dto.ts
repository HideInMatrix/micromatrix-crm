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
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { ProductModuleFieldValueDto } from './product.dto'

export class ProductPriceItemDto {
  @ApiPropertyOptional({ description: '子表格行实例 ID' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  rowId?: string

  @ApiPropertyOptional({ description: '子表格业务行 ID' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  bizId?: string

  @ApiProperty({ description: '产品 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  product!: string

  @ApiProperty({ description: '产品定价' })
  @IsNumber()
  @Min(0)
  amount!: number

  @ApiPropertyOptional({ description: '扩展子字段值' })
  @IsObject()
  @IsOptional()
  values?: Record<string, unknown>
}

export class ProductPriceAddDto {
  @ApiProperty({ description: '价格表名称' })
  @IsString()
  @IsNotEmpty({ message: '价格表名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty({ description: '1=启用，2=禁用', enum: ['1', '2'] })
  @IsIn(['1', '2'])
  status!: '1' | '2'

  @ApiPropertyOptional({ type: [ProductModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ProductModuleFieldValueDto[]

  @ApiPropertyOptional({ description: '产品信息子表', type: [ProductPriceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductPriceItemDto)
  @IsOptional()
  products?: ProductPriceItemDto[]
}

export class ProductPriceUpdateDto extends PartialType(ProductPriceAddDto) {
  @ApiProperty({ description: '价格表 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string
}

export class ProductPricePageDto {
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
}

export class ProductPriceExportDto extends ProductPricePageDto {
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

export class ProductPriceExportSelectDto {
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

  @ApiProperty({ description: '选中的价格表 ID', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class ProductPriceSortDto {
  @ApiProperty({ description: '被拖拽价格表 ID' })
  @IsString()
  @IsNotEmpty()
  dragNodeId!: string

  @ApiPropertyOptional({ description: '目标价格表 ID；为空时放到末尾' })
  @IsString()
  @IsOptional()
  dropNodeId?: string

  @ApiProperty({ description: '-1=目标前，1=目标后' })
  @Type(() => Number)
  @IsInt()
  @IsIn([-1, 1])
  dropPosition!: number
}
