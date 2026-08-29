import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
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
import type { FilterCondition } from '@micromatrix/shared'

export class QuotationModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class QuotationProductDto {
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

  @ApiPropertyOptional({ description: '价格表 ID' })
  @IsString()
  @IsOptional()
  priceId?: string

  @ApiPropertyOptional({ description: '产品定价' })
  @IsNumber()
  @IsOptional()
  productAmount?: number

  @ApiPropertyOptional({ description: '折扣' })
  @IsNumber()
  @IsOptional()
  discount?: number

  @ApiPropertyOptional({ description: '税点' })
  @IsNumber()
  @IsOptional()
  tax?: number

  @ApiPropertyOptional({ description: '表单公式计算后的行金额' })
  @IsNumber()
  @IsOptional()
  amount?: number

  @ApiPropertyOptional({ description: '扩展子字段 key/value' })
  @IsObject()
  @IsOptional()
  values?: Record<string, unknown>
}

export class QuotationAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '报价名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '商机不能为空' })
  @MaxLength(32)
  opportunityId!: string

  @ApiProperty({ description: '有效期至，毫秒时间戳' })
  @IsNumber()
  untilTime!: number

  @ApiPropertyOptional({ description: '累计金额；由报价表单公式产生' })
  @IsNumber()
  @IsOptional()
  amount?: number

  @ApiProperty({ type: [QuotationModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationModuleFieldValueDto)
  moduleFields!: QuotationModuleFieldValueDto[]

  @ApiProperty({ description: '当前报价表单配置快照' })
  @IsObject()
  moduleFormConfigDTO!: Record<string, unknown>

  @ApiPropertyOptional({ type: [QuotationProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationProductDto)
  @IsOptional()
  products?: QuotationProductDto[]
}

export class QuotationUpdateDto extends PartialType(QuotationAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  approvalStatus?: string

  @ApiPropertyOptional({ enum: ['normal', 'approval'] })
  @IsIn(['normal', 'approval'])
  @IsOptional()
  updateType?: 'normal' | 'approval'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  comment?: string
}

export class QuotationPageDto {
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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  opportunityId?: string

  @ApiPropertyOptional({ description: 'User View ID 或 ALL/DEPARTMENT' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]
}

export class QuotationBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[]
}

export class QuotationApproveDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  approvalStatus!: string
}

export class QuotationBatchApproveDto extends QuotationBatchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  approvalStatus!: string
}

export class QuotationBatchUpdateDto extends QuotationBatchDto {
  @ApiProperty({ description: '字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}
