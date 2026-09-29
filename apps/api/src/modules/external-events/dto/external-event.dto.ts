import { ApiProperty } from '@nestjs/swagger'
import { IsObject, IsString, MaxLength, MinLength } from 'class-validator'

export class ApplyExternalCustomerEventDto {
  @ApiProperty({ example: 'finance-system' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  source!: string

  @ApiProperty({ example: 'PAY-20260928-00001' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalEventId!: string

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
