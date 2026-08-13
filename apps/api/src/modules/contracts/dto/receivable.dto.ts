import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  contractId!: string

  @ApiProperty({ description: '计划回款金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number

  @ApiProperty({ description: '计划回款日期' })
  @IsDateString()
  dueDate!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remark?: string
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remark?: string
}

export class CreateRecordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  contractId!: string

  @ApiPropertyOptional({ description: '关联回款计划' })
  @IsString()
  @IsOptional()
  planId?: string

  @ApiProperty({ description: '实际回款金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number

  @ApiProperty({ description: '回款日期' })
  @IsDateString()
  receivedAt!: string

  @ApiPropertyOptional({ description: '回款方式' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  method?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remark?: string
}
