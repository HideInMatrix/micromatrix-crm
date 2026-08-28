import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class DashboardSortDto {
  @ApiProperty({ enum: ['create_time', 'name', 'dashboard_module_name', 'create_user_name', 'pos'] })
  @IsIn(['create_time', 'name', 'dashboard_module_name', 'create_user_name', 'pos'])
  name!: 'create_time' | 'name' | 'dashboard_module_name' | 'create_user_name' | 'pos'

  @ApiProperty({ enum: ['asc', 'desc', 'ASC', 'DESC'] })
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  type!: 'asc' | 'desc' | 'ASC' | 'DESC'
}

export class DashboardPageDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  current?: number

  @ApiPropertyOptional({ default: 10, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  keyword?: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  dashboardModuleIds?: string[]

  @ApiPropertyOptional({ type: DashboardSortDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardSortDto)
  sort?: DashboardSortDto
}

export class DashboardAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsUrl({ require_protocol: true }, { message: 'resourceUrl must be a valid URL' })
  resourceUrl!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dashboardModuleId!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  scopeIds!: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string
}

export class DashboardUpdateDto extends DashboardAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class DashboardRenameDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dashboardModuleId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string
}

export class DashboardEditPosDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dashboardModuleId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  moveId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiProperty({ enum: ['BEFORE', 'AFTER', 'APPEND'] })
  @IsIn(['BEFORE', 'AFTER', 'APPEND'])
  moveMode!: 'BEFORE' | 'AFTER' | 'APPEND'
}

export class DashboardModuleAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  parentId!: string
}

export class DashboardModuleRenameDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string
}

export class DashboardModuleMoveDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dragNodeId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dropNodeId!: string

  @ApiProperty({ enum: [-1, 0, 1] })
  @IsIn([-1, 0, 1])
  dropPosition!: -1 | 0 | 1
}
