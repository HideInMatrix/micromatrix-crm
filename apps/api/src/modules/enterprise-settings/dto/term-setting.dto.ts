import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class SaveEnterpriseTermCategoryDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sort?: number
}

export class SaveEnterpriseTermDto {
  @IsString()
  @MinLength(1)
  categoryId!: string

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  standardTerm!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  alsoCalled?: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  avoidThese?: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  useCase?: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  systemReference?: string

  @IsBoolean()
  enable!: boolean
}

export class UpdateEnterpriseTermStatusDto {
  @IsBoolean()
  enable!: boolean
}
