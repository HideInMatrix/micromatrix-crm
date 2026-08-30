import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
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
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { FilterCondition } from '@micromatrix/shared'

export class ContractPaymentModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class ContractPaymentPlanAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '回款计划名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '合同不能为空' })
  @MaxLength(32)
  contractId!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  @IsOptional()
  owner?: string

  @ApiPropertyOptional({ enum: ['PENDING', 'PARTIALLY_COMPLETED', 'COMPLETED'] })
  @IsIn(['PENDING', 'PARTIALLY_COMPLETED', 'COMPLETED'])
  @IsOptional()
  planStatus?: 'PENDING' | 'PARTIALLY_COMPLETED' | 'COMPLETED'

  @ApiProperty()
  @IsNumber()
  planAmount!: number

  @ApiProperty({ description: '计划回款时间，毫秒时间戳' })
  @IsNumber()
  planEndTime!: number

  @ApiPropertyOptional({ type: [ContractPaymentModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractPaymentModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ContractPaymentModuleFieldValueDto[]
}

export class ContractPaymentPlanUpdateDto extends PartialType(ContractPaymentPlanAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string
}

export class ContractPaymentRecordAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '回款记录名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  @IsOptional()
  owner?: string

  @ApiPropertyOptional({ description: '回款编码；为空时服务端按 PAY-yyyyMM-6 生成' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  no?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '合同不能为空' })
  @MaxLength(32)
  contractId!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  @IsOptional()
  paymentPlanId?: string | null

  @ApiProperty()
  @IsNumber()
  recordAmount!: number

  @ApiProperty({ description: '回款时间，毫秒时间戳' })
  @IsNumber()
  recordEndTime!: number

  @ApiPropertyOptional({ type: [ContractPaymentModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractPaymentModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ContractPaymentModuleFieldValueDto[]
}

export class ContractPaymentRecordUpdateDto extends PartialType(ContractPaymentRecordAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string
}

export class ContractPaymentPageDto {
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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contractId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string
}

export class ContractPaymentBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[]
}

export class ContractPaymentBatchUpdateDto extends ContractPaymentBatchDto {
  @ApiProperty({ description: '字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class ContractPaymentSortDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pos!: number
}

export class ContractPaymentExportDto extends ContractPaymentPageDto {
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

export class ContractPaymentExportSelectDto {
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

  @ApiProperty({ description: '选中的资源 ID', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}
