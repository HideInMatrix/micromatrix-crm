import type { MessageLanguage, MessageTaskEvent } from '@micromatrix/shared'

export interface MessageTemplateResource {
  eventName: string
  template: string
}

const COMMENT_PLAN_ADDED_ZH = '【评论提醒】${OPERATOR} 给【${name}】的跟进计划添加了评论'
const COMMENT_PLAN_MENTIONED_ZH = '【评论提醒】${OPERATOR} 在【${name}】的跟进计划添加了评论并@了你'
const COMMENT_RECORD_ADDED_ZH = '【评论提醒】${OPERATOR} 给【${name}】的跟进记录添加了评论'
const COMMENT_RECORD_MENTIONED_ZH =
  '【评论提醒】${OPERATOR} 在【${name}】的跟进记录添加了评论并@了你'
const COMMENT_PLAN_ADDED_EN =
  '[Comment Reminder] ${OPERATOR} added a comment to the follow-up plan for [${name}]'
const COMMENT_PLAN_MENTIONED_EN =
  '[Comment Reminder] ${OPERATOR} added a comment to the follow-up plan for [${name}] and @ed you as well'
const COMMENT_RECORD_ADDED_EN =
  '[Comment Reminder] ${OPERATOR} added a comment to the follow-up record for [${name}]'
const COMMENT_RECORD_MENTIONED_EN =
  '[Comment Reminder] ${OPERATOR} added a comment to the follow-up record for [${name}] and @ed you as well'

const ZH_CN: Record<MessageTaskEvent, MessageTemplateResource> = {
  CUSTOMER_ADD: {
    eventName: '新建客户',
    template: '请注意！${OPERATOR}新建${name}客户给您，请知悉！',
  },
  CUSTOMER_CONCAT_ADD: {
    eventName: '新建联系人',
    template: '请注意！${operator} 新建 ${cName} 联系人给您，请知悉！',
  },
  CUSTOMER_COLLABORATION_ADD: {
    eventName: '新建协作人',
    template: '请注意！${operator} 将 ${uName} 添加为您负责客户 ${name} 的协作人！请知悉！',
  },
  CUSTOMER_TRANSFERRED_CUSTOMER: {
    eventName: '被转移客户',
    template: '请注意！${OPERATOR}将${name}客户转移给您，请知悉！',
  },
  CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS: {
    eventName: '客户自动移入公海（到时间）',
    template: '请注意！根据系统规则，您负责的${name}客户已被移入公海，请知悉！',
  },
  CUSTOMER_MOVED_HIGH_SEAS: {
    eventName: '客户被动移入公海',
    template: '请注意！${OPERATOR}已将您负责的${name}移入公海，请知悉！',
  },
  CUSTOMER_DELETED: {
    eventName: '客户被删除',
    template: '请注意！您负责的${name}已被${OPERATOR}删除！',
  },
  HIGH_SEAS_CUSTOMER_DISTRIBUTED: {
    eventName: '公海客户被分配',
    template: '请注意！${name}已由公海分配给您，请及时跟进处理！',
  },
  CUSTOMER_FOLLOW_UP_PLAN_DUE: {
    eventName: '跟进计划到期',
    template: '请注意！您创建的${name}跟进计划，已到预定时间，请及时跟进！',
  },
  CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED: {
    eventName: '跟进计划评论提醒',
    template: COMMENT_PLAN_ADDED_ZH,
  },
  CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED: {
    eventName: '跟进计划评论@提醒',
    template: COMMENT_PLAN_MENTIONED_ZH,
  },
  CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED: {
    eventName: '跟进记录评论提醒',
    template: COMMENT_RECORD_ADDED_ZH,
  },
  CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED: {
    eventName: '跟进记录评论@提醒',
    template: COMMENT_RECORD_MENTIONED_ZH,
  },
  CLUE_ADD: { eventName: '新建线索', template: '请注意！${OPERATOR}新建${name}线索给您，请知悉！' },
  CLUE_FOLLOW_UP_OVERDUE: {
    eventName: '线索跟进超时',
    template: '【跟进提醒】您负责的线索 ${name} 已超过当前线索池配置的跟进时限，请及时跟进。',
  },
  CLUE_AUTOMATIC_MOVE_POOL: {
    eventName: '自动移入线索池',
    template: '请注意！根据系统规则，您负责的${name}的销售线索，已被移入线索池！',
  },
  CLUE_MOVED_POOL: {
    eventName: '被动移入线索池',
    template: '请注意！${OPERATOR}已将您负责的${name}线索移入线索池，请知悉！',
  },
  CLUE_CONVERT_CUSTOMER: {
    eventName: '转为客户',
    template: '请注意！您负责的 ${name} 线索，已成功转为客户！请知悉！',
  },
  TRANSFER_CLUE: {
    eventName: '转移线索',
    template: '请注意！${OPERATOR}将${name}线索转移给您，请知悉！',
  },
  CLUE_DELETED: {
    eventName: '删除线索',
    template: '请注意！您负责的${name}线索，已被${OPERATOR}删除！',
  },
  CLUE_DISTRIBUTED: {
    eventName: '分配线索',
    template: '请注意！${name}已由线索池分配给您，请及时跟进处理！',
  },
  CLUE_FOLLOW_UP_PLAN_DUE: {
    eventName: '跟进计划到期',
    template: '请注意！您创建的${name}线索跟进计划，已到预定时间，请及时跟进！',
  },
  CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED: {
    eventName: '跟进计划评论提醒',
    template: COMMENT_PLAN_ADDED_ZH,
  },
  CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED: {
    eventName: '跟进计划评论@提醒',
    template: COMMENT_PLAN_MENTIONED_ZH,
  },
  CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED: {
    eventName: '跟进记录评论提醒',
    template: COMMENT_RECORD_ADDED_ZH,
  },
  CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED: {
    eventName: '跟进记录评论@提醒',
    template: COMMENT_RECORD_MENTIONED_ZH,
  },
}

