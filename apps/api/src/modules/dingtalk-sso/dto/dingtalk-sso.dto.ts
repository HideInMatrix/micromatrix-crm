import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class DingTalkDiscoveryQueryDto {
  @ApiProperty({ required: false, example: 'demo' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenant?: string
}

export class StartDingTalkLoginDto {
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

export class DingTalkLoginCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_048)
  code!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state!: string
}
