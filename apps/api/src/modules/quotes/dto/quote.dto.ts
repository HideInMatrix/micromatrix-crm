import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { LineItemDto } from '../../../common/dto/line-item.dto'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class CreateQuoteDto {
  @ApiProperty({ description: '报价主题' })
  @IsString()
  @IsNotEmpty({ message: '报价主题不能为空' })
  @MaxLength(100)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '请选择客户' })
  customerId!: string

  @ApiPropertyOptional({ description: '关联商机' })
  @IsString()
  @IsOptional()
  opportunityId?: string

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  validUntil?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiProperty({ type: [LineItemDto], description: '明细行' })
  @IsArray()
  @ArrayMinSize(1, { message: '至少添加一行明细' })
  @Type(() => LineItemDto)
  @ValidateNested({ each: true })
  items!: LineItemDto[]

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateQuoteDto extends PartialType(CreateQuoteDto) {}

export class QueryQuotesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'CONFIRMED', 'VOID'] })
  @IsIn(['DRAFT', 'CONFIRMED', 'VOID'])
  @IsOptional()
  status?: 'DRAFT' | 'CONFIRMED' | 'VOID'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  filters?: string
}
