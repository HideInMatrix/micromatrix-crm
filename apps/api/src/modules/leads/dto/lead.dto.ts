import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

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

  @ApiPropertyOptional({ enum: ['FOLLOWING', 'CONVERTED', 'INVALID'] })
  @IsIn(['FOLLOWING', 'CONVERTED', 'INVALID'])
  @IsOptional()
  status?: 'FOLLOWING' | 'CONVERTED' | 'INVALID'

  @ApiPropertyOptional({ description: '高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string
}

export class AssignLeadDto {
  @ApiProperty({ description: '新负责人' })
  @IsString()
  @IsNotEmpty()
  ownerId!: string
}

class ConvertOpportunityDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  amount?: number
}

export class ConvertLeadDto {
  @ApiPropertyOptional({ description: '同时创建联系人（默认 true，需线索有联系人姓名）' })
  @IsBoolean()
  @IsOptional()
  createContact?: boolean

  @ApiPropertyOptional({ description: '同时创建商机' })
  @Type(() => ConvertOpportunityDto)
  @ValidateNested()
  @IsOptional()
  opportunity?: ConvertOpportunityDto
}
