import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class SaveEnterpriseGlobalTaskDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string

  @IsIn(['manual', 'cron'])
  triggerType!: 'manual' | 'cron'

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  executionCondition?: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  executionAction?: string

  @IsIn(['ask', 'auto', 'only_analysis'])
  confirmationLevel!: 'ask' | 'auto' | 'only_analysis'

  @IsOptional()
  @IsString()
  applicableModelId?: string | null

  @IsBoolean()
  enable!: boolean
}

export class UpdateEnterpriseGlobalTaskStatusDto {
  @IsBoolean()
  enable!: boolean
}
