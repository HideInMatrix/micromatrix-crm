export type MessageTaskModule = 'CUSTOMER' | 'CLUE'

export type MessageLanguage = 'zh-CN' | 'en-US'

export type MessageTaskEvent =
  | 'CUSTOMER_ADD'
  | 'CUSTOMER_CONCAT_ADD'
  | 'CUSTOMER_COLLABORATION_ADD'
  | 'CUSTOMER_TRANSFERRED_CUSTOMER'
  | 'CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS'
  | 'CUSTOMER_MOVED_HIGH_SEAS'
  | 'CUSTOMER_DELETED'
  | 'HIGH_SEAS_CUSTOMER_DISTRIBUTED'
  | 'CUSTOMER_FOLLOW_UP_PLAN_DUE'
  | 'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED'
  | 'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED'
  | 'CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED'
  | 'CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED'
  | 'CLUE_ADD'
  | 'CLUE_FOLLOW_UP_OVERDUE'
  | 'CLUE_AUTOMATIC_MOVE_POOL'
  | 'CLUE_MOVED_POOL'
  | 'CLUE_CONVERT_CUSTOMER'
  | 'TRANSFER_CLUE'
  | 'CLUE_DELETED'
  | 'CLUE_DISTRIBUTED'
  | 'CLUE_FOLLOW_UP_PLAN_DUE'
  | 'CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED'
  | 'CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED'
  | 'CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED'
  | 'CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED'

export type MessageTimeUnit = 'DAY'

export interface MessageReminderTime {
  timeValue: number
  timeUnit: MessageTimeUnit
}

export interface MessageTaskConfig {
  timeList: MessageReminderTime[]
  userIds: string[]
  roleIds: string[]
  ownerEnable: boolean
  ownerLevel: number
  roleEnable: boolean
}

export interface MessageTaskDefinition {
  module: MessageTaskModule
  moduleName: string
  event: MessageTaskEvent
  eventName: string
  configurable: boolean
  timeConfigurable: boolean
  defaultSystemEnabled: boolean
  defaultEmailEnabled: boolean
}

export interface MessageTaskSettingVO extends MessageTaskDefinition {
  systemEnabled: boolean
  emailEnabled: boolean
  weComEnabled: boolean
  dingTalkEnabled: boolean
  larkEnabled: boolean
  config: MessageTaskConfig | null
}

export interface MessageTaskGroupVO {
  module: MessageTaskModule
  moduleName: string
  items: MessageTaskSettingVO[]
}

export interface UpdateMessageTaskSettingInput {
  module: MessageTaskModule
  systemEnabled?: boolean
  emailEnabled?: boolean
  weComEnabled?: boolean
  dingTalkEnabled?: boolean
  larkEnabled?: boolean
  config?: MessageTaskConfig
}

export interface BatchUpdateMessageTaskSettingInput {
  systemEnabled?: boolean
  emailEnabled?: boolean
  weComEnabled?: boolean
  dingTalkEnabled?: boolean
  larkEnabled?: boolean
}

export interface MessageChannelGateVO {
  channel: 'WECOM' | 'DINGTALK' | 'LARK'
  configured: boolean
  verified: boolean
  enabled: boolean
  available: boolean
  reason: string | null
}

export type MessageDeliveryStatus = 'PENDING' | 'SENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD'

export interface MessageDeliveryVO {
  id: string
  channel: 'WECOM' | 'DINGTALK' | 'LARK'
  event: string
  eventName: string
  userId: string | null
  userName: string | null
  externalSubject: string | null
  title: string
  content: string | null
  link: string | null
  status: MessageDeliveryStatus
  attempts: number
  maxAttempts: number
  nextAttemptAt: string | null
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

const MODULE_NAMES: Record<MessageTaskModule, string> = {
  CUSTOMER: '客户管理',
  CLUE: '线索管理',
}

const EVENT_GROUPS: Array<{
  module: MessageTaskModule
  events: Array<[MessageTaskEvent, string]>
}> = [
  {
    module: 'CUSTOMER',
    events: [
      ['CUSTOMER_ADD', '新建客户'],
      ['CUSTOMER_CONCAT_ADD', '新建联系人'],
      ['CUSTOMER_COLLABORATION_ADD', '新建协作人'],
      ['CUSTOMER_TRANSFERRED_CUSTOMER', '被转移客户'],
      ['CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS', '客户自动移入公海（到时间）'],
      ['CUSTOMER_MOVED_HIGH_SEAS', '客户被动移入公海'],
      ['CUSTOMER_DELETED', '客户被删除'],
      ['HIGH_SEAS_CUSTOMER_DISTRIBUTED', '公海客户被分配'],
      ['CUSTOMER_FOLLOW_UP_PLAN_DUE', '跟进计划到期'],
      ['CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED', '跟进计划评论提醒'],
      ['CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED', '跟进计划评论@提醒'],
      ['CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED', '跟进记录评论提醒'],
      ['CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED', '跟进记录评论@提醒'],
    ],
  },
  {
    module: 'CLUE',
    events: [
      ['CLUE_ADD', '新建线索'],
      ['CLUE_FOLLOW_UP_OVERDUE', '线索跟进超时'],
      ['CLUE_AUTOMATIC_MOVE_POOL', '自动移入线索池'],
      ['CLUE_MOVED_POOL', '被动移入线索池'],
      ['CLUE_CONVERT_CUSTOMER', '转为客户'],
      ['TRANSFER_CLUE', '转移线索'],
      ['CLUE_DELETED', '删除线索'],
      ['CLUE_DISTRIBUTED', '分配线索'],
      ['CLUE_FOLLOW_UP_PLAN_DUE', '跟进计划到期'],
      ['CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED', '跟进计划评论提醒'],
      ['CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED', '跟进计划评论@提醒'],
      ['CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED', '跟进记录评论提醒'],
      ['CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED', '跟进记录评论@提醒'],
    ],
  },
]

const CONFIGURABLE_EVENTS = new Set<MessageTaskEvent>()

const TIME_CONFIGURABLE_EVENTS = new Set<MessageTaskEvent>()

/** 与 Cordys `task/message_task.json` 的模块和事件顺序一致。 */
export const MESSAGE_TASK_DEFINITIONS: MessageTaskDefinition[] = EVENT_GROUPS.flatMap(
  ({ module, events }) =>
    events.map(([event, eventName]) => ({
      module,
      moduleName: MODULE_NAMES[module],
      event,
      eventName,
      configurable: CONFIGURABLE_EVENTS.has(event),
      timeConfigurable: TIME_CONFIGURABLE_EVENTS.has(event),
      defaultSystemEnabled: true,
      defaultEmailEnabled: false,
    })),
)

export function defaultMessageTaskConfig(event: MessageTaskEvent): MessageTaskConfig | null {
  if (!CONFIGURABLE_EVENTS.has(event)) return null
  return {
    timeList: TIME_CONFIGURABLE_EVENTS.has(event) ? [{ timeValue: 3, timeUnit: 'DAY' }] : [],
    userIds: ['OWNER'],
    roleIds: [],
    ownerEnable: false,
    ownerLevel: 0,
    roleEnable: false,
  }
}
