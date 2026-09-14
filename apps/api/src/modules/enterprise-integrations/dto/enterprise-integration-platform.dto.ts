import { IsIn } from 'class-validator'
import type { EnterpriseIntegrationProvider } from '@micromatrix/shared'

export class SwitchEnterpriseIntegrationPlatformDto {
  @IsIn(['WECOM', 'DINGTALK', 'LARK'])
  provider!: EnterpriseIntegrationProvider
}
