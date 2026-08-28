import type { FilterCondition } from '@micromatrix/shared'
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class CreateContactDto {
  @ApiPropertyOptional({ description: '所属客户；独立联系人允许为空' })
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional({ description: '联系人负责人；不传时默认当前用户' })
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}

export class UpdateContactRequestDto extends UpdateContactDto {
  @ApiProperty({ description: '联系人 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class QueryContactsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '客户详情内嵌列表时指定' })
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsIn(['true', 'false'])
  @IsOptional()
  enable?: 'true' | 'false'

  @ApiPropertyOptional({ description: '高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string

  @ApiPropertyOptional({ description: '保存的用户视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ enum: ['SELF', 'DEPT', 'ALL'], description: '联系人内置数据范围视图' })
  @IsIn(['SELF', 'DEPT', 'ALL'])
  @IsOptional()
  scopeView?: 'SELF' | 'DEPT' | 'ALL'
}

export class DisableContactDto {
  @ApiProperty({ description: '停用原因' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string
}

export class ContactModuleFieldValueDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown
}

export class ContactSortDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiProperty({ enum: ['asc', 'desc', 'ASC', 'DESC'] })
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  direction!: 'asc' | 'desc' | 'ASC' | 'DESC'
}

export class ContactPageDto {
  @ApiPropertyOptional({ default: 1 })
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 10, maximum: 500 })
  @Min(1)
  @Max(500)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '个人视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ description: '当前临时筛选条件' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ enum: ['SELF', 'DEPT', 'ALL'] })
  @IsIn(['SELF', 'DEPT', 'ALL'])
  @IsOptional()
  scopeView?: 'SELF' | 'DEPT' | 'ALL'

  @ApiPropertyOptional({ type: ContactSortDto })
  @ValidateNested()
  @Type(() => ContactSortDto)
  @IsOptional()
  sort?: ContactSortDto
}

export class ContactAddDto {
  @ApiPropertyOptional({ description: '客户 ID；独立联系人允许为空' })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional({ description: '负责人；为空时默认当前用户' })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  owner?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string

  @ApiPropertyOptional({ type: [ContactModuleFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactModuleFieldValueDto)
  @IsOptional()
  moduleFields?: ContactModuleFieldValueDto[]
}

export class ContactUpdateDto extends PartialType(ContactAddDto) {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class ContactExportDto extends ContactPageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]
}

export class ContactExportSelectDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class ContactChartAxisDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldId!: string
}

export class ContactChartValueAxisDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fieldId?: string

  @ApiPropertyOptional({ enum: ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] })
  @IsIn(['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'])
  @IsOptional()
  aggregateMethod?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN'
}

export class ContactChartConfigDto {
  @ApiProperty({ type: ContactChartAxisDto })
  @ValidateNested()
  @Type(() => ContactChartAxisDto)
  categoryAxis!: ContactChartAxisDto

  @ApiPropertyOptional({ type: ContactChartAxisDto })
  @ValidateNested()
  @Type(() => ContactChartAxisDto)
  @IsOptional()
  subCategoryAxis?: ContactChartAxisDto

  @ApiProperty({ type: ContactChartValueAxisDto })
  @ValidateNested()
  @Type(() => ContactChartValueAxisDto)
  valueAxis!: ContactChartValueAxisDto
}

export class ContactChartDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ enum: ['SELF', 'DEPT', 'ALL'] })
  @IsIn(['SELF', 'DEPT', 'ALL'])
  @IsOptional()
  scopeView?: 'SELF' | 'DEPT' | 'ALL'

  @ApiProperty({ type: ContactChartConfigDto })
  @ValidateNested()
  @Type(() => ContactChartConfigDto)
  chartConfig!: ContactChartConfigDto
}
