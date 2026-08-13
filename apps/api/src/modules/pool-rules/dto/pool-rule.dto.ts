import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator'

export class UpdatePoolRuleDto {
  @ApiProperty({ enum: ['lead', 'customer'] })
  @IsIn(['lead', 'customer'])
  module!: 'lead' | 'customer'

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean

  @ApiProperty({ description: '超过 N 天未跟进回收' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  recycleDays!: number

  @ApiProperty({ description: '回收前 N 天提醒' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  notifyDays!: number
}
