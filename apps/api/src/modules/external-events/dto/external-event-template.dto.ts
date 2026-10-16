import { ApiProperty, PartialType } from '@nestjs/swagger'
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'
import type { ExternalEventTemplateConfig } from '@micromatrix/shared'

export class SaveExternalEventTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  eventType?: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,79}$/)
  source?: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  apiKeyUserId!: string

  @IsBoolean()
  enabled!: boolean

  @ApiProperty({ description: '受控动作配置：精确定位、客户字段映射、转换时客户归属' })
  @IsObject()
  config!: ExternalEventTemplateConfig
}

export class UpdateExternalEventTemplateDto extends PartialType(SaveExternalEventTemplateDto) {}

export class PreviewExternalEventDto {
  @IsObject()
  data!: Record<string, unknown>
}
