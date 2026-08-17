import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import type { FilterOp } from '@micromatrix/shared'
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class SavedViewConditionDto {
  @ApiProperty({ description: '字段 key / field id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  field!: string

  @ApiProperty({
    enum: ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'],
    description: '当前元数据筛选引擎支持的操作符',
  })
  @IsIn(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'])
  operator!: FilterOp

  @ApiPropertyOptional({ description: '条件值，直接按 JSON 类型保存' })
  @IsOptional()
  value?: unknown

  @ApiPropertyOptional({ description: '字段类型快照，用于前端还原筛选控件' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  fieldType?: string

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  multipleValue?: boolean

  @ApiPropertyOptional({ type: [String], description: '部门等树形条件的包含下级 ID' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  containChildIds?: string[]
}

export class CreateSavedViewDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string

  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND' })
  @IsIn(['AND', 'OR'])
  @IsOptional()
  searchMode?: 'AND' | 'OR'

  @ApiPropertyOptional({ type: [SavedViewConditionDto] })
  @Type(() => SavedViewConditionDto)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  conditions?: SavedViewConditionDto[]
}

export class UpdateSavedViewDto extends PartialType(CreateSavedViewDto) {}

export class ReorderSavedViewsDto {
  @ApiProperty({ type: [String], description: '按最终显示顺序传入视图 ID' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[]
}

export class SavedViewSortDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort!: number
}
