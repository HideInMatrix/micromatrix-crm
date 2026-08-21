import { NAVIGATION_MODULES } from '@micromatrix/shared'
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn } from 'class-validator'

const moduleKeys = NAVIGATION_MODULES.map(({ key }) => key)

export class UpdateModuleConfigDto {
  @IsBoolean()
  enabled!: boolean
}

export class ReorderModuleConfigsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(moduleKeys, { each: true })
  moduleKeys!: string[]
}
