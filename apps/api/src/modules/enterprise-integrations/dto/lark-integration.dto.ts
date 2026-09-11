import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class SaveLarkIntegrationDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  corpId!: string

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  agentId!: string

  @Transform(trimString)
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  redirectUrl!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  appSecret?: string
}

export class UpdateLarkSyncDto {
  @IsBoolean()
  enabled!: boolean

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  defaultRoleId?: string
}
