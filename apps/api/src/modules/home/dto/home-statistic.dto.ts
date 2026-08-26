import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  HOME_SEARCH_TYPES,
  HOME_TIME_FIELDS,
  HOME_USER_FIELDS,
  type HomeSearchType,
  type HomeTimeField,
  type HomeUserField,
} from '@micromatrix/shared'
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator'

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

  @ApiPropertyOptional({ enum: ['EXPECTED_END_TIME', 'ACTUAL_END_TIME'] })
  @IsOptional()
  @IsIn(['EXPECTED_END_TIME', 'ACTUAL_END_TIME'])
  winOrderTimeField?: 'EXPECTED_END_TIME' | 'ACTUAL_END_TIME'

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  priorPeriodEnable?: boolean
}
