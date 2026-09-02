import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export const APPROVER_TYPES = [
  'USER',
  'ROLE',
  'DEPT_LEADER',
  'DIRECT_LEADER',
  'MULTIPLE_DEPT_LEADER',
  'MULTIPLE_DIRECT_LEADER',
] as const
export const APPROVAL_MODES = ['ALL', 'ANY'] as const
export const APPROVAL_FORM_TYPES = ['quotation', 'contract', 'invoice', 'order'] as const
export const APPROVAL_MODULES = ['quote', 'contract', 'invoice', 'order'] as const
export const DUPLICATE_APPROVER_RULES = ['FIRST_ONLY', 'SEQUENTIAL_ALL', 'EACH'] as const
export const EMPTY_APPROVER_ACTIONS = ['AUTO_PASS', 'ASSIGN_SPECIFIC', 'ASSIGN_ADMIN'] as const
export const SAME_SUBMITTER_ACTIONS = ['SKIP', 'ALLOW', 'ASSIGN_SUPERIOR'] as const
export const APPROVER_DIRECTIONS = ['BOTTOM_UP', 'TOP_DOWN'] as const
export const ADD_SIGN_TYPES = ['BEFORE', 'AFTER'] as const
export const APPROVAL_NODE_TYPES = ['START', 'APPROVER', 'CONDITION', 'DEFAULT', 'END'] as const
export const CONDITION_SEARCH_MODES = ['AND', 'OR'] as const
export const CONDITION_OPERATORS = [
  'DYNAMICS',
  'IN',
  'NOT_IN',
  'BETWEEN',
  'GT',
  'LT',
  'GE',
  'LE',
  'COUNT_GT',
  'COUNT_LT',
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'NOT_CONTAINS',
  'EMPTY',
  'NOT_EMPTY',
  'NOT_EQUAL_ORIGINAL',
] as const

export class FilterConditionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  multipleValue?: boolean

  @ApiProperty({ enum: CONDITION_OPERATORS })
  @IsIn(CONDITION_OPERATORS)
  operator!: (typeof CONDITION_OPERATORS)[number]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  type?: string | null

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  containChildIds?: string[]
}

export class CombineSearchDto {
  @ApiProperty({ enum: CONDITION_SEARCH_MODES })
  @IsIn(CONDITION_SEARCH_MODES)
  searchMode!: (typeof CONDITION_SEARCH_MODES)[number]

