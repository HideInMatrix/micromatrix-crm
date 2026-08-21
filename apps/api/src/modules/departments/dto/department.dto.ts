import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateDepartmentDto {
  @ApiProperty({ description: '部门名称' })
  @IsString()
  @IsNotEmpty({ message: '部门名称不能为空' })
  @MaxLength(50)
  name!: string

  @ApiPropertyOptional({ description: '上级部门 id' })
  @IsString()
  @IsOptional()
  parentId?: string | null

  @ApiPropertyOptional({ description: '部门主管用户 id' })
  @IsString()
  @IsOptional()
  leaderId?: string | null

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sort?: number
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}
