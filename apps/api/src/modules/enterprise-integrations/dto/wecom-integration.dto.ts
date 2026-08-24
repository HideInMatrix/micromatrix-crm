import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class SaveWeComIntegrationDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  corpId!: string

  @Transform(trimString)
  @IsString()
  @Matches(/^\d+$/, { message: '应用 ID 必须为数字' })
  @MaxLength(32)
  agentId!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  appSecret?: string
}

export class UpdateWeComSyncDto {
  @IsBoolean()
  enabled!: boolean

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  defaultRoleId?: string
}