  @ApiProperty({ type: [FilterConditionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FilterConditionDto)
  conditions!: FilterConditionDto[]
}

export class FlowNodeDto {
  @ApiPropertyOptional({ description: '前端编辑期稳定键' })
  @IsString()
  @IsOptional()
  clientId?: string

  @ApiPropertyOptional({ enum: APPROVAL_NODE_TYPES, default: 'APPROVER' })
  @IsIn(APPROVAL_NODE_TYPES)
  @IsOptional()
  nodeType?: (typeof APPROVAL_NODE_TYPES)[number]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  number?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '节点名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional({ enum: APPROVER_TYPES })
  @IsIn(APPROVER_TYPES)
  @IsOptional()
  approverType?: (typeof APPROVER_TYPES)[number]

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  approverIds?: string[]

  @ApiPropertyOptional({ type: [String], description: '进入该节点时抄送的成员 ID' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ccUserIds?: string[]

  @ApiPropertyOptional({ enum: APPROVAL_MODES })
  @IsIn(APPROVAL_MODES)
  @IsOptional()
  mode?: (typeof APPROVAL_MODES)[number]

  @ApiPropertyOptional({ enum: EMPTY_APPROVER_ACTIONS, default: 'AUTO_PASS' })
  @IsIn(EMPTY_APPROVER_ACTIONS)
  @IsOptional()
  emptyApproverAction?: (typeof EMPTY_APPROVER_ACTIONS)[number]

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fallbackApprover?: string | null

  @ApiPropertyOptional({ enum: SAME_SUBMITTER_ACTIONS, default: 'SKIP' })
  @IsIn(SAME_SUBMITTER_ACTIONS)
  @IsOptional()
  sameSubmitterAction?: (typeof SAME_SUBMITTER_ACTIONS)[number]

  @ApiPropertyOptional({ enum: APPROVER_DIRECTIONS, default: 'BOTTOM_UP' })
  @IsIn(APPROVER_DIRECTIONS)
  @IsOptional()
  approverDirection?: (typeof APPROVER_DIRECTIONS)[number]

  @ApiPropertyOptional({ type: CombineSearchDto })
  @ValidateNested()
  @Type(() => CombineSearchDto)
  @IsOptional()
  conditionConfig?: CombineSearchDto | null
}

export class FlowLinkDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fromNodeId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  toNodeId!: string

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  sort?: number
}

export class FlowConditionDto {
  @ApiPropertyOptional({ description: '金额达到该值时进入审批' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amountGte?: number
}

export class CreateApprovalFlowDto {
  @ApiProperty({ enum: APPROVAL_FORM_TYPES })
  @IsIn(APPROVAL_FORM_TYPES)
  formType!: (typeof APPROVAL_FORM_TYPES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '流程名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string | null

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean

  @ApiProperty()
  @IsBoolean()
  createExecute!: boolean

  @ApiProperty()
  @IsBoolean()
  updateExecute!: boolean

  @ApiProperty()
  @IsBoolean()
  deleteExecute!: boolean

  @ApiProperty()
  @IsBoolean()
  submitterCanRevoke!: boolean

  @ApiProperty()
  @IsBoolean()
  allowBatchProcess!: boolean

  @ApiProperty()
  @IsBoolean()
  allowWithdraw!: boolean

  @ApiProperty()
  @IsBoolean()
  allowAddSign!: boolean

  @ApiProperty({ enum: DUPLICATE_APPROVER_RULES })
  @IsIn(DUPLICATE_APPROVER_RULES)
  duplicateApproverRule!: (typeof DUPLICATE_APPROVER_RULES)[number]

  @ApiProperty()
  @IsBoolean()
  requireComment!: boolean

  @ApiPropertyOptional({ type: FlowConditionDto })
  @IsObject()
  @ValidateNested()
  @Type(() => FlowConditionDto)
  @IsOptional()
  condition?: FlowConditionDto | null

  @ApiProperty({ type: [FlowNodeDto] })
  @IsArray()
  @Type(() => FlowNodeDto)
  @ValidateNested({ each: true })
  createNodes!: FlowNodeDto[]

  @ApiPropertyOptional({ type: [FlowLinkDto] })
  @IsArray()
  @Type(() => FlowLinkDto)
  @ValidateNested({ each: true })
  @IsOptional()
  createLinks?: FlowLinkDto[]
}

export class UpdateApprovalFlowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '流程名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string | null

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean

  @ApiProperty()
  @IsBoolean()
  createExecute!: boolean

  @ApiProperty()
  @IsBoolean()
  updateExecute!: boolean

  @ApiProperty()
  @IsBoolean()
  deleteExecute!: boolean

  @ApiProperty()
  @IsBoolean()
  submitterCanRevoke!: boolean

  @ApiProperty()
  @IsBoolean()
  allowBatchProcess!: boolean

  @ApiProperty()
  @IsBoolean()
  allowWithdraw!: boolean

  @ApiProperty()
  @IsBoolean()
  allowAddSign!: boolean

  @ApiProperty({ enum: DUPLICATE_APPROVER_RULES })
  @IsIn(DUPLICATE_APPROVER_RULES)
  duplicateApproverRule!: (typeof DUPLICATE_APPROVER_RULES)[number]

  @ApiProperty()
  @IsBoolean()
  requireComment!: boolean

  @ApiPropertyOptional({ type: FlowConditionDto })
  @IsObject()
  @ValidateNested()
  @Type(() => FlowConditionDto)
  @IsOptional()
  condition?: FlowConditionDto | null

  @ApiProperty({ type: [FlowNodeDto] })
  @IsArray()
  @Type(() => FlowNodeDto)
  @ValidateNested({ each: true })
  createNodes!: FlowNodeDto[]

  @ApiPropertyOptional({ type: [FlowLinkDto] })
  @IsArray()
  @Type(() => FlowLinkDto)
  @ValidateNested({ each: true })
  @IsOptional()
  createLinks?: FlowLinkDto[]
}

export class ApprovalFlowPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: APPROVAL_FORM_TYPES })
  @IsIn(APPROVAL_FORM_TYPES)
  @IsOptional()
  formType?: (typeof APPROVAL_FORM_TYPES)[number]

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsIn(['true', 'false'])
  @IsOptional()
  enabled?: 'true' | 'false'

  @ApiPropertyOptional({
    enum: ['number', 'name', 'formType', 'enabled', 'createdAt', 'updatedAt'],
  })
  @IsIn(['number', 'name', 'formType', 'enabled', 'createdAt', 'updatedAt'])
  @IsOptional()
  sortBy?: 'number' | 'name' | 'formType' | 'enabled' | 'createdAt' | 'updatedAt'

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc'
}

export class UpdateApprovalFlowEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean
}

export class SubmitApprovalDto {
  @ApiProperty({ enum: APPROVAL_MODULES })
  @IsIn(APPROVAL_MODULES)
  module!: (typeof APPROVAL_MODULES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string
}

export class HandleTaskDto {
  @ApiPropertyOptional({ description: '审批意见' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  comment?: string

  @ApiPropertyOptional({ description: '审批附件 ID 集合', type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  attachmentIds?: string[]
}

export class AddSignTaskDto {
  @ApiProperty({ enum: ADD_SIGN_TYPES, description: 'BEFORE=在我之前，AFTER=在我之后' })
  @IsIn(ADD_SIGN_TYPES)
  type!: (typeof ADD_SIGN_TYPES)[number]

  @ApiProperty({ description: '加签审批人 ID' })
  @IsString()
  @IsNotEmpty()
  signApprover!: string

  @ApiPropertyOptional({ description: '加签说明' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  comment?: string

  @ApiPropertyOptional({ description: '加签附件 ID 集合', type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  attachmentIds?: string[]
}

export class ReturnBackTaskDto {
  @ApiProperty({ description: '退回到的历史审批节点 ID' })
  @IsString()
  @IsNotEmpty()
  returnToNodeId!: string

  @ApiPropertyOptional({ description: '退回原因' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  comment?: string

  @ApiPropertyOptional({ description: '退回附件 ID 集合', type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  attachmentIds?: string[]
}
