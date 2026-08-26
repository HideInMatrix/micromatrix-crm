import { ApiProperty } from '@nestjs/swagger'
import { IsString, MinLength } from 'class-validator'

export class ChangePasswordDto {
  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6, { message: '原密码至少 6 位' })
  oldPassword!: string

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword!: string
}
