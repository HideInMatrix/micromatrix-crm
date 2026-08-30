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
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { FilterCondition } from '@micromatrix/shared'

export class ContractInvoiceModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class ContractInvoiceAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '发票名称不能为空' })
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

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  amount!: number

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(50)
  @IsOptional()
  invoiceType?: string

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxRate?: number

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  @IsOptional()
  businessTitleId?: string | null

  @ApiPropertyOptional({ type: [ContractInvoiceModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractInvoiceModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ContractInvoiceModuleFieldValueDto[]
}

export class ContractInvoiceUpdateDto extends PartialType(ContractInvoiceAddDto) {
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
  @MaxLength(255)
  @IsOptional()
  comment?: string
}

export class ContractInvoicePageDto {
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

  @ApiPropertyOptional()
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

export class ContractInvoiceExportDto extends ContractInvoicePageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]
}

export class ContractInvoiceExportSelectDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class BusinessTitleAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '工商抬头名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ enum: ['CUSTOM', 'THIRD_PARTY'], default: 'CUSTOM' })
  @IsIn(['CUSTOM', 'THIRD_PARTY'])
  @IsOptional()
  type?: 'CUSTOM' | 'THIRD_PARTY'

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  identificationNumber?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  openingBank?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  bankAccount?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  registrationAddress?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  phoneNumber?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  registeredCapital?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  companySize?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  registrationNumber?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  province?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  city?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  scale?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  industry?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  remark?: string
}

export class BusinessTitleUpdateDto extends PartialType(BusinessTitleAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string
}

export class BusinessTitlePageDto {
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
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]
}

export class BusinessTitleExportDto extends BusinessTitlePageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]
}

export class BusinessTitleExportSelectDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class BusinessTitleConfigUpdateDto {
  @ApiProperty()
  @IsBoolean()
  required!: boolean
}

export class BusinessTitleApprovalDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ enum: ['APPROVED', 'UNAPPROVED'] })
  @IsIn(['APPROVED', 'UNAPPROVED'])
  approvalStatus!: 'APPROVED' | 'UNAPPROVED'

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  reason?: string
}

export class ApprovalResourceBaseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resourceId!: string

  @ApiProperty({ enum: ['invoice', 'order'] })
  @IsIn(['invoice', 'order'])
  formKey!: 'invoice' | 'order'
}
