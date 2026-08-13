import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

const APPROVER_TYPES = ['USER', 'ROLE', 'DEPT_LEADER', 'DIRECT_LEADER'] as const
const MODES = ['ALL', 'ANY'] as const
const MODULES = ['quote', 'contract', 'order', 'receivableRecord'] as const

export class FlowNodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '节点名称不能为空' })
  @MaxLength(30)
  name!: string

  @ApiProperty({ enum: APPROVER_TYPES })
  @IsIn(APPROVER_TYPES)
  approverType!: (typeof APPROVER_TYPES)[number]

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  approverIds?: string[]

  @ApiProperty({ enum: MODES })
  @IsIn(MODES)
  mode!: (typeof MODES)[number]
}

export class SaveFlowDto {
  @ApiProperty({ enum: MODULES })
  @IsIn(MODULES)
  module!: (typeof MODULES)[number]

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '流程名称不能为空' })
  @MaxLength(50)
  name!: string

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean

  @ApiPropertyOptional({ description: '触发条件 { amountGte }' })
  @IsObject()
  @IsOptional()
  condition?: { amountGte?: number }

  @ApiProperty({ type: [FlowNodeDto] })
  @IsArray()
  @Type(() => FlowNodeDto)
  @ValidateNested({ each: true })
  nodes!: FlowNodeDto[]
}

export class SubmitApprovalDto {
  @ApiProperty({ enum: MODULES })
  @IsIn(MODULES)
  module!: (typeof MODULES)[number]

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
