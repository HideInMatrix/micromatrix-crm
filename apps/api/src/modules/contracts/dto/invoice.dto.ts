import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class TitleDto {
  @ApiPropertyOptional({ description: '关联客户（空为通用抬头）' })
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiProperty({ description: '发票抬头' })
  @IsString()
  @IsNotEmpty({ message: '抬头名称不能为空' })
  @MaxLength(100)
  name!: string

  @ApiProperty({ description: '税号' })
  @IsString()
  @IsNotEmpty({ message: '税号不能为空' })
  @MaxLength(30)
  taxNo!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  bankName?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(40)
  bankAccount?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  address?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  contractId!: string

  @ApiPropertyOptional({ description: '工商抬头' })
  @IsString()
  @IsOptional()
  titleId?: string

  @ApiProperty({ description: '开票金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number

  @ApiPropertyOptional({ description: '发票类型' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  type?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remark?: string
}

export class IssueInvoiceDto {
  @ApiProperty({ description: '发票号码' })
  @IsString()
  @IsNotEmpty({ message: '发票号码不能为空' })
  @MaxLength(30)
  invoiceNo!: string
}
