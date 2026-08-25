import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class WeComDiscoveryQueryDto {
  @ApiProperty({ required: false, example: 'demo' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenant?: string
}

export class StartWeComLoginDto {
  @ApiProperty({ required: false, example: 'demo' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenantSlug?: string

  @ApiProperty({ required: false, example: '/dashboard' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^\/(?!\/)/, { message: '返回地址必须是站内路径' })
  returnPath?: string
}

export class WeComLoginCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_048)
  code!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state!: string
}
