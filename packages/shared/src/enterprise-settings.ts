export type EnterpriseUiTheme = 'default' | 'custom'
export type EnterpriseUiStyle = 'default' | 'follow' | 'custom'
export type EnterpriseUiAssetSlot = 'icon' | 'loginLogo' | 'loginImage' | 'platformLogo'

export interface EnterpriseUiAssetVO {
  id: string
  name: string
  mime: string | null
  size: number
}

export interface EnterpriseUiSettingVO {
  id: string
  theme: EnterpriseUiTheme
  customTheme: string
  style: EnterpriseUiStyle
  customStyle: string
  title: string
  slogan: string
  helpDoc: string
  icon: EnterpriseUiAssetVO | null
  loginLogo: EnterpriseUiAssetVO | null
  loginImage: EnterpriseUiAssetVO | null
  platformLogo: EnterpriseUiAssetVO | null
  updatedAt: string
}

export interface UpdateEnterpriseUiSettingInput {
  theme: EnterpriseUiTheme
  customTheme: string
  style: EnterpriseUiStyle
  customStyle: string
  title: string
  slogan: string
  helpDoc: string
}

export interface EnterpriseMailSettingVO {
  configured: boolean
  host: string
  port: number
  account: string
  passwordConfigured: boolean
  from: string
  recipient: string
  ssl: boolean
  tls: boolean
  lastTestSucceeded: boolean | null
  lastTestMessage: string | null
  lastTestedAt: string | null
  updatedAt: string | null
}

export interface SaveEnterpriseMailSettingInput {
  host: string
  port: number
  account: string
  password?: string
  from: string
  recipient: string
  ssl: boolean
  tls: boolean
}

export interface EnterpriseMailTestVO {
  success: boolean
  message: string
  testedAt: string
}

export type EnterpriseAiProvider =
  'OpenAI' | 'DeepSeek' | '阿里云' | 'Anthropic' | '腾讯云' | '自定义'

export interface EnterpriseAiModelVO {
  id: string
  displayName: string
  modelName: string
  provider: EnterpriseAiProvider
  apiUrl: string
  apiKeyConfigured: boolean
  enable: boolean
  temperature: number
  maxTokens: number
  topP: number
  globalDailyLimit: number | null
  userDailyLimit: number | null
  dailyTotal: number
  createdAt: string
  updatedAt: string
}

export interface SaveEnterpriseAiModelInput {
  displayName: string
  modelName: string
  provider: EnterpriseAiProvider
  apiUrl: string
  apiKey?: string
  enable: boolean
  temperature: number
  maxTokens: number
  topP: number
  globalDailyLimit?: number | null
  userDailyLimit?: number | null
}

export interface EnterpriseAiModelOptionVO {
  id: string
  name: string
}

export interface EnterpriseAiRouteStrategyVO {
  modelIds: string[]
}

export interface EnterpriseTermCategoryVO {
  id: string
  name: string
  sort: number
  termCount: number
}

export interface EnterpriseTermVO {
  id: string
  categoryId: string
  categoryName: string
  standardTerm: string
  alsoCalled: string
  avoidThese: string
  useCase: string
  systemReference: string
  enable: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveEnterpriseTermInput {
  categoryId: string
  standardTerm: string
  alsoCalled?: string
  avoidThese?: string
  useCase?: string
  systemReference?: string
  enable: boolean
}

export type EnterpriseTermDiscoveryStatus = 'PENDING' | 'ADOPTED' | 'IGNORED'

export interface EnterpriseTermDiscoveryVO {
  id: string
  freeTerm: string
  source: string
  reference: string
  status: EnterpriseTermDiscoveryStatus
  adoptedTermId: string | null
  createdAt: string
}

export type EnterpriseGlobalTaskTriggerType = 'manual' | 'cron'
export type EnterpriseGlobalTaskConfirmationLevel = 'ask' | 'auto' | 'only_analysis'
export type EnterpriseGlobalTaskExecutionStatus =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'STOPPED'

export interface EnterpriseGlobalTaskVO {
  id: string
  name: string
  triggerType: EnterpriseGlobalTaskTriggerType
  executionCondition: string
  executionAction: string
  confirmationLevel: EnterpriseGlobalTaskConfirmationLevel
  applicableModelId: string | null
  applicableModelName: string | null
  enable: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveEnterpriseGlobalTaskInput {
  name: string
  triggerType: EnterpriseGlobalTaskTriggerType
  executionCondition?: string
  executionAction?: string
  confirmationLevel: EnterpriseGlobalTaskConfirmationLevel
  applicableModelId?: string | null
  enable: boolean
}

export interface EnterpriseGlobalTaskExecutionVO {
  id: string
  taskId: string
  taskName: string
  status: EnterpriseGlobalTaskExecutionStatus
  input: unknown
  output: unknown
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}
