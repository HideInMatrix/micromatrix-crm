import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class SaveDingTalkIntegrationDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  corpId!: string

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientId!: string

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  agentId!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  appSecret?: string
}

export class UpdateDingTalkSyncDto {
  @IsBoolean()
  enabled!: boolean

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  defaultRoleId?: string
}
