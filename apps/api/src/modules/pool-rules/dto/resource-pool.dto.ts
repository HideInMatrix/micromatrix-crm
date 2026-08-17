import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export type PoolModule = 'lead' | 'customer'

export class ResourcePoolPickRuleDto {
  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  limitDailyPick?: boolean

  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  dailyPickLimit?: number

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  limitPreviousOwner?: boolean

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  previousOwnerCooldownDays?: number

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  limitNewData?: boolean

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  newDataCooldownDays?: number
}

export class ResourcePoolRecycleConditionDto {
  @ApiProperty({ enum: ['storageTime', 'followUpTime'] })
  @IsIn(['storageTime', 'followUpTime'])
  column!: 'storageTime' | 'followUpTime'

  @ApiProperty({ enum: ['FIXED', 'DYNAMICS'] })
  @IsIn(['FIXED', 'DYNAMICS'])
  operator!: 'FIXED' | 'DYNAMICS'

  @ApiProperty({
    description:
      'FIXED: start,end；DYNAMICS: TODAY/LAST_SEVEN/... 或 CUSTOM,30,BEFORE_DAY',
  })
  @IsString()
  @IsNotEmpty()
  value!: string

  @ApiPropertyOptional({
    type: [String],
    enum: ['Created', 'Picked'],
    description: '仅 storageTime 生效',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(['Created', 'Picked'], { each: true })
  @IsOptional()
  scope?: ('Created' | 'Picked')[]
}

export class ResourcePoolRecycleRuleDto {
  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND' })
  @IsIn(['AND', 'OR'])
  @IsOptional()
  operator?: 'AND' | 'OR'

  @ApiPropertyOptional({
    description: 'Cordys 语义的专用时间回收条件',
    type: [ResourcePoolRecycleConditionDto],
  })
  @Type(() => ResourcePoolRecycleConditionDto)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  conditions?: ResourcePoolRecycleConditionDto[]
}

export class CreateResourcePoolDto {
  @ApiProperty({ enum: ['lead', 'customer'] })
  @IsIn(['lead', 'customer'])
  module!: PoolModule

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string

  @ApiPropertyOptional({ type: [String], description: '范围 token：* / user:<id> / dept:<id>' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  scopeIds?: string[]

  @ApiPropertyOptional({ type: [String], description: '管理员范围 token' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  managerIds?: string[]

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  autoRecycle?: boolean

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  hiddenFieldIds?: string[]

  @ApiPropertyOptional({ type: ResourcePoolPickRuleDto })
  @Type(() => ResourcePoolPickRuleDto)
  @ValidateNested()
  @IsOptional()
  pickRule?: ResourcePoolPickRuleDto

  @ApiPropertyOptional({ type: ResourcePoolRecycleRuleDto })
  @Type(() => ResourcePoolRecycleRuleDto)
  @ValidateNested()
  @IsOptional()
  recycleRule?: ResourcePoolRecycleRuleDto
}

export class UpdateResourcePoolDto extends PartialType(CreateResourcePoolDto) {}

export class ResourceCapacityFilterDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string

  @ApiProperty({
    enum: ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'],
  })
  @IsIn(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'])
  op!: 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'isEmpty' | 'notEmpty'

  @ApiPropertyOptional({ description: '筛选值；isEmpty/notEmpty 不需要传' })
  @IsOptional()
  value?: unknown
}

export class CreateResourceCapacityDto {
  @ApiProperty({ enum: ['lead', 'customer'] })
  @IsIn(['lead', 'customer'])
  module!: PoolModule

  @ApiProperty({ type: [String], description: '适用范围 token' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  scopeIds!: string[]

  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  capacity!: number

  @ApiPropertyOptional({
    description: '客户库容排除过滤条件；命中条件的数据不计入库容',
    type: [ResourceCapacityFilterDto],
  })
  @Type(() => ResourceCapacityFilterDto)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  filters?: ResourceCapacityFilterDto[]
}

export class UpdateResourceCapacityDto extends PartialType(CreateResourceCapacityDto) {}

export class MoveToResourcePoolDto {
  @ApiPropertyOptional({ description: '目标池；不传时匹配默认池' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '退池原因字典 ID' })
  @IsString()
  @IsOptional()
  reasonId?: string
}