const EN_US: Record<MessageTaskEvent, MessageTemplateResource> = {
  CUSTOMER_ADD: {
    eventName: 'New Account',
    template: 'Attention! ${OPERATOR} created a new account ${name} for you, please be informed!',
  },
  CUSTOMER_CONCAT_ADD: {
    eventName: 'New Concat',
    template: 'Attention！ ${operator} creates a ${cName} contact for you, please be informed!',
  },
  CUSTOMER_COLLABORATION_ADD: {
    eventName: 'New Collaboration',
    template:
      'Attention！ ${operator} adds ${uName} as your collaborator responsible for account ${name}! please be informed!',
  },
  CUSTOMER_TRANSFERRED_CUSTOMER: {
    eventName: 'Transferred Account',
    template: 'Attention! ${OPERATOR} transferred account ${name} to you, please be informed!',
  },
  CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS: {
    eventName: 'Account automatically moved to pool (by time)',
    template:
      'Attention! According to system rules, your account ${name} has been moved to the pool, please be informed!',
  },
  CUSTOMER_MOVED_HIGH_SEAS: {
    eventName: 'Account passively moved to pool',
    template:
      'Attention! ${OPERATOR} has moved your account ${name} to the pool, please be informed!',
  },
  CUSTOMER_DELETED: {
    eventName: 'Account deleted',
    template: 'Attention! Your account ${name} has been deleted by ${OPERATOR}!',
  },
  HIGH_SEAS_CUSTOMER_DISTRIBUTED: {
    eventName: 'Pool account assigned',
    template:
      'Attention! ${name} has been assigned to you from the pool, please follow up promptly!',
  },
  CUSTOMER_FOLLOW_UP_PLAN_DUE: {
    eventName: 'Follow-up plan due',
    template:
      'Attention! The follow-up plan you created for ${name} is due, please follow up promptly!',
  },
  CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED: {
    eventName: 'New follow-up plan comment',
    template: COMMENT_PLAN_ADDED_EN,
  },
  CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED: {
    eventName: 'Follow-up plan comment mention',
    template: COMMENT_PLAN_MENTIONED_EN,
  },
  CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED: {
    eventName: 'New follow-up record comment',
    template: COMMENT_RECORD_ADDED_EN,
  },
  CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED: {
    eventName: 'Follow-up record comment mention',
    template: COMMENT_RECORD_MENTIONED_EN,
  },
  CLUE_ADD: {
    eventName: 'Create new lead',
    template: 'Attention! ${OPERATOR} created a new lead ${name} for you, please be informed!',
  },
  CLUE_FOLLOW_UP_OVERDUE: {
    eventName: 'Lead follow-up overdue',
    template:
      '[Follow-up Reminder] Your lead ${name} has exceeded the configured follow-up window. Please follow up promptly.',
  },
  CLUE_AUTOMATIC_MOVE_POOL: {
    eventName: 'Lead automatically moved to pool',
    template:
      'Attention! According to system rules, your lead ${name} has been moved to the lead pool!',
  },
  CLUE_MOVED_POOL: {
    eventName: 'Lead passively moved to pool',
    template:
      'Attention! ${OPERATOR} has moved your lead ${name} to the lead pool, please be informed!',
  },
  CLUE_CONVERT_CUSTOMER: {
    eventName: 'Converted to account',
    template: 'Attention！Your lead ${name} has been converted to account！please be informed!',
  },
  TRANSFER_CLUE: {
    eventName: 'Transferred lead',
    template: 'Attention! ${OPERATOR} transferred lead ${name} to you, please be informed!',
  },
  CLUE_DELETED: {
    eventName: 'Lead deleted',
    template: 'Attention! Your lead ${name} has been deleted by ${OPERATOR}!',
  },
  CLUE_DISTRIBUTED: {
    eventName: 'Lead assigned',
    template:
      'Attention! ${name} has been assigned to you from the lead pool, please follow up promptly!',
  },
  CLUE_FOLLOW_UP_PLAN_DUE: {
    eventName: 'Lead follow-up plan due',
    template:
      'Attention! The follow-up plan you created for lead ${name} is due, please follow up promptly!',
  },
  CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED: {
    eventName: 'New follow-up plan comment',
    template: COMMENT_PLAN_ADDED_EN,
  },
  CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED: {
    eventName: 'Follow-up plan comment mention',
    template: COMMENT_PLAN_MENTIONED_EN,
  },
  CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED: {
    eventName: 'New follow-up record comment',
    template: COMMENT_RECORD_ADDED_EN,
  },
  CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED: {
    eventName: 'Follow-up record comment mention',
    template: COMMENT_RECORD_MENTIONED_EN,
  },
}

export const MESSAGE_TEMPLATE_RESOURCES: Record<
  MessageLanguage,
  Record<MessageTaskEvent, MessageTemplateResource>
> = {
  'zh-CN': ZH_CN,
  'en-US': EN_US,
}

export const MESSAGE_SUBJECT_SUFFIX: Record<MessageLanguage, string> = {
  'zh-CN': '通知',
  'en-US': 'Notification',
}
