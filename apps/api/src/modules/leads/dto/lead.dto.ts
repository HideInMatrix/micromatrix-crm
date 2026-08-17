import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { CreateCustomerDto } from '../../../customers/dto/create-customer.dto'

export class CreateLeadDto {
  @ApiProperty({ description: '线索名称（公司/项目）' })
  @IsString()
  @IsNotEmpty({ message: '线索名称不能为空' })
  @MaxLength(100)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  contactName?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string

  @ApiPropertyOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string

  @ApiPropertyOptional({ description: '直接放入线索池' })
  @IsBoolean()
  @IsOptional()
  toPool?: boolean

  @ApiPropertyOptional({ description: '直接放入指定线索池（toPool=true 时生效）' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ description: '负责人（默认当前用户）' })
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class QueryLeadsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'pool'], description: 'mine=按数据范围, pool=线索池' })
  @IsIn(['mine', 'pool'])
  @IsOptional()
  scope?: 'mine' | 'pool'

  @ApiPropertyOptional({ description: '线索池 ID（scope=pool 时生效）' })
  @IsString()
  @IsOptional()
  poolId?: string

  @ApiPropertyOptional({ enum: ['FOLLOWING', 'CONVERTED', 'INVALID'] })
  @IsIn(['FOLLOWING', 'CONVERTED', 'INVALID'])
  @IsOptional()
  status?: 'FOLLOWING' | 'CONVERTED' | 'INVALID'

  @ApiPropertyOptional({ description: '高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string

  @ApiPropertyOptional({ description: '保存的用户视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string
}

export class AssignLeadDto {
  @ApiProperty({ description: '新负责人' })
  @IsString()
  @IsNotEmpty()
  ownerId!: string
}

export class TransformLeadDto {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  clueId!: string

  @ApiPropertyOptional({ description: '是否同时创建商机' })
  @IsBoolean()
  @IsOptional()
  oppCreated?: boolean

  @ApiPropertyOptional({ description: '商机名称；oppCreated=true 时必填' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  oppName?: string
}

/** Cordys ClueTransitionCustomerRequest：客户新增表单 + clueId。 */
export class TransitionLeadCustomerDto extends CreateCustomerDto {
  @ApiProperty({ description: '线索 ID' })
  @IsString()
  @IsNotEmpty()
  clueId!: string
}

export class RetransitionLeadCustomerDto {
  @ApiProperty({ description: '线索 ID 集合', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  clueIds!: string[]

  @ApiProperty({ description: '目标客户 ID' })
  @IsString()
  @IsNotEmpty()
  customerId!: string
}

export class TransitionCustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '客户高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string
}
