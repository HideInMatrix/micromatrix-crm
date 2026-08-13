import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

/** 报价/合同的明细行 */
export class LineItemDto {
  @ApiPropertyOptional({ description: '关联产品（可选，支持自由行）' })
  @IsString()
  @IsOptional()
  productId?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '产品名称不能为空' })
  @MaxLength(100)
  productName!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  unit?: string

  @ApiProperty()
  @IsNumber()
  @Min(0)
  quantity!: number

  @ApiProperty()
  @IsNumber()
  @Min(0)
  unitPrice!: number

  @ApiPropertyOptional({ description: '折扣百分比，100=不打折', default: 100 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number
}
