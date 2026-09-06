import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger'
import type { FilterCondition } from '@micromatrix/shared'
import { Type } from 'class-transformer'
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

const TARGET_TYPES = ['lead', 'customer', 'opportunity'] as const

export class FollowUpRecordModuleFieldValueDto {
  @ApiProperty({ description: '动态字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class CreateFollowUpDto {
  @ApiProperty({ enum: TARGET_TYPES })
  @IsIn(TARGET_TYPES)
  targetType!: (typeof TARGET_TYPES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiPropertyOptional({ description: '联系人 ID' })
  @IsString()
  @IsOptional()
  contactId?: string

  @ApiPropertyOptional({ description: '负责人；省略时为当前用户' })
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional({ description: '跟进方式：电话/拜访/微信/邮件/会议/其他' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  type?: string

  @ApiProperty({ description: '跟进内容' })
  @IsString()
  @IsNotEmpty({ message: '跟进内容不能为空' })
  @MaxLength(3000)
  content!: string

  @ApiPropertyOptional({ description: '实际跟进时间；省略时使用当前时间' })
  @IsDateString()
  @IsOptional()
  followedAt?: string

  @ApiPropertyOptional({ type: [FollowUpRecordModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FollowUpRecordModuleFieldValueDto)
  @IsOptional()
  moduleFields?: FollowUpRecordModuleFieldValueDto[]

  @ApiPropertyOptional({ description: '计划转记录时的来源计划 ID' })
  @IsString()
  @IsOptional()
  sourcePlanId?: string
}

export class UpdateFollowUpDto extends PartialType(
  OmitType(CreateFollowUpDto, ['sourcePlanId', 'contactId', 'type', 'followedAt'] as const),
) {
  @ApiPropertyOptional({ description: '联系人 ID；null 表示清空', nullable: true })
  @IsString()
  @IsOptional()
  contactId?: string | null

  @ApiPropertyOptional({ description: '跟进方式；null 表示清空', nullable: true })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  type?: string | null

  @ApiPropertyOptional({ description: '实际跟进时间；null 表示清空', nullable: true })
  @IsDateString()
  @IsOptional()
  followedAt?: string | null
}

export class FollowUpRecordSortDto {
  @ApiProperty({ description: '排序字段 ID 或 key' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  type!: 'asc' | 'desc'
}

export class FollowUpRecordPageDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TARGET_TYPES })
  @IsIn(TARGET_TYPES)
  @IsOptional()
  targetType?: (typeof TARGET_TYPES)[number]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetId?: string

  @ApiPropertyOptional({ description: '仅查看当前负责人记录' })
  @IsBoolean()
  @IsOptional()
  mine?: boolean

  @ApiPropertyOptional({ description: '用户视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '临时高级筛选' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND' })
  @IsIn(['AND', 'OR'])
  @IsOptional()
  filterMode?: 'AND' | 'OR'

  @ApiPropertyOptional({ type: FollowUpRecordSortDto })
  @ValidateNested()
  @Type(() => FollowUpRecordSortDto)
  @IsOptional()
  sort?: FollowUpRecordSortDto
}
