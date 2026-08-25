import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

const BATCH_STATUSES = [
  'FETCHING',
  'PREVIEW_READY',
  'APPLYING',
  'SUCCEEDED',
  'FAILED',
  'INVALIDATED',
] as const
const RESOURCE_TYPES = ['DEPARTMENT', 'USER'] as const
const ACTIONS = ['CREATE', 'UPDATE', 'DISABLE', 'UNCHANGED', 'CONFLICT', 'SKIP'] as const

export class CreateOrganizationSyncPreviewDto {
  @IsString()
  @MaxLength(64)
  targetDepartmentId!: string
}

export class QueryOrganizationSyncBatchesDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(BATCH_STATUSES)
  status?: (typeof BATCH_STATUSES)[number]
}

export class QueryOrganizationSyncItemsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(RESOURCE_TYPES)
  resourceType?: (typeof RESOURCE_TYPES)[number]

  @IsOptional()
  @IsIn(ACTIONS)
  action?: (typeof ACTIONS)[number]
}

export class ResolveOrganizationSyncItemDto {
  @IsString()
  @MaxLength(64)
  itemId!: string

  @IsIn(['BIND', 'SKIP'])
  resolution!: 'BIND' | 'SKIP'

  @IsOptional()
  @IsString()
  @MaxLength(64)
  localId?: string
}

export class ResolveOrganizationSyncDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ResolveOrganizationSyncItemDto)
  items!: ResolveOrganizationSyncItemDto[]
}
