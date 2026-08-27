import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
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
import { Type } from 'class-transformer'
import type { FilterCondition } from '@micromatrix/shared'
import { CreateCustomerDto } from '../../../customers/dto/create-customer.dto'

export class ModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional({ description: '动态字段值' })
  @IsOptional()
  fieldValue?: unknown
}

export class ClueAddDto {
  @ApiProperty({ description: '线索名称' })
  @IsString()
  @IsNotEmpty({ message: '线索名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ description: '负责人；为空时默认当前用户' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  owner?: string

  @ApiPropertyOptional({ description: '联系人名称' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  contact?: string

  @ApiPropertyOptional({ description: '联系人电话' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string

  @ApiPropertyOptional({ description: '意向产品 ID', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  products?: string[]

  @ApiPropertyOptional({ description: '动态字段', type: [ModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ModuleFieldValueDto[]
}

export class ClueUpdateDto extends PartialType(ClueAddDto) {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string

  @ApiPropertyOptional({ description: 'Agent 调用标记；普通 Web 请求不传' })
  @IsBoolean()
  @IsOptional()
  agentInvoke?: boolean
}

export class ClueStatusUpdateDto {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ enum: ['NEW', 'FOLLOWING', 'INTERESTED', 'SUCCESS', 'FAIL'] })
  @IsIn(['NEW', 'FOLLOWING', 'INTERESTED', 'SUCCESS', 'FAIL'])
  stage!: 'NEW' | 'FOLLOWING' | 'INTERESTED' | 'SUCCESS' | 'FAIL'
}

export class ClueSortDto {
  @ApiProperty({ description: '字段 ID 或字段 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiProperty({ enum: ['asc', 'desc', 'ASC', 'DESC'] })
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  direction!: 'asc' | 'desc' | 'ASC' | 'DESC'
}

export class CluePageDto {
  @ApiPropertyOptional({ description: '当前页码', default: 1 })
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ description: '每页条数', default: 10, maximum: 500 })
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

  @ApiPropertyOptional({ description: '筛选条件' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ description: '首页统计一次性跳转条件 JSON' })
  @IsString()
  @IsOptional()
  homeFilter?: string

  @ApiPropertyOptional({ description: '排序字段' })
  @ValidateNested()
  @Type(() => ClueSortDto)
  @IsOptional()
  sort?: ClueSortDto
}

export class ClueBatchTransferDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[]

  @ApiProperty({ description: '新负责人' })
  @IsString()
  @IsNotEmpty()
  owner!: string
}

export class ClueExportDto extends CluePageDto {
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

export class ClueExportSelectDto {
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

  @ApiProperty({ description: '选中的线索 ID', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class ClueBatchToPoolDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[]

  @ApiPropertyOptional({ description: '目标线索池；为空时按原负责人 Scope 匹配默认池' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '退池原因 ID' })
  @IsString()
  @IsOptional()
  reasonId?: string
}

export class ClueToPoolDto {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiPropertyOptional({ description: '目标线索池' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '退池原因 ID' })
  @IsString()
  @IsOptional()
  reasonId?: string
}

export class TransformClueDto {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  clueId!: string

  @ApiPropertyOptional({ description: '是否同时创建商机' })
  @IsBoolean()
  @IsOptional()
  oppCreated?: boolean

  @ApiPropertyOptional({ description: '商机名称；oppCreated=true 时必填' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  oppName?: string
}

/** Cordys ClueTransitionCustomerRequest：客户新增表单 + clueId。 */
export class ClueTransitionCustomerDto extends CreateCustomerDto {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  clueId!: string
}

export class ClueRetransitionCustomerDto {
  @ApiProperty({ description: '线索 ID 集合', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  clueIds!: string[]

  @ApiProperty({ description: '目标客户 ID' })
  @IsString()
  @IsNotEmpty()
  customerId!: string
}

export class ClueTransitionCustomerPageDto {
  @ApiPropertyOptional({ description: '当前页码', default: 1 })
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ description: '每页条数', default: 10 })
  @Min(1)
  @Max(500)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '客户高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]
}

export class ClueChartAxisDto {
  @ApiProperty({ description: '字段 ID' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string
}

export class ClueChartValueAxisDto {
  @ApiPropertyOptional({ description: '字段 ID；COUNT 时可为空' })
  @IsString()
  @IsOptional()
  fieldId?: string

  @ApiPropertyOptional({ enum: ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'], default: 'COUNT' })
  @IsIn(['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'])
  @IsOptional()
  aggregateMethod?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN'
}

export class ClueChartConfigDto {
  @ApiPropertyOptional({ description: '图表类型；保持 Cordys 字段名 chatType' })
  @IsString()
  @IsOptional()
  chatType?: string

  @ApiProperty({ type: ClueChartAxisDto })
  @ValidateNested()
  @Type(() => ClueChartAxisDto)
  categoryAxis!: ClueChartAxisDto

  @ApiPropertyOptional({ type: ClueChartAxisDto })
  @ValidateNested()
  @Type(() => ClueChartAxisDto)
  @IsOptional()
  subCategoryAxis?: ClueChartAxisDto

  @ApiProperty({ type: ClueChartValueAxisDto })
  @ValidateNested()
  @Type(() => ClueChartValueAxisDto)
  valueAxis!: ClueChartValueAxisDto
}

export class ClueChartDto {
  @ApiPropertyOptional({ description: '个人视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '当前筛选；MicroMatrix 使用统一 FilterCondition[] 表达' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiProperty({ type: ClueChartConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ClueChartConfigDto)
  chartConfig!: ClueChartConfigDto
}

/** 仅供当前 pool Web 调用迁移使用；task 3.4 会按 Cordys Pool DTO 继续收口。 */
export class PoolCluePageDto extends CluePageDto {
  @ApiProperty({ description: '线索池 ID' })
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolCluePickDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clueId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolClueAssignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clueId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assignUserId!: string
}

export class PoolClueBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  batchIds!: string[]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  poolId?: string
}

export class PoolClueBatchAssignDto extends PoolClueBatchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assignUserId!: string
}
