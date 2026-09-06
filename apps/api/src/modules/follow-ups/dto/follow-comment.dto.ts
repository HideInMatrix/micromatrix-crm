import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class FollowCommentPageDto {
  @ApiProperty({ description: '跟进记录 ID' })
  @IsString()
  @IsNotEmpty()
  resourceId!: string

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 10
}

export class AddFollowCommentDto {
  @ApiProperty({ description: '跟进记录 ID' })
  @IsString()
  @IsNotEmpty()
  resourceId!: string

  @ApiPropertyOptional({ description: '顶层评论 ID；回复时使用' })
  @IsString()
  @IsOptional()
  parentId?: string

  @ApiPropertyOptional({ description: '被回复成员 ID' })
  @IsString()
  @IsOptional()
  replyToUserId?: string

  @ApiProperty({ description: '评论内容', maxLength: 3000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  content!: string

  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsOptional()
  mentionedUserIds?: string[]
}

export class UpdateFollowCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ maxLength: 3000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  content!: string

  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsOptional()
  mentionedUserIds?: string[]
}
