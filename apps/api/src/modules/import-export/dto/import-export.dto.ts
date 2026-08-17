import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export const IMPORT_TYPES = ['ADD', 'UPDATE'] as const
export type ImportType = (typeof IMPORT_TYPES)[number]

export class ImportUploadDto {
  @ApiProperty({ enum: IMPORT_TYPES })
  @IsIn(IMPORT_TYPES)
  importType!: ImportType

  @ApiPropertyOptional({ description: '池/公海导入时必填' })
  @IsString()
  @IsOptional()
  poolId?: string
}

export class ExportCreateDto {
  @ApiProperty({ description: '不含 .xlsx 后缀的文件名' })
  @IsString()
  @MaxLength(50)
  fileName!: string

  @ApiProperty({ type: [String], description: '按顺序导出的字段 key' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  headList!: string[]
}

export class ExportSelectDto extends ExportCreateDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[]
}
