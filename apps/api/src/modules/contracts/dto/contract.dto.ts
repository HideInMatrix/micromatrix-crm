import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
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

export class CreateContractDto {
  @ApiProperty({ description: '合同名称' })
  @IsString()
  @IsNotEmpty({ message: '合同名称不能为空' })
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

  @ApiPropertyOptional({ description: '从报价单创建（复制明细与金额）' })
  @IsString()
  @IsOptional()
  fromQuoteId?: string

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  signedAt?: string

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startAt?: string

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  endAt?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional({ type: [LineItemDto] })
  @IsArray()
  @Type(() => LineItemDto)
  @ValidateNested({ each: true })
  @IsOptional()
  items?: LineItemDto[]

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateContractDto extends PartialType(CreateContractDto) {}

export class QueryContractsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'EXECUTING', 'COMPLETED', 'TERMINATED'] })
  @IsIn(['DRAFT', 'EXECUTING', 'COMPLETED', 'TERMINATED'])
  @IsOptional()
  status?: 'DRAFT' | 'EXECUTING' | 'COMPLETED' | 'TERMINATED'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  filters?: string
}

export class ChangeContractStatusDto {
  @ApiProperty({ enum: ['EXECUTING', 'COMPLETED', 'TERMINATED'] })
  @IsIn(['EXECUTING', 'COMPLETED', 'TERMINATED'])
  status!: 'EXECUTING' | 'COMPLETED' | 'TERMINATED'
}
