import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  HOME_SEARCH_TYPES,
  HOME_TIME_FIELDS,
  HOME_USER_FIELDS,
  type HomeSearchType,
  type HomeTimeField,
  type HomeUserField,
  type HomeWidgetPeriod,
} from '@micromatrix/shared'
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator'

export class HomeStatisticSearchDto {
  @ApiProperty({ enum: HOME_SEARCH_TYPES })
  @IsIn(HOME_SEARCH_TYPES)
  searchType!: HomeSearchType

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  deptIds!: string[]

  @ApiPropertyOptional({ enum: HOME_TIME_FIELDS })
  @IsOptional()
  @IsIn(HOME_TIME_FIELDS)
  timeField?: HomeTimeField

  @ApiPropertyOptional({ enum: HOME_USER_FIELDS })
  @IsOptional()
  @IsIn(HOME_USER_FIELDS)
  userField?: HomeUserField

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  priorPeriodEnable?: boolean

  @ApiPropertyOptional({ description: '首页统计组件的临时时间筛选，key 为组件 ID，value 为 7d/30d/all' })
  @IsOptional()
  @IsObject()
  widgetPeriods?: Record<string, HomeWidgetPeriod>
}
