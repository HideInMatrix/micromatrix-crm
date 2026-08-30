import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { StageCirculationFieldValueDto } from '../../../common/dto/stage-circulation.dto'

export class ContractStageAddDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ enum: ['AFOOT', 'END'] })
  @IsIn(['AFOOT', 'END'])
  @IsOptional()
  type?: 'AFOOT' | 'END'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetId?: string

  @ApiPropertyOptional({ description: '-1 放前面，1 放后面' })
  @IsInt()
  @IsOptional()
  dropPosition?: number
}

export class ContractStageUpdateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string
}

export class ContractStageRollbackDto {
  @ApiProperty()
  @IsBoolean()
  afootRollBack!: boolean

  @ApiProperty()
  @IsBoolean()
  endRollBack!: boolean
}

export class ContractStageAdvancedTargetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiProperty()
  @IsBoolean()
  enable!: boolean

  @ApiPropertyOptional({ type: [StageCirculationFieldValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StageCirculationFieldValueDto)
  @IsOptional()
  circulationFieldValues?: StageCirculationFieldValueDto[]
}

export class ContractStageAdvancedRowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  originId!: string

  @ApiProperty({ type: [ContractStageAdvancedTargetDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractStageAdvancedTargetDto)
  targets!: ContractStageAdvancedTargetDto[]
}

export class ContractStageAdvancedConfigDto {
  @ApiProperty({ enum: ['NORMAL', 'ADVANCED'] })
  @IsIn(['NORMAL', 'ADVANCED'])
  circulationType!: 'NORMAL' | 'ADVANCED'

  @ApiProperty({ type: [ContractStageAdvancedRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractStageAdvancedRowDto)
  circulationSettings!: ContractStageAdvancedRowDto[]
}
