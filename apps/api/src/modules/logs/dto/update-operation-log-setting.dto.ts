import { ApiProperty } from '@nestjs/swagger'
import { IsInt, Max, Min, ValidateIf } from 'class-validator'
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from '../operation-log-settings.service'

export class UpdateOperationLogSettingDto {
  @ApiProperty({
    description: `操作日志保留天数；null 表示永久保留，数字范围 ${MIN_RETENTION_DAYS}～${MAX_RETENTION_DAYS}`,
    nullable: true,
    example: 180,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(MIN_RETENTION_DAYS)
  @Max(MAX_RETENTION_DAYS)
  retentionDays!: number | null
}
