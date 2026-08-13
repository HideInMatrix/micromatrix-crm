import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateCustomerDto {
  @ApiProperty({ description: '客户名称' })
  @IsString()
  @IsNotEmpty({ message: '客户名称不能为空' })
  @MaxLength(100)
  name!: string

  @ApiPropertyOptional({ description: '所属行业' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  industry?: string

  @ApiPropertyOptional({ description: '联系电话' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string

  @ApiPropertyOptional({ description: '邮箱' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string

  @ApiPropertyOptional({ description: '负责人（默认当前用户）' })
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional({ description: '自定义字段值（cf_* 键）' })
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}
