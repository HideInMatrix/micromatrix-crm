import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import type {
  FieldConfig,
  FieldType,
  HomeAnalyticsConfig,
  LeadStageConfig,
  ModuleFormProp,
} from '@micromatrix/shared'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
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
  listWidth?: number | null

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  hidden?: boolean

  @ApiPropertyOptional({ default: true, description: '是否在移动端表单中展示' })
  @IsBoolean()
  @IsOptional()
  mobile?: boolean
}

export class UpdateFieldDto extends PartialType(CreateFieldDto) {}

export class ReorderFieldsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[]
}

export class HomeAnalyticsConfigDto implements HomeAnalyticsConfig {
  @ApiPropertyOptional({ description: 'Lead 渠道维度字段 key' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  leadSourceFieldKey?: string

  @ApiPropertyOptional({ description: 'Customer 外部业务结果字段 key' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  customerResultFieldKey?: string

  @ApiPropertyOptional({
    type: [String],
    description: '结果字段命中值；为空表示该字段非空即算结果',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  customerResultValues?: string[]

  @ApiPropertyOptional({ description: 'Customer 结果发生时间字段 key，必须为 date/datetime' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  customerResultTimeFieldKey?: string

  @ApiPropertyOptional({ description: 'Customer 结果金额字段 key，必须为 number/currency' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  customerResultAmountFieldKey?: string
}

export class UpdateFormPropDto {
  @ApiPropertyOptional({ enum: [1, 2, 3, 4], description: 'PC 表单列布局' })
  @IsIn([1, 2, 3, 4])
  @IsOptional()
  layout?: 1 | 2 | 3 | 4

  @ApiPropertyOptional({ enum: ['top', 'left'], description: 'PC 表单字段标题位置' })
  @IsIn(['top', 'left'])
  @IsOptional()
  labelPos?: 'top' | 'left'

  @ApiPropertyOptional({ enum: ['small', 'medium', 'large'], description: 'PC 表单容器尺寸' })
  @IsIn(['small', 'medium', 'large'])
  @IsOptional()
  viewSize?: 'small' | 'medium' | 'large'

  @ApiPropertyOptional({
    enum: ['RESOURCE_POOL', 'ORGANIZATION'],
    description: 'Lead unique 字段入库校验范围',
  })
  @IsIn(['RESOURCE_POOL', 'ORGANIZATION'])
  @IsOptional()
  leadUniqueScope?: 'RESOURCE_POOL' | 'ORGANIZATION'

  @ApiPropertyOptional({ description: 'Lead 可配置业务阶段；数组顺序即流程顺序' })
  @IsArray()
  @IsOptional()
  leadStages?: LeadStageConfig[]

  @ApiPropertyOptional({ type: HomeAnalyticsConfigDto, description: '首页业务分析配置' })
  @ValidateNested()
  @Type(() => HomeAnalyticsConfigDto)
  @IsOptional()
  homeAnalytics?: HomeAnalyticsConfig
}

export class SaveFormFieldDto extends CreateFieldDto {
  @ApiPropertyOptional({ description: '既有字段 ID；新增字段不传' })
  @IsString()
  @IsOptional()
  id?: string
}

export class SaveModuleFormDto {
  @ApiProperty({ type: [SaveFormFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveFormFieldDto)
  fields!: SaveFormFieldDto[]

  @ApiProperty({ description: '完整表单属性' })
  @IsObject()
  formProp!: ModuleFormProp
}
