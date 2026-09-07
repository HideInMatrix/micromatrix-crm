import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class QueryAnnouncementsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 20

  @IsOptional()
  @IsString()
  @MaxLength(255)
  keyword?: string
}

export class SaveAnnouncementDto {
  @IsString()
  @MaxLength(255)
  subject!: string

  @IsString()
  @MaxLength(1000)
  content!: string

  @IsISO8601()
  startAt!: string

  @IsISO8601()
  endAt!: string

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(255)
  linkName?: string | null

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  departmentIds!: string[]

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds!: string[]
}
