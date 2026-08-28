import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdatePersonalApiKeyDto {
  @IsString()
  id!: string

  @IsBoolean()
  forever!: boolean

  @IsOptional()
  @IsNumber()
  expireTime?: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string
}
