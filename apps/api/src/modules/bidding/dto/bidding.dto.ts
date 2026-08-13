import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class QueryBiddingDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  type?: string
}

export class SaveSourceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  provider!: string

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean

  @ApiPropertyOptional({ description: '数据源凭证（API Key 等）' })
  @IsObject()
  @IsOptional()
  credentials?: Record<string, unknown>
}

export class AddKeywordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '关键词不能为空' })
  @MaxLength(30)
  keyword!: string
}

export class ImportBiddingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200)
  title!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  type?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  region?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  buyer?: string

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  budget?: number

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  publishedAt?: string

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  deadline?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sourceUrl?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  content?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  keyword?: string
}
