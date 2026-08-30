import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import type { FilterCondition } from '@micromatrix/shared'
import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export const FOLLOW_UP_PLAN_TARGET_TYPES = ['lead', 'customer', 'opportunity'] as const
export const FOLLOW_UP_PLAN_STATUSES = [
  'PREPARED',
  'UNDERWAY',
  'COMPLETED',
  'CANCELLED',
] as const

export class FollowUpPlanModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class CreateFollowUpPlanDto {
  @ApiProperty({ enum: FOLLOW_UP_PLAN_TARGET_TYPES })
  @IsIn(FOLLOW_UP_PLAN_TARGET_TYPES)
  targetType!: (typeof FOLLOW_UP_PLAN_TARGET_TYPES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contactId?: string

  @ApiProperty({ description: '计划内容' })
  @IsString()
  @IsNotEmpty({ message: '计划内容不能为空' })
  @MaxLength(3000)
  content!: string

  @ApiPropertyOptional({ description: '跟进方式' })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  method?: string

  @ApiPropertyOptional({ description: '计划跟进时间' })
  @IsDateString()
  @IsOptional()
  estimatedAt?: string

  @ApiPropertyOptional({ description: '负责人；省略时为当前用户' })
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional({ type: [FollowUpPlanModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FollowUpPlanModuleFieldValueDto)
  @IsOptional()
  moduleFields?: FollowUpPlanModuleFieldValueDto[]
}

export class UpdateFollowUpPlanDto extends PartialType(CreateFollowUpPlanDto) {}

export class QueryFollowUpPlansDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FOLLOW_UP_PLAN_TARGET_TYPES })
  @IsIn(FOLLOW_UP_PLAN_TARGET_TYPES)
  @IsOptional()
  targetType?: (typeof FOLLOW_UP_PLAN_TARGET_TYPES)[number]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetId?: string

  @ApiPropertyOptional({ enum: FOLLOW_UP_PLAN_STATUSES })
  @IsIn(FOLLOW_UP_PLAN_STATUSES)
  @IsOptional()
  status?: (typeof FOLLOW_UP_PLAN_STATUSES)[number]

  @ApiPropertyOptional({ description: '仅查看当前负责人计划' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  mine?: boolean

  @ApiPropertyOptional({ description: '高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]
}

export class UpdateFollowUpPlanStatusDto {
  @ApiProperty({ enum: FOLLOW_UP_PLAN_STATUSES })
  @IsIn(FOLLOW_UP_PLAN_STATUSES)
  status!: (typeof FOLLOW_UP_PLAN_STATUSES)[number]
}
