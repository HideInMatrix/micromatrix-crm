import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class BatchIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}

export class BatchAssignOwnerDto extends BatchIdsDto {
  @ApiProperty()
  @IsString()
  ownerId!: string
}

export class BatchMoveToPoolDto extends BatchIdsDto {
  @ApiPropertyOptional({ description: '目标池；不传时按每条资源原负责人 Scope 匹配' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '退池原因字典 ID' })
  @IsString()
  @IsOptional()
  reasonId?: string
}

export class BatchClaimDto extends BatchIdsDto {
  @ApiPropertyOptional({ description: '指定池 ID；传入时要求所有资源均属于该池' })
  @IsString()
  @IsOptional()
  poolId?: string
}

/** Cordys ResourceBatchEditRequest 语义：批量把一个字段修改为同一个值。 */
export class ResourceBatchEditDto extends BatchIdsDto {
  @ApiProperty({ description: '元数据字段 ID 或字段 key' })
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional({ description: '目标字段值；可选字段允许传 null 清空' })
  @IsOptional()
  fieldValue?: unknown
}

export class PoolBatchIdsDto extends BatchIdsDto {
  @ApiProperty({ description: '所选资源所属的同一个池 ID' })
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export class PoolResourceBatchEditDto extends ResourceBatchEditDto {
  @ApiProperty({ description: '所选资源所属的同一个池 ID' })
  @IsString()
  @IsNotEmpty()
  poolId!: string
}

export interface BatchAffectResult {
  success: number
  fail: number
  failedIds: string[]
}
