import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { FilterOp } from '@micromatrix/shared'
import { Type } from 'class-transformer'
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

const FILTER_OPERATORS: FilterOp[] = [
  'eq',
  'ne',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'isEmpty',
  'notEmpty',
]

export class UserViewConditionDto {
  @ApiProperty({ description: 'Cordys 条件字段名 / 动态字段 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty({ enum: FILTER_OPERATORS })
  @IsIn(FILTER_OPERATORS)
  operator!: FilterOp

  @ApiPropertyOptional({ description: '条件值；仅接受标量、标量数组或 null' })
  @IsOptional()
  value?: unknown

  @ApiPropertyOptional({ description: 'Cordys 字段类型快照' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  type?: string

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  multipleValue?: boolean

  @ApiPropertyOptional({ type: [String], description: '树选择中勾选“包含下级”的节点 ID' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  containChildIds?: string[]
}

export class CreateUserViewDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND' })
  @IsIn(['AND', 'OR'])
  @IsOptional()
  searchMode?: 'AND' | 'OR'

  @ApiPropertyOptional({ type: [UserViewConditionDto] })
  @Type(() => UserViewConditionDto)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  conditions?: UserViewConditionDto[]
}

export class UpdateUserViewDto extends CreateUserViewDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class EditUserViewPosDto {
  @ApiProperty({ description: '当前组织 ID；服务端仍以认证上下文为准' })
  @IsString()
  @IsNotEmpty()
  orgId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  moveId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiProperty({ enum: ['BEFORE', 'AFTER'] })
  @IsIn(['BEFORE', 'AFTER'])
  moveMode!: 'BEFORE' | 'AFTER'
}
