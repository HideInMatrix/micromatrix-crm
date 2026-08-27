import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export const DICTIONARY_MODULES = ['CLUE_POOL_RS', 'CUSTOMER_POOL_RS', 'OPPORTUNITY_FAIL_RS'] as const
export type DictionaryModule = (typeof DICTIONARY_MODULES)[number]

export class DictionaryAddDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty({ enum: DICTIONARY_MODULES })
  @IsIn(DICTIONARY_MODULES)
  module!: DictionaryModule
}

export class DictionaryUpdateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string
}

export class DictionarySwitchDto {
  @ApiProperty({ enum: DICTIONARY_MODULES })
  @IsIn(DICTIONARY_MODULES)
  module!: DictionaryModule

  @ApiProperty()
  @IsBoolean()
  enable!: boolean
}

export class DictionarySortDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  start!: number

  @ApiProperty()
  @IsInt()
  @Min(1)
  end!: number

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dragDictId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  module?: DictionaryModule
}
