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
  'picture',
  'location',
  'attachment',
  'data_source',
  'data_source_multiple',
  'sub_product',
  'formula',
] as const

const SUB_FIELD_TYPES = [
  'text',
  'number',
  'currency',
  'percent',
  'select',
  'multiselect',
  'data_source',
  'formula',
  'picture',
  'datetime',
  'member',
  'dept',
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

export class SubFieldDto {
  @ApiPropertyOptional({ description: '既有子字段 ID；新建时可省略，由服务端生成' })
  @IsString()
  @IsOptional()
  id?: string

  @ApiPropertyOptional({ description: '既有子字段 key；新建时可省略，由服务端生成' })
  @IsString()
  @IsOptional()
  key?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '子字段名称不能为空' })
  @MaxLength(30)
  label!: string

  @ApiProperty({ enum: SUB_FIELD_TYPES })
  @IsIn(SUB_FIELD_TYPES)
  type!: (typeof SUB_FIELD_TYPES)[number]

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  required?: boolean

  @ApiPropertyOptional({ type: [FieldOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldOptionDto)
  @IsOptional()
  options?: FieldOptionDto[]

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  config?: FieldConfig
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

  @ApiPropertyOptional({ description: 'SUB_PRODUCT 子列', type: [SubFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubFieldDto)
  @IsOptional()
  subFields?: SubFieldDto[]

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
