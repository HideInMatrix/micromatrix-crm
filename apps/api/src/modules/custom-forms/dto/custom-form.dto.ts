import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { FilterCondition } from '@micromatrix/shared'
import { Type } from 'class-transformer'
import {
  ArrayUnique,
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
} from 'class-validator'

export const CUSTOM_FORM_ROLE_KEYS = ['MANAGE_ALL', 'VIEW_ALL', 'MANAGE_OWN'] as const
export type CustomFormRoleKey = (typeof CUSTOM_FORM_ROLE_KEYS)[number]

export class SaveCustomFormDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '表单名称不能为空' })
  @MaxLength(50)
  name!: string

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  enable?: boolean

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  formProp?: Record<string, unknown>
}

export class UpdateCustomFormStatusDto {
  @ApiProperty()
  @IsBoolean()
  enable!: boolean
}

export class CustomFormUsersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  userIds!: string[]
}

export class CustomFormDataPageDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ type: [Object], description: '当前临时高级筛选，条件按 AND 合并' })
  @IsArray()
  @IsOptional()
  filters?: FilterCondition[]

  @ApiPropertyOptional({ description: '当前用户在该自定义表单下保存的视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string
}

export class SaveCustomFormDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '负责人不能为空' })
  ownerId!: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  values?: Record<string, unknown>
}

export class UpdateCustomFormRoleUsersDto extends CustomFormUsersDto {
  @ApiProperty({ enum: CUSTOM_FORM_ROLE_KEYS })
  @IsIn(CUSTOM_FORM_ROLE_KEYS)
  roleKey!: CustomFormRoleKey
}
