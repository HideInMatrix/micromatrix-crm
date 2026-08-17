import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class CustomerMergeDto {
  @ApiProperty({ type: [String], description: '被合并客户 ID；可包含目标客户，服务端会自动排除' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  mergeIds!: string[]

  @ApiProperty({ description: '最终保留的客户 ID' })
  @IsString()
  @IsNotEmpty()
  toMergeId!: string

  @ApiProperty({ description: '合并完成后的客户负责人' })
  @IsString()
  @IsNotEmpty()
  ownerId!: string

  @ApiPropertyOptional({
    enum: ['KEEP_ALL', 'SKIP_DUPLICATES'],
    default: 'KEEP_ALL',
    description: '联系人冲突策略；默认全部保留，也可跳过与主客户已有姓名/电话重复的源联系人',
  })
  @IsIn(['KEEP_ALL', 'SKIP_DUPLICATES'])
  @IsOptional()
  contactConflictStrategy?: 'KEEP_ALL' | 'SKIP_DUPLICATES' = 'KEEP_ALL'
}
