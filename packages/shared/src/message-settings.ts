export type MessageTaskModule = 'CUSTOMER' | 'CLUE' | 'OPPORTUNITY' | 'ORDER' | 'CONTRACT'

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
  | 'CLUE_ADD'
  | 'CLUE_AUTOMATIC_MOVE_POOL'
  | 'CLUE_MOVED_POOL'
  | 'CLUE_CONVERT_CUSTOMER'
  | 'CLUE_CONVERT_BUSINESS'
  | 'TRANSFER_CLUE'
  | 'CLUE_DELETED'
  | 'CLUE_DISTRIBUTED'
  | 'CLUE_FOLLOW_UP_PLAN_DUE'
  | 'BUSINESS_ADD'
  | 'BUSINESS_DELETED'
  | 'BUSINESS_TRANSFER'
  | 'BUSINESS_FOLLOW_UP_PLAN_DUE'
  | 'BUSINESS_QUOTATION_APPROVAL'
  | 'BUSINESS_QUOTATION_DELETED'
  | 'BUSINESS_QUOTATION_EXPIRED'
  | 'BUSINESS_QUOTATION_EXPIRING'
  | 'ORDER_APPROVAL'
  | 'CONTRACT_ARCHIVED'
  | 'CONTRACT_VOID'
  | 'CONTRACT_EXPIRED'
  | 'CONTRACT_EXPIRING'
  | 'CONTRACT_PAYMENT_EXPIRED'
  | 'CONTRACT_PAYMENT_EXPIRING'
  | 'CONTRACT_APPROVAL'
  | 'INVOICE_APPROVAL'

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
  config?: MessageTaskConfig
}

export interface BatchUpdateMessageTaskSettingInput {
  systemEnabled?: boolean
  emailEnabled?: boolean
}

const MODULE_NAMES: Record<MessageTaskModule, string> = {
  CUSTOMER: '客户管理',
  CLUE: '线索管理',
  OPPORTUNITY: '商机管理',
  ORDER: '订单管理',
  CONTRACT: '合同管理',
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
    ],
  },
  {
    module: 'CLUE',
    events: [
      ['CLUE_ADD', '新建线索'],
      ['CLUE_AUTOMATIC_MOVE_POOL', '自动移入线索池'],
      ['CLUE_MOVED_POOL', '被动移入线索池'],
      ['CLUE_CONVERT_CUSTOMER', '转为客户'],
      ['CLUE_CONVERT_BUSINESS', '转为商机'],
      ['TRANSFER_CLUE', '转移线索'],
      ['CLUE_DELETED', '删除线索'],
      ['CLUE_DISTRIBUTED', '分配线索'],
      ['CLUE_FOLLOW_UP_PLAN_DUE', '跟进计划到期'],
    ],
  },
  {
    module: 'OPPORTUNITY',
    events: [
      ['BUSINESS_ADD', '新建商机'],
      ['BUSINESS_DELETED', '商机删除'],
      ['BUSINESS_TRANSFER', '商机转移'],
      ['BUSINESS_FOLLOW_UP_PLAN_DUE', '跟进计划到期'],
      ['BUSINESS_QUOTATION_APPROVAL', '报价审批'],
      ['BUSINESS_QUOTATION_DELETED', '报价删除'],
      ['BUSINESS_QUOTATION_EXPIRED', '报价到期'],
      ['BUSINESS_QUOTATION_EXPIRING', '报价即将到期'],
    ],
  },
  { module: 'ORDER', events: [['ORDER_APPROVAL', '订单审批']] },
  {
    module: 'CONTRACT',
    events: [
      ['CONTRACT_ARCHIVED', '合同归档'],
      ['CONTRACT_VOID', '合同作废'],
      ['CONTRACT_EXPIRED', '合同到期'],
      ['CONTRACT_EXPIRING', '合同即将到期'],
      ['CONTRACT_PAYMENT_EXPIRED', '回款计划到期'],
      ['CONTRACT_PAYMENT_EXPIRING', '回款计划即将到期'],
      ['CONTRACT_APPROVAL', '合同审批'],
      ['INVOICE_APPROVAL', '发票审批'],
    ],
  },
]

const CONFIGURABLE_EVENTS = new Set<MessageTaskEvent>([
  'BUSINESS_QUOTATION_EXPIRED',
  'BUSINESS_QUOTATION_EXPIRING',
  'CONTRACT_ARCHIVED',
  'CONTRACT_VOID',
  'CONTRACT_EXPIRED',
  'CONTRACT_EXPIRING',
  'CONTRACT_PAYMENT_EXPIRED',
  'CONTRACT_PAYMENT_EXPIRING',
])

const TIME_CONFIGURABLE_EVENTS = new Set<MessageTaskEvent>([
  'BUSINESS_QUOTATION_EXPIRING',
  'CONTRACT_EXPIRING',
  'CONTRACT_PAYMENT_EXPIRING',
])

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
