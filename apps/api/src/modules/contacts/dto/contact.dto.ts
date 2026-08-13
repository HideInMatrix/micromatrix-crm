import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateContactDto {
  @ApiProperty({ description: '所属客户' })
  @IsString()
  @IsNotEmpty()
  customerId!: string

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(30)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  position?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string

  @ApiPropertyOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}
