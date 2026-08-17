import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

export class CreateContactDto {
  @ApiProperty({ description: '所属客户' })
  @IsString()
  @IsNotEmpty()
  customerId!: string

  @ApiPropertyOptional({ description: '联系人负责人；不传时默认当前用户' })
  @IsString()
  @IsOptional()
  ownerId?: string

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(255)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  customData?: Record<string, unknown>
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}

export class UpdateContactRequestDto extends UpdateContactDto {
  @ApiProperty({ description: '联系人 ID' })
  @IsString()
  @IsNotEmpty()
  id!: string
}

export class QueryContactsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '客户详情内嵌列表时指定' })
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsIn(['true', 'false'])
  @IsOptional()
  enable?: 'true' | 'false'

  @ApiPropertyOptional({ description: '高级筛选（FilterCondition[] JSON）' })
  @IsString()
  @IsOptional()
  filters?: string

  @ApiPropertyOptional({ description: '保存的用户视图 ID' })
  @IsString()
  @IsOptional()
  viewId?: string

  @ApiPropertyOptional({ enum: ['SELF', 'DEPT', 'ALL'], description: '联系人内置数据范围视图' })
  @IsIn(['SELF', 'DEPT', 'ALL'])
  @IsOptional()
  scopeView?: 'SELF' | 'DEPT' | 'ALL'
}

export class DisableContactDto {
  @ApiProperty({ description: '停用原因' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string
}
