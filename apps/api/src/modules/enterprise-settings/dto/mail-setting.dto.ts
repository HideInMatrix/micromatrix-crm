import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class SaveEnterpriseMailSettingDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host!: string

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  account!: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string

  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  @ValidateIf((_, value) => value !== '')
  @IsEmail({}, { message: '发件人邮箱格式不正确' })
  from!: string

  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  @ValidateIf((_, value) => value !== '')
  @IsEmail({}, { message: '测试收件人邮箱格式不正确' })
  recipient!: string

  @IsBoolean()
  ssl!: boolean

  @IsBoolean()
  tls!: boolean
}

export class TestEnterpriseMailSettingDto extends SaveEnterpriseMailSettingDto {}
