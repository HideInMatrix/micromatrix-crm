import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
import type { FilterCondition } from '@micromatrix/shared'

export class OrderModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class OrderProductDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rowId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  bizId?: string

  @ApiProperty({ description: '产品 ID' })
  @IsString()
  @IsNotEmpty()
  product!: string

  @ApiPropertyOptional({ description: '产品单价' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  productPrice?: number

  @ApiPropertyOptional({ description: '数量' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  productNumber?: number

  @ApiPropertyOptional({ description: '行金额' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number

  @ApiPropertyOptional({ description: '产品子表扩展字段' })
  @IsObject()
  @IsOptional()
  values?: Record<string, unknown>
}

export class OrderAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '订单名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty({ description: '关联客户' })
  @IsString()
  @IsNotEmpty({ message: '关联客户不能为空' })
  @MaxLength(32)
  customerId!: string

  @ApiPropertyOptional({ description: '关联合同' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  contractId?: string | null

  @ApiProperty({ description: '负责人' })
  @IsString()
  @IsNotEmpty({ message: '负责人不能为空' })
  @MaxLength(32)
  owner!: string

  @ApiPropertyOptional({ description: '订单金额' })
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999)
  @IsOptional()
  amount?: number

  @ApiPropertyOptional({ description: '订单编号；为空时服务端生成' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  number?: string

  @ApiPropertyOptional({ type: [OrderModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderModuleFieldValueDto)
  @IsOptional()
  moduleFields?: OrderModuleFieldValueDto[]

  @ApiPropertyOptional({ description: '当前表单配置快照' })
  @IsObject()
  @IsOptional()
  moduleFormConfigDTO?: Record<string, unknown>

  @ApiPropertyOptional({ type: [OrderProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderProductDto)
  @IsOptional()
  products?: OrderProductDto[]
}

export class OrderUpdateDto extends PartialType(OrderAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string

  @ApiPropertyOptional({ enum: ['normal', 'approval'] })
  @IsIn(['normal', 'approval'])
  @IsOptional()
  updateType?: 'normal' | 'approval'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  comment?: string
}

export class OrderPageDto {
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

  @ApiPropertyOptional({ description: 'User View ID 或 ALL/DEPARTMENT' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ description: '看板模式' })
  @IsBoolean()
  @IsOptional()
  board?: boolean = false

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stage?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contractId?: string
}

export class OrderStageFieldValueDto extends OrderModuleFieldValueDto {}

export class OrderStageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  stage!: string

  @ApiPropertyOptional({ type: [OrderStageFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderStageFieldValueDto)
  @IsOptional()
  fields?: OrderStageFieldValueDto[]
}

export class OrderSortDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  stage!: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pos?: number
}

export class OrderBatchUpdateDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[]

  @ApiProperty({ description: '字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class OrderExportDto extends OrderPageDto {
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

export class OrderExportSelectDto {
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

  @ApiProperty({ description: '选中的订单 ID', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}
