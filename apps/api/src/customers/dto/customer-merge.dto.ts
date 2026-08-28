import { ApiProperty } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
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
}
