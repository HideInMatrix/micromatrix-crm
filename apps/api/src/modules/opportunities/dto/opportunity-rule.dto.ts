import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
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

export class OpportunityRuleConditionDto {
  @ApiProperty({ enum: ['createTime', 'opportunityStage'] })
  @IsIn(['createTime', 'opportunityStage'])
  column!: 'createTime' | 'opportunityStage'

  @ApiProperty({ enum: ['FIXED', 'DYNAMICS', 'IN', 'NOT_IN'] })
  @IsIn(['FIXED', 'DYNAMICS', 'IN', 'NOT_IN'])
  operator!: 'FIXED' | 'DYNAMICS' | 'IN' | 'NOT_IN'

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  value!: string

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scope?: string[]
}

export class OpportunityRulePageDto {
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
}

export class OpportunityRuleAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scopeIds!: string[]

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ownerIds!: string[]

  @ApiProperty()
  @IsBoolean()
  enable!: boolean

  @ApiProperty()
  @IsBoolean()
  auto!: boolean

  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND' })
  @IsIn(['AND', 'OR'])
  @IsOptional()
  operator?: 'AND' | 'OR'

  @ApiPropertyOptional({ type: [OpportunityRuleConditionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpportunityRuleConditionDto)
  @IsOptional()
  conditions?: OpportunityRuleConditionDto[]
}

export class OpportunityRuleUpdateDto extends PartialType(OpportunityRuleAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  id!: string
}

