import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import type { DataScope } from '../../../generated/prisma/client'

const DATA_SCOPES = ['ALL', 'DEPT_AND_CHILD', 'DEPT', 'SELF', 'CUSTOM'] as const

export class CreateRoleDto {
  @ApiProperty({ description: '角色名称' })
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  @MaxLength(30)
  name!: string

  @ApiProperty({ description: '权限码集合', type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissions!: string[]

  @ApiProperty({ enum: DATA_SCOPES, default: 'SELF' })
  @IsIn(DATA_SCOPES)
  dataScope!: DataScope

  @ApiPropertyOptional({ description: '自定义数据范围的部门 id 集合', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopeDeptIds?: string[]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remark?: string
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
