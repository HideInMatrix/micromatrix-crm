import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class MoveToResourcePoolDto {
  @ApiPropertyOptional({ description: '目标池；不传时按负责人范围匹配' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '退池原因字典 ID' })
  @IsString()
  @IsOptional()
  reasonId?: string
}
