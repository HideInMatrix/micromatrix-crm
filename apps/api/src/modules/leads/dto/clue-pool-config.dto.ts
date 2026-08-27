import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
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

export class CluePoolPageRequestDto {
  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 20 })
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string
}

export class CluePoolPickRuleDto {
  @ApiProperty()
  @IsBoolean()
  limitOnNumber!: boolean

  @ApiPropertyOptional({ nullable: true })
  @IsInt()
  @Min(1)
  @IsOptional()
  pickNumber?: number | null

  @ApiProperty()
  @IsBoolean()
  limitPreOwner!: boolean

  @ApiPropertyOptional({ nullable: true })
  @IsInt()
  @Min(1)
  @IsOptional()
  pickIntervalDays?: number | null

  @ApiProperty()
  @IsBoolean()
  limitNew!: boolean

  @ApiPropertyOptional({ nullable: true })
  @IsInt()
  @Min(1)
  @IsOptional()
  newPickInterval?: number | null
}

export class CluePoolRecycleConditionDto {
  @ApiProperty({ enum: ['storageTime', 'followUpTime'] })
  @IsIn(['storageTime', 'followUpTime'])
  column!: 'storageTime' | 'followUpTime'

  @ApiProperty({ enum: ['FIXED', 'DYNAMICS'] })
  @IsIn(['FIXED', 'DYNAMICS'])
  operator!: 'FIXED' | 'DYNAMICS'

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  value!: string

  @ApiPropertyOptional({ type: [String], enum: ['Created', 'Picked'] })
  @IsArray()
  @ArrayUnique()
  @IsIn(['Created', 'Picked'], { each: true })
  @IsOptional()
  scope?: ('Created' | 'Picked')[]
}

export class CluePoolRecycleRuleDto {
  @ApiProperty({ enum: ['AND', 'OR'] })
  @IsIn(['AND', 'OR'])
  operator!: 'AND' | 'OR'

  @ApiProperty({ type: [CluePoolRecycleConditionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CluePoolRecycleConditionDto)
  conditions!: CluePoolRecycleConditionDto[]
}

export class CluePoolAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  scopeIds!: string[]

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  ownerIds!: string[]

  @ApiProperty()
  @IsBoolean()
  enable!: boolean

  @ApiProperty()
  @IsBoolean()
  auto!: boolean

  @ApiProperty({ type: CluePoolPickRuleDto })
  @ValidateNested()
  @Type(() => CluePoolPickRuleDto)
  pickRule!: CluePoolPickRuleDto

  @ApiProperty({ type: CluePoolRecycleRuleDto })
  @ValidateNested()
  @Type(() => CluePoolRecycleRuleDto)
  recycleRule!: CluePoolRecycleRuleDto

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  hiddenFieldIds?: string[]
}

export class CluePoolUpdateDto extends CluePoolAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class ClueCapacityAddDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  scopeIds!: string[]

  @ApiPropertyOptional({ nullable: true })
  @IsInt()
  @Min(0)
  @IsOptional()
  capacity?: number | null
}

export class ClueCapacityUpdateDto extends ClueCapacityAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}
