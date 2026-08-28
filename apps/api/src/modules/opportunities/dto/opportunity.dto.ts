import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
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
import { LineItemDto } from '../../../common/dto/line-item.dto'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import type { FilterCondition } from '@micromatrix/shared'

export class OpportunityModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional({ description: '动态字段值' })
  @IsOptional()
  fieldValue?: unknown
}

export class OpportunityAddDto {
  @ApiProperty({ description: '商机名称' })
  @IsString()
  @IsNotEmpty({ message: '商机名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ description: '客户 ID' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  customerId?: string

  @ApiPropertyOptional({ description: '金额' })
  @IsNumber()
  @IsOptional()
  amount?: number

  @ApiPropertyOptional({ description: '意向产品 ID', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  products?: string[]

  @ApiPropertyOptional({ description: '可能性' })
  @IsNumber()
  @IsOptional()
  possible?: number

  @ApiPropertyOptional({ description: '联系人 ID' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  contactId?: string

  @ApiPropertyOptional({ description: '负责人；为空时默认当前用户' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  owner?: string

  @ApiPropertyOptional({ description: '预计结束时间，毫秒时间戳' })
  @IsNumber()
  @IsOptional()
  expectedEndTime?: number

  @ApiPropertyOptional({ type: [OpportunityModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpportunityModuleFieldValueDto)
  @IsOptional()
  moduleFields?: OpportunityModuleFieldValueDto[]

  @ApiPropertyOptional({ description: '最新跟进人' })
  @IsString()
  @IsOptional()
  follower?: string

  @ApiPropertyOptional({ description: '最新跟进时间，毫秒时间戳' })
  @IsNumber()
  @IsOptional()
  followTime?: number
}

export class OpportunityUpdateDto extends PartialType(OpportunityAddDto) {
  @ApiProperty({ description: '商机 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string

  @ApiPropertyOptional({ description: 'Agent 调用标记' })
  @IsBoolean()
  @IsOptional()
  agentInvoke?: boolean
}

export class OpportunityPageDto {
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

  @ApiPropertyOptional({ description: '个人视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ description: '首页统计跳转条件 JSON' })
  @IsString()
  @IsOptional()
  homeFilter?: string

  @ApiPropertyOptional({ description: '看板模式' })
  @IsBoolean()
  @IsOptional()
  board?: boolean = false
}

export class OpportunityStatisticDto extends OpportunityPageDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string
}

export class OpportunityExportDto extends OpportunityPageDto {
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

export class OpportunityExportSelectDto {
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

  @ApiProperty({ description: '选中的商机 ID', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class OpportunityChartAxisDto {
  @ApiProperty({ description: '字段 ID' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string
}

export class OpportunityChartValueAxisDto {
  @ApiPropertyOptional({ description: '字段 ID；COUNT 时可为空' })
  @IsString()
  @IsOptional()
  fieldId?: string

  @ApiPropertyOptional({ enum: ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'], default: 'COUNT' })
  @IsString()
  @IsOptional()
  aggregateMethod?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN'
}

export class OpportunityChartConfigDto {
  @ApiPropertyOptional({ description: '图表类型；保持 Cordys 字段名 chatType' })
  @IsString()
  @IsOptional()
  chatType?: string

  @ApiProperty({ type: OpportunityChartAxisDto })
  @ValidateNested()
  @Type(() => OpportunityChartAxisDto)
  categoryAxis!: OpportunityChartAxisDto

  @ApiPropertyOptional({ type: OpportunityChartAxisDto })
  @ValidateNested()
  @Type(() => OpportunityChartAxisDto)
  @IsOptional()
  subCategoryAxis?: OpportunityChartAxisDto

  @ApiProperty({ type: OpportunityChartValueAxisDto })
  @ValidateNested()
  @Type(() => OpportunityChartValueAxisDto)
  valueAxis!: OpportunityChartValueAxisDto
}

export class OpportunityChartDto {
  @ApiPropertyOptional({ description: '个人视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '当前筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiProperty({ type: OpportunityChartConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OpportunityChartConfigDto)
  chartConfig!: OpportunityChartConfigDto
}

export class OpportunityTransferDto {
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

export class OpportunityStageUpdateDto {
  @ApiProperty({ description: '商机 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ description: '目标阶段 ID' })
  @IsString()
  @IsNotEmpty()
  stage!: string

  @ApiPropertyOptional({ description: '失败原因' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  failureReason?: string
}

export class OpportunityBoardSortDto {
  @ApiProperty({ description: '被拖拽商机 ID' })
  @IsString()
  @IsNotEmpty()
  dragNodeId!: string

  @ApiPropertyOptional({ description: '目标商机 ID；为空时放入阶段尾部' })
  @IsString()
  @IsOptional()
  dropNodeId?: string

  @ApiProperty({ description: '-1=目标前，1=目标后' })
  @Type(() => Number)
  @IsInt()
  dropPosition!: number

  @ApiProperty({ description: '目标阶段 ID' })
  @IsString()
  @IsNotEmpty()
  stage!: string

  @ApiPropertyOptional({ description: '阶段切换时同步更新的字段值' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpportunityModuleFieldValueDto)
  @IsOptional()
  fields?: OpportunityModuleFieldValueDto[]
}

export class CreateOpportunityDto {
  @ApiProperty({ description: '商机名称' })
  @IsString()
  @IsNotEmpty({ message: '商机名称不能为空' })
  @MaxLength(100)
  name!: string

  @ApiProperty({ description: '关联客户' })
  @IsString()
  @IsNotEmpty({ message: '请选择客户' })
  customerId!: string

  @ApiPropertyOptional({ description: '关联联系人；必须属于当前客户' })
  @IsString()
  @IsOptional()
  contactId?: string

  @ApiPropertyOptional({ description: '阶段（默认第一个阶段）' })
  @IsString()
  @IsOptional()
  stageId?: string

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  amount?: number

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  expectedCloseAt?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>

  @ApiPropertyOptional({ type: [LineItemDto], description: '产品明细' })
  @IsOptional()
  @IsArray()
  @Type(() => LineItemDto)
  @ValidateNested({ each: true })
  items?: LineItemDto[]
}

export class UpdateOpportunityDto extends PartialType(CreateOpportunityDto) {}

export class QueryOpportunitiesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '个人视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stageId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contactId?: string

  @ApiPropertyOptional({ description: '高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string

  @ApiPropertyOptional({ description: '首页一次性统计跳转筛选（HomeFilterPayload JSON）' })
  @IsString()
  @IsOptional()
  homeFilter?: string
}

export class ChangeStageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  stageId!: string

  @ApiPropertyOptional({ description: '输单原因（进入输单阶段时必填）' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  lostReason?: string
}

export class OpportunityStageAddDto {
  @ApiProperty({ description: '阶段名称' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  name!: string

  @ApiPropertyOptional({ enum: ['AFOOT', 'END'], default: 'AFOOT' })
  @IsString()
  @IsOptional()
  type?: 'AFOOT' | 'END'

  @ApiProperty({ description: '赢率 0-100' })
  @IsString()
  @IsNotEmpty()
  rate!: string

  @ApiProperty({ description: '-1=目标前，1=目标后' })
  @Type(() => Number)
  @IsInt()
  dropPosition!: number

  @ApiPropertyOptional({ description: '相对插入目标阶段 ID' })
  @IsString()
  @IsOptional()
  targetId?: string
}

export class OpportunityStageEditDto {
  @ApiProperty({ description: '阶段 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiPropertyOptional({ description: '阶段名称' })
  @IsString()
  @IsOptional()
  @MaxLength(16)
  name?: string

  @ApiPropertyOptional({ description: '赢率 0-100' })
  @IsString()
  @IsOptional()
  rate?: string
}

export class OpportunityStageRollbackDto {
  @ApiProperty({ description: '进行中阶段是否允许回退' })
  @IsBoolean()
  afootRollBack!: boolean

  @ApiProperty({ description: '完结阶段是否允许回退' })
  @IsBoolean()
  endRollBack!: boolean
}
