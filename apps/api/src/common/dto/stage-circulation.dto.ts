import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class StageCirculationFieldValueDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldId!: string

  @ApiPropertyOptional()
  @IsOptional()
  fieldValue?: unknown

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  required?: boolean

  @ApiPropertyOptional({ enum: ['FIXED_VALUE', 'FIELD_VALUE'] })
  @IsIn(['FIXED_VALUE', 'FIELD_VALUE'])
  @IsOptional()
  valueType?: 'FIXED_VALUE' | 'FIELD_VALUE'
}
