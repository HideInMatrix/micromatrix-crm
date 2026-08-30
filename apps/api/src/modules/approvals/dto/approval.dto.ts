import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
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

export const APPROVER_TYPES = ['USER', 'ROLE', 'DEPT_LEADER', 'DIRECT_LEADER'] as const
export const APPROVAL_MODES = ['ALL', 'ANY'] as const
export const APPROVAL_FORM_TYPES = ['quotation', 'contract', 'invoice', 'order'] as const
export const APPROVAL_MODULES = ['quote', 'contract', 'invoice', 'order'] as const
export const DUPLICATE_APPROVER_RULES = ['FIRST_ONLY', 'SEQUENTIAL_ALL', 'EACH'] as const
export const ADD_SIGN_TYPES = ['BEFORE', 'AFTER'] as const

export class FlowNodeDto {
  @ApiPropertyOptional({ description: '前端编辑期稳定键' })
  @IsString()
  @IsOptional()
  clientId?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '节点名称不能为空' })
  @MaxLength(255)
  name!: string

  @ApiProperty({ enum: APPROVER_TYPES })
  @IsIn(APPROVER_TYPES)
  approverType!: (typeof APPROVER_TYPES)[number]

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

  @ApiProperty({ enum: APPROVAL_MODES })
  @IsIn(APPROVAL_MODES)
  mode!: (typeof APPROVAL_MODES)[number]
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
}
