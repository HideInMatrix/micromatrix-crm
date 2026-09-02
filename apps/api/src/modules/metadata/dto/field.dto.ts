import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import type { FieldConfig, FieldType } from '@micromatrix/shared'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'switch',
  'member',
  'dept',
  'phone',
  'email',
  'formula',
] as const

export class FieldOptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '选项名称不能为空' })
  label!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '选项值不能为空' })
  value!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  color?: string
}

export class CreateFieldDto {
  @ApiProperty({ description: '字段名称' })
  @IsString()
  @IsNotEmpty({ message: '字段名称不能为空' })
  @MaxLength(30)
  label!: string

  @ApiProperty({ enum: FIELD_TYPES })
  @IsIn(FIELD_TYPES)
  type!: FieldType

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  required?: boolean

  @ApiPropertyOptional({ description: '选项集（select/radio 等）', type: [FieldOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldOptionDto)
  @IsOptional()
  options?: FieldOptionDto[]

  @ApiPropertyOptional({ description: '扩展配置（placeholder/公式等）' })
  @IsObject()
  @IsOptional()
  config?: FieldConfig

  @ApiPropertyOptional({ default: 12, description: '表单栅格宽度（24 制）' })
  @IsInt()
  @Min(6)
  @Max(24)
  @IsOptional()
  span?: number

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  showInList?: boolean

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  listWidth?: number

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  hidden?: boolean
}

export class UpdateFieldDto extends PartialType(CreateFieldDto) {}

export class ReorderFieldsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[]
}
