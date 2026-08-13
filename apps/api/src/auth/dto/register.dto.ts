import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @ApiProperty({ description: '企业/团队名称', example: '微矩阵科技' })
  @IsString()
  @IsNotEmpty({ message: '企业名称不能为空' })
  @MaxLength(50)
  tenantName!: string

  @ApiProperty({ description: '管理员姓名', example: '张三' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(30)
  name!: string

  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password!: string
}
