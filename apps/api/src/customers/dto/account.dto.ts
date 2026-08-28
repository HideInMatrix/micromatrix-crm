import type { FilterCondition } from '@micromatrix/shared'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class AccountModuleFieldValueDto {
  @ApiProperty({ description: '模块字段 ID' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional({ description: '模块字段值' })
  @IsOptional()
  fieldValue?: unknown
}

export class AccountSortDto {
  @ApiProperty({ description: '字段 ID 或字段 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiProperty({ enum: ['asc', 'desc', 'ASC', 'DESC'] })
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  direction!: 'asc' | 'desc' | 'ASC' | 'DESC'
}

export class AccountPageDto {
  @ApiPropertyOptional({ default: 1 })
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 10, maximum: 500 })
  @Min(1)
  @Max(500)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '个人视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '当前筛选条件' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ enum: ['ALL', 'SELF', 'DEPARTMENT', 'COLLABORATION'] })
  @IsIn(['ALL', 'SELF', 'DEPARTMENT', 'COLLABORATION'])
  @IsOptional()
  view?: 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'

  @ApiPropertyOptional({ type: AccountSortDto })
  @ValidateNested()
  @Type(() => AccountSortDto)
  @IsOptional()
  sort?: AccountSortDto
}

export class AccountAddDto {
  @ApiProperty({ description: '客户名称' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ description: '负责人；为空时默认当前用户' })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  owner?: string

  @ApiPropertyOptional({ type: [AccountModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountModuleFieldValueDto)
  @IsOptional()
  moduleFields?: AccountModuleFieldValueDto[]

  @ApiPropertyOptional({ description: '线索转客户时的最新跟进人' })
  @IsString()
  @IsOptional()
  follower?: string

  @ApiPropertyOptional({ description: '线索转客户时的最新跟进时间' })
  @IsOptional()
  followTime?: number
}

export class AccountUpdateDto {
  @ApiProperty({ description: '客户 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string

  @ApiPropertyOptional({ description: '负责人' })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  owner?: string

  @ApiPropertyOptional({ type: [AccountModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountModuleFieldValueDto)
  @IsOptional()
  moduleFields?: AccountModuleFieldValueDto[]

  @ApiPropertyOptional({ description: 'Agent 调用标记' })
  @IsBoolean()
  @IsOptional()
  agentInvoke?: boolean
}

export class AccountBatchTransferDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]

  @ApiProperty({ description: '新负责人' })
  @IsString()
  @IsNotEmpty()
  owner!: string
}

export class AccountBatchToPoolDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]

  @ApiPropertyOptional({ description: '目标客户公海；为空时按负责人 Scope 匹配' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '移入公海原因 ID' })
  @IsString()
  @IsOptional()
  reasonId?: string
}

export class AccountToPoolDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reasonId?: string
}

export class AccountOptionPageDto {
  @ApiPropertyOptional({ default: 1 })
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string
}

export class AccountExportDto extends AccountPageDto {
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

export class AccountExportSelectDto {
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

export class AccountChartAxisDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldId!: string
}

export class AccountChartValueAxisDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fieldId?: string

  @ApiPropertyOptional({ enum: ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] })
  @IsIn(['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'])
  @IsOptional()
  aggregateMethod?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN'
}

export class AccountChartConfigDto {
  @ApiPropertyOptional({ description: '保持 Cordys chatType 字段名' })
  @IsString()
  @IsOptional()
  chatType?: string

  @ApiProperty({ type: AccountChartAxisDto })
  @ValidateNested()
  @Type(() => AccountChartAxisDto)
  categoryAxis!: AccountChartAxisDto

  @ApiPropertyOptional({ type: AccountChartAxisDto })
  @ValidateNested()
  @Type(() => AccountChartAxisDto)
  @IsOptional()
  subCategoryAxis?: AccountChartAxisDto

  @ApiProperty({ type: AccountChartValueAxisDto })
  @ValidateNested()
  @Type(() => AccountChartValueAxisDto)
  valueAxis!: AccountChartValueAxisDto
}

export class AccountChartDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiProperty({ type: AccountChartConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AccountChartConfigDto)
  chartConfig!: AccountChartConfigDto
}

export class AccountResourcePageDto {
  @ApiProperty({ description: '客户 ID' })
  @IsString()
  @IsNotEmpty()
  accountId!: string

  @ApiPropertyOptional({ default: 1 })
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number
}

export class PoolAccountPageDto extends AccountPageDto {
  @ApiProperty({ description: '客户公海 ID' })
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolAccountPickDto {
  @ApiProperty({ description: '客户 ID' })
  @IsString()
  @IsNotEmpty()
  customerId!: string

  @ApiProperty({ description: '客户公海 ID' })
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolAccountAssignDto {
  @ApiProperty({ description: '客户 ID' })
  @IsString()
  @IsNotEmpty()
  customerId!: string

  @ApiProperty({ description: '被分配成员 ID' })
  @IsString()
  @IsNotEmpty()
  assignUserId!: string
}

export class PoolAccountBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  batchIds!: string[]
}

export class PoolAccountBatchPickDto extends PoolAccountBatchDto {
  @ApiProperty({ description: '客户公海 ID' })
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolAccountBatchAssignDto extends PoolAccountBatchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assignUserId!: string
}

export class PoolAccountChartDto extends AccountChartDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolAccountExportDto extends AccountExportDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class AccountCollaborationAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId!: string

  @ApiProperty({ enum: ['READ_ONLY', 'COLLABORATION'] })
  @IsIn(['READ_ONLY', 'COLLABORATION'])
  collaborationType!: 'READ_ONLY' | 'COLLABORATION'
}

export class AccountCollaborationUpdateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ enum: ['READ_ONLY', 'COLLABORATION'] })
  @IsIn(['READ_ONLY', 'COLLABORATION'])
  collaborationType!: 'READ_ONLY' | 'COLLABORATION'
}
