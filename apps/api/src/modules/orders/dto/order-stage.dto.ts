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

export class OrderStageAddDto {
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

export class OrderStageUpdateDto {
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

export class OrderStageRollbackDto {
  @ApiProperty()
  @IsBoolean()
  afootRollBack!: boolean

  @ApiProperty()
  @IsBoolean()
  endRollBack!: boolean
}

export class OrderStageAdvancedTargetDto {
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

export class OrderStageAdvancedRowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  originId!: string

  @ApiProperty({ type: [OrderStageAdvancedTargetDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderStageAdvancedTargetDto)
  targets!: OrderStageAdvancedTargetDto[]
}

export class OrderStageAdvancedConfigDto {
  @ApiProperty({ enum: ['NORMAL', 'ADVANCED'] })
  @IsIn(['NORMAL', 'ADVANCED'])
  circulationType!: 'NORMAL' | 'ADVANCED'

  @ApiProperty({ type: [OrderStageAdvancedRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderStageAdvancedRowDto)
  circulationSettings!: OrderStageAdvancedRowDto[]
}
