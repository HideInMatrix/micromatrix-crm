import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class CreateOrderDto {
  @ApiProperty({ description: '订单名称' })
  @IsString()
  @IsNotEmpty({ message: '订单名称不能为空' })
  @MaxLength(100)
  name!: string

  @ApiProperty({ description: '关联合同' })
  @IsString()
  @IsNotEmpty({ message: '请选择合同' })
  contractId!: string

  @ApiPropertyOptional({ description: '订单金额' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}

export class QueryOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'DELIVERING', 'ACCEPTED', 'COMPLETED', 'CANCELED'] })
  @IsIn(['PENDING', 'DELIVERING', 'ACCEPTED', 'COMPLETED', 'CANCELED'])
  @IsOptional()
  status?: 'PENDING' | 'DELIVERING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELED'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contractId?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  filters?: string
}

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: ['DELIVERING', 'ACCEPTED', 'COMPLETED', 'CANCELED'] })
  @IsIn(['DELIVERING', 'ACCEPTED', 'COMPLETED', 'CANCELED'])
  status!: string
}
