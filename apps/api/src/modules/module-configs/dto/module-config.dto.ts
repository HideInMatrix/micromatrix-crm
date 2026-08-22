import { NAVIGATION_MODULES, TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn } from 'class-validator'

const moduleKeys = NAVIGATION_MODULES.map(({ key }) => key)
const topNavigationKeys = TOP_NAVIGATION_DEFINITIONS.map(({ key }) => key)

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

export class ReorderTopNavigationConfigsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(topNavigationKeys, { each: true })
  navigationKeys!: string[]
}
