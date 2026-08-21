import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger'
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class CreateMemberDto {
  @ApiProperty()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(30)
  name!: string

  @ApiProperty({ description: '初始密码', minLength: 6 })
  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleId?: string | null

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deptId?: string | null

  @ApiPropertyOptional({ description: '直属上级' })
  @IsString()
  @IsOptional()
  leaderId?: string | null

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
}

export class UpdateMemberDto extends PartialType(OmitType(CreateMemberDto, ['email', 'password'])) {}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password!: string
}

export class QueryMembersDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deptId?: string

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsIn(['ACTIVE', 'DISABLED'])
  @IsOptional()
  status?: 'ACTIVE' | 'DISABLED'
}
