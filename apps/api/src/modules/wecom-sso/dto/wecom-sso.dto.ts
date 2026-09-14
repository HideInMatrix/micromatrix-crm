import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class WeComDiscoveryQueryDto {
  @ApiProperty({ required: false, example: 'demo' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenant?: string
}

export class WeComWorkbenchEntryQueryDto {
  @ApiProperty({ required: false, example: 'demo' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenant?: string

  @ApiProperty({
    required: false,
    example: 'https://crm.example.com/dashboard',
    description: 'OAuth 完成后的站内回跳页面，可使用同域绝对 URL 或 / 开头的站内路径',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  target?: string
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
