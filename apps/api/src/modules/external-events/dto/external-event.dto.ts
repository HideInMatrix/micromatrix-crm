import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class ApplyExternalCustomerEventDto {
  @ApiProperty({ example: 'finance-system' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  source!: string

  @ApiPropertyOptional({
    example: 'PAY-20260928-00001',
    description: '可选幂等键；不填由服务端自动生成。同一次业务请求重试时建议复用原编号。',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalEventId?: string

  @ApiProperty({
    example: { studentName: '张三', phone: '13800000000' },
    description: '本次资源定位字段，固定 AND 精确匹配；字段由租户表单定义',
  })
  @IsObject()
  where!: Record<string, unknown>

  @ApiProperty({
    example: { status: '已缴费' },
    description: 'Customer 动态字段更新；只允许当前表单中的可写非系统字段',
  })
  @IsObject()
  set!: Record<string, unknown>
}

/** Template-driven, API Key only. */
export class ExecuteConfiguredExternalEventDto {
  /** Retained only for old integrations; the configured template determines the source. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,79}$/)
  source?: string

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  eventType!: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalEventId?: string

  @IsObject()
  data!: Record<string, unknown>
}
