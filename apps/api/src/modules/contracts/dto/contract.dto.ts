import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
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

export class ContractStageFieldValueDto {
  @ApiProperty({ description: '字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class UpdateContractStageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ description: '目标合同阶段 ID' })
  @IsString()
  @IsNotEmpty()
  stage!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  voidReason?: string

  @ApiPropertyOptional({ type: [ContractStageFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractStageFieldValueDto)
  @IsOptional()
  fields?: ContractStageFieldValueDto[]
}

/** Cordys /contract/* 直接契约。旧 /contracts REST 只在 W3.6.4 子域迁移期间保留回款/发票关系入口。 */
export class ContractModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class ContractProductDto {
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
  productAmount?: number

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

export class ContractAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '合同名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '客户不能为空' })
  @MaxLength(32)
  customerId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '负责人不能为空' })
  @MaxLength(32)
  owner!: string

  @ApiPropertyOptional({ description: '合同累计金额；缺省按 products 计算' })
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999)
  @IsOptional()
  amount?: number

  @ApiPropertyOptional({ description: '合同开始时间，毫秒时间戳' })
  @IsNumber()
  @IsOptional()
  startTime?: number | null

  @ApiPropertyOptional({ description: '合同结束时间，毫秒时间戳' })
  @IsNumber()
  @IsOptional()
  endTime?: number | null

  @ApiPropertyOptional({ description: '合同编号；为空时服务端生成' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  number?: string

  @ApiPropertyOptional({ type: [ContractModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ContractModuleFieldValueDto[]

  @ApiPropertyOptional({ description: '当前表单配置快照' })
  @IsObject()
  @IsOptional()
  moduleFormConfigDTO?: Record<string, unknown>

  @ApiPropertyOptional({ type: [ContractProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractProductDto)
  @IsOptional()
  products?: ContractProductDto[]

  @ApiPropertyOptional({ description: '从已审批且未作废报价预填；仅创建时读取，不持久化' })
  @IsString()
  @IsOptional()
  fromQuotationId?: string
}

export class ContractUpdateDirectDto extends PartialType(ContractAddDto) {
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

export class ContractPageDto {
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

  @ApiPropertyOptional({ description: '指定阶段 ID' })
  @IsString()
  @IsOptional()
  stage?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string
}

export class ContractBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[]
}

export class ContractBatchUpdateDto extends ContractBatchDto {
  @ApiProperty({ description: '字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class ContractApprovalDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  approvalStatus!: string
}

export class ContractBatchApprovalDto extends ContractBatchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  approvalStatus!: string
}

export class ContractSortDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  stage!: string

  @ApiPropertyOptional({ description: '同阶段内目标位置，从 1 开始' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pos?: number
}
