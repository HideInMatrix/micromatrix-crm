import { Transform } from 'class-transformer'
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export const AI_PROVIDERS = [
  'OpenAI',
  'DeepSeek',
  '阿里云',
  'Anthropic',
  '腾讯云',
  '自定义',
] as const

export class SaveEnterpriseAiModelDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  displayName!: string

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  modelName!: string

  @IsIn(AI_PROVIDERS)
  provider!: (typeof AI_PROVIDERS)[number]

  @Transform(trimString)
  @IsUrl({ require_protocol: true }, { message: 'API Base URL 必须是完整 URL' })
  @MaxLength(1024)
  apiUrl!: string

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  apiKey?: string

  @IsBoolean()
  enable!: boolean

  @IsNumber()
  @Min(0)
  @Max(1)
  temperature!: number

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxTokens!: number

  @IsNumber()
  @Min(0)
  @Max(1)
  topP!: number

  @IsOptional()
  @IsInt()
  @Min(1)
  globalDailyLimit?: number | null

  @IsOptional()
  @IsInt()
  @Min(1)
  userDailyLimit?: number | null
}

export class UpdateEnterpriseAiModelStatusDto {
  @IsBoolean()
  enable!: boolean
}

export class UpdateEnterpriseAiRouteStrategyDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  modelIds!: string[]
}
