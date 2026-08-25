import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

const DELIVERY_STATUSES = ['PENDING', 'SENDING', 'SUCCEEDED', 'FAILED', 'DEAD'] as const

export class QueryMessageDeliveriesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DELIVERY_STATUSES })
  @IsOptional()
  @IsIn(DELIVERY_STATUSES)
  status?: (typeof DELIVERY_STATUSES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  event?: string
}
