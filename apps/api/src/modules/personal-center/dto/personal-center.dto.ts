import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class UpdatePersonalInfoDto {
  @ApiProperty({ description: '手机号', maxLength: 11 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(11)
  phone!: string

  @ApiProperty({ description: '邮箱' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty()
  email!: string
}

export class ResetPersonalPasswordDto {
  @ApiProperty({ description: '原密码' })
  @IsString()
  @IsNotEmpty()
  originPassword!: string

  @ApiProperty({ description: '新密码' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  password!: string
}

export class PersonalPlanPageDto {
  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  current?: number

  @ApiPropertyOptional({ default: 10 })
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ enum: ['PREPARED', 'UNDERWAY', 'COMPLETED', 'CANCELLED'] })
  @IsIn(['PREPARED', 'UNDERWAY', 'COMPLETED', 'CANCELLED'])
  @IsOptional()
  status?: 'PREPARED' | 'UNDERWAY' | 'COMPLETED' | 'CANCELLED'

  // Cordys 请求中存在 sourceId；个人中心固定 myPlan=true，本实现只保留兼容字段，不参与越权范围计算。
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sourceId?: string
}
