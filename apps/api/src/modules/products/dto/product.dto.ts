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

export class CreateProductDto {
  @ApiProperty({ description: '产品名称' })
  @IsString()
  @IsNotEmpty({ message: '产品名称不能为空' })
  @MaxLength(100)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  code?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  category?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  unit?: string

  @ApiPropertyOptional({ description: '标准售价' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number

  @ApiPropertyOptional({ description: '成本价' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  cost?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class QueryProductsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ON', 'OFF'] })
  @IsIn(['ON', 'OFF'])
  @IsOptional()
  status?: 'ON' | 'OFF'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  filters?: string
}
