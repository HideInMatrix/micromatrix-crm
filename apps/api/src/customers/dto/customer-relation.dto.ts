import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsString, ValidateNested } from 'class-validator'

export class SaveCustomerRelationDto {
  @ApiProperty({ description: '关联客户 ID' })
  @IsString()
  @IsNotEmpty()
  customerId!: string

  @ApiProperty({ enum: ['GROUP', 'SUBSIDIARY'] })
  @IsIn(['GROUP', 'SUBSIDIARY'])
  relationType!: 'GROUP' | 'SUBSIDIARY'
}

export class ReplaceCustomerRelationsDto {
  @ApiProperty({ type: [SaveCustomerRelationDto], maxItems: 11 })
  @IsArray()
  @ArrayMaxSize(11)
  @Type(() => SaveCustomerRelationDto)
  @ValidateNested({ each: true })
  relations!: SaveCustomerRelationDto[]
}
