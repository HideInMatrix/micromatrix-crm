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

export class AccountPoolPageDto {
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

export class AccountPoolPickRuleDto {
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

export class AccountPoolRecycleConditionDto {
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

export class AccountPoolRecycleRuleDto {
  @ApiProperty({ enum: ['AND', 'OR'] })
  @IsIn(['AND', 'OR'])
  operator!: 'AND' | 'OR'

  @ApiProperty({ type: [AccountPoolRecycleConditionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountPoolRecycleConditionDto)
  conditions!: AccountPoolRecycleConditionDto[]
}

export class AccountPoolAddDto {
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

  @ApiProperty({ type: AccountPoolPickRuleDto })
  @ValidateNested()
  @Type(() => AccountPoolPickRuleDto)
  pickRule!: AccountPoolPickRuleDto

  @ApiProperty({ type: AccountPoolRecycleRuleDto })
  @ValidateNested()
  @Type(() => AccountPoolRecycleRuleDto)
  recycleRule!: AccountPoolRecycleRuleDto

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  hiddenFieldIds?: string[]
}

export class AccountPoolUpdateDto extends AccountPoolAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class AccountCapacityFilterDto {
  @ApiProperty({ enum: ['stage'] })
  @IsIn(['stage'])
  column!: 'stage'

  @ApiProperty({ enum: ['IN', 'NOT_IN'] })
  @IsIn(['IN', 'NOT_IN'])
  operator!: 'IN' | 'NOT_IN'

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  value!: string[]
}

export class AccountCapacityAddDto {
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

  @ApiPropertyOptional({ type: [AccountCapacityFilterDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountCapacityFilterDto)
  @IsOptional()
  filters?: AccountCapacityFilterDto[]
}

export class AccountCapacityUpdateDto extends AccountCapacityAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}
