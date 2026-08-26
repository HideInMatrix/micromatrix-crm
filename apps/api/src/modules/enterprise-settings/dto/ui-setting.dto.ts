import { Transform } from 'class-transformer'
import { IsIn, IsString, IsUrl, Matches, MaxLength } from 'class-validator'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export class UpdateEnterpriseUiSettingDto {
  @IsIn(['default', 'custom'])
  theme!: 'default' | 'custom'

  @IsString()
  @Matches(HEX_COLOR, { message: '自定义主题色必须为 #RRGGBB 格式' })
  customTheme!: string

  @IsIn(['default', 'follow', 'custom'])
  style!: 'default' | 'follow' | 'custom'

  @IsString()
  @Matches(HEX_COLOR, { message: '自定义背景色必须为 #RRGGBB 格式' })
  customStyle!: string

  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  title!: string

  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  slogan!: string

  @Transform(trimString)
  @IsString()
  @MaxLength(1024)
  @IsUrl({ require_protocol: true }, { message: '帮助文档地址必须是完整 URL' })
  helpDoc!: string
}
