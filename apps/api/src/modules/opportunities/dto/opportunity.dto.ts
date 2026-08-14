import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
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
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stageId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional({ description: '高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string
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

export class StageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '阶段名称不能为空' })
  @MaxLength(30)
  name!: string

  @ApiProperty({ description: '赢率 0-100' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  probability!: number
}

export class UpdateStageDto extends PartialType(StageDto) {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  _placeholder?: boolean
}

export class ReorderStagesDto {
  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  orderedIds!: string[]
}
