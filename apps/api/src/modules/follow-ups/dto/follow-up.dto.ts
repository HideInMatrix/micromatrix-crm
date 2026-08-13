import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

const TARGET_TYPES = ['lead', 'customer', 'opportunity', 'contract'] as const

export class CreateFollowUpDto {
  @ApiProperty({ enum: TARGET_TYPES })
  @IsIn(TARGET_TYPES)
  targetType!: (typeof TARGET_TYPES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiProperty({ description: '跟进方式：电话/拜访/微信/邮件/会议/其他' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  type!: string

  @ApiProperty({ description: '跟进内容' })
  @IsString()
  @IsNotEmpty({ message: '跟进内容不能为空' })
  @MaxLength(2000)
  content!: string

  @ApiPropertyOptional({ description: '下次跟进时间' })
  @IsDateString()
  @IsOptional()
  nextFollowAt?: string
}

export class QueryFollowUpsDto {
  @ApiProperty({ enum: TARGET_TYPES })
  @IsIn(TARGET_TYPES)
  targetType!: (typeof TARGET_TYPES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string
}
