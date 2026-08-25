import { MESSAGE_TASK_DEFINITIONS, type MessageTaskModule } from '@micromatrix/shared'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

const MESSAGE_MODULES = [...new Set(MESSAGE_TASK_DEFINITIONS.map((item) => item.module))]

export class MessageReminderTimeDto {
  @IsInt()
  @Min(1)
  timeValue!: number

  @IsIn(['DAY'])
  timeUnit!: 'DAY'
}

export class MessageTaskConfigDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageReminderTimeDto)
  timeList!: MessageReminderTimeDto[]

  @IsArray()
  @IsString({ each: true })
  userIds!: string[]

  @IsArray()
  @IsString({ each: true })
  roleIds!: string[]

  @IsBoolean()
  ownerEnable!: boolean

  @IsInt()
  @Min(0)
  @Max(10000)
  ownerLevel!: number

  @IsBoolean()
  roleEnable!: boolean
}

export class UpdateMessageTaskSettingDto {
  @IsIn(MESSAGE_MODULES)
  module!: MessageTaskModule

  @IsOptional()
  @IsBoolean()
  systemEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  weComEnabled?: boolean

  @IsOptional()
  @ValidateNested()
  @Type(() => MessageTaskConfigDto)
  config?: MessageTaskConfigDto
}

export class BatchUpdateMessageTaskSettingDto {
  @IsOptional()
  @IsBoolean()
  systemEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  weComEnabled?: boolean
}
