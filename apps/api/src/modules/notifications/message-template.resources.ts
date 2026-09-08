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
const APPROVAL_RESULT_ZH = '【审批结果】您发起的${type}单据 ${name} ，审批${state}。'
const APPROVAL_RESULT_EN =
  '[Approval Result] The ${type} document ${name} you submitted has been ${state}.'

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
  CLUE_CONVERT_BUSINESS: {
    eventName: '转为商机',
    template: '请注意！您负责的 ${name} 线索，已成功转为商机！请知悉！',
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
  BUSINESS_ADD: {
    eventName: '新建商机',
    template: '请注意！${OPERATOR}新建${name}商机给您，请知悉！',
  },
  BUSINESS_DELETED: {
    eventName: '商机删除',
    template: '请注意！您负责的${name}商机，已被${OPERATOR}删除！',
  },
  BUSINESS_TRANSFER: {
    eventName: '商机转移',
    template: '请注意！${OPERATOR}将${name}商机转移给您，请知悉！',
  },
  BUSINESS_FOLLOW_UP_PLAN_DUE: {
    eventName: '跟进计划到期',
    template: '请注意！您创建的${name}商机跟进计划，已到预定时间，请及时跟进！',
  },
  OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED: {
    eventName: '跟进计划评论提醒',
    template: COMMENT_PLAN_ADDED_ZH,
  },
  OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_MENTIONED: {
    eventName: '跟进计划评论@提醒',
    template: COMMENT_PLAN_MENTIONED_ZH,
  },
  OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_ADDED: {
    eventName: '跟进记录评论提醒',
    template: COMMENT_RECORD_ADDED_ZH,
  },
  OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_MENTIONED: {
    eventName: '跟进记录评论@提醒',
    template: COMMENT_RECORD_MENTIONED_ZH,
  },
  BUSINESS_QUOTATION_APPROVAL: { eventName: '报价审批', template: APPROVAL_RESULT_ZH },
  BUSINESS_QUOTATION_DELETED: { eventName: '报价删除', template: '${OPERATOR}删除了${name}报价' },
  BUSINESS_QUOTATION_EXPIRED: {
    eventName: '报价到期',
    template: '您负责的${customerName}的报价已经到期',
  },
  BUSINESS_QUOTATION_EXPIRING: {
    eventName: '报价即将到期',
    template: '您负责的${customerName}报价还有${expireDays}天到期',
  },
  ORDER_APPROVAL: { eventName: '订单审批', template: APPROVAL_RESULT_ZH },
  CONTRACT_ARCHIVED: { eventName: '合同归档', template: '您负责的${customerName}合同已被归档' },
  CONTRACT_VOID: { eventName: '合同作废', template: '您负责的${customerName}合同已被作废' },
  CONTRACT_EXPIRED: { eventName: '合同到期', template: '您负责的${customerName}合同已经到期' },
  CONTRACT_EXPIRING: {
    eventName: '合同即将到期',
    template: '您负责的${customerName}合同还有${expireDays}天到期',
  },
  CONTRACT_PAYMENT_EXPIRED: {
    eventName: '回款计划到期',
    template: '您负责的${customerName}合同的回款计划已经到期',
  },
  CONTRACT_PAYMENT_EXPIRING: {
    eventName: '回款计划即将到期',
    template: '您负责的${customerName}合同的回款计划还有${expireDays}天到期',
  },
  CONTRACT_APPROVAL: { eventName: '合同审批', template: APPROVAL_RESULT_ZH },
  INVOICE_APPROVAL: { eventName: '发票审批', template: APPROVAL_RESULT_ZH },
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
  CLUE_CONVERT_BUSINESS: {
    eventName: 'Converted to opportunity',
    template: 'Attention！Your lead ${name} has been converted to opportunity！please be informed!',
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
  BUSINESS_ADD: {
    eventName: 'Opportunity created',
    template:
      'Attention! ${OPERATOR} created a new opportunity ${name} for you, please be informed!',
  },
  BUSINESS_DELETED: {
    eventName: 'Opportunity deleted',
    template: 'Attention! Your opportunity ${name} has been deleted by ${OPERATOR}!',
  },
  BUSINESS_TRANSFER: {
    eventName: 'Opportunity transferred',
    template: 'Attention! ${OPERATOR} transferred opportunity ${name} to you, please be informed!',
  },
  BUSINESS_FOLLOW_UP_PLAN_DUE: {
    eventName: 'Opportunity follow-up plan due',
    template:
      'Attention! The follow-up plan you created for opportunity ${name} is due, please follow up promptly!',
  },
  OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED: {
    eventName: 'New follow-up plan comment',
    template: COMMENT_PLAN_ADDED_EN,
  },
  OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_MENTIONED: {
    eventName: 'Follow-up plan comment mention',
    template: COMMENT_PLAN_MENTIONED_EN,
  },
  OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_ADDED: {
    eventName: 'New follow-up record comment',
    template: COMMENT_RECORD_ADDED_EN,
  },
  OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_MENTIONED: {
    eventName: 'Follow-up record comment mention',
    template: COMMENT_RECORD_MENTIONED_EN,
  },
  BUSINESS_QUOTATION_APPROVAL: {
    eventName: 'Opportunity quotation approved',
    template: APPROVAL_RESULT_EN,
  },
  BUSINESS_QUOTATION_DELETED: {
    eventName: 'Opportunity quotation deleted',
    template: '${OPERATOR} deleted ${name} quotation',
  },
  BUSINESS_QUOTATION_EXPIRED: {
    eventName: 'Opportunity quotation expired',
    template: 'Your ${customerName} quotation has expired',
  },
  BUSINESS_QUOTATION_EXPIRING: {
    eventName: 'Opportunity quotation expiring',
    template: 'Your ${customerName} quotation is expiring in ${expireDays} days',
  },
  ORDER_APPROVAL: { eventName: 'order approval', template: APPROVAL_RESULT_EN },
  CONTRACT_ARCHIVED: {
    eventName: 'Contract archived',
    template: 'Your ${customerName} contract has been archived',
  },
  CONTRACT_VOID: {
    eventName: 'Contract voided',
    template: 'Your ${customerName} contract has been voided',
  },
  CONTRACT_EXPIRED: {
    eventName: 'Contract expired',
    template: 'Your ${customerName} contract has expired',
  },
  CONTRACT_EXPIRING: {
    eventName: 'Contract expiring',
    template: 'Your ${customerName} contract is expiring in ${expireDays} days',
  },
  CONTRACT_PAYMENT_EXPIRED: {
    eventName: 'Payment plan expired',
    template: 'Your ${customerName} contract payment plan has expired',
  },
  CONTRACT_PAYMENT_EXPIRING: {
    eventName: 'Payment plan expiring',
    template: 'Your ${customerName} contract payment plan is expiring in ${expireDays} days',
  },
  CONTRACT_APPROVAL: { eventName: 'contract approval', template: APPROVAL_RESULT_EN },
  INVOICE_APPROVAL: { eventName: 'invoice approval', template: APPROVAL_RESULT_EN },
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

export type ApprovalTemplateType = 'quotation' | 'contract' | 'order' | 'invoice'
export type ApprovalTemplateState = 'APPROVED' | 'UNAPPROVED'

export const APPROVAL_TEMPLATE_TYPES: Record<
  MessageLanguage,
  Record<ApprovalTemplateType, string>
> = {
  'zh-CN': { quotation: '报价', contract: '合同', order: '订单', invoice: '发票' },
  'en-US': { quotation: 'Quotation', contract: 'Contract', order: 'Order', invoice: 'Invoice' },
}

export const APPROVAL_TEMPLATE_STATES: Record<
  MessageLanguage,
  Record<ApprovalTemplateState, string>
> = {
  'zh-CN': { APPROVED: '已通过', UNAPPROVED: '已驳回' },
  'en-US': { APPROVED: 'Approved', UNAPPROVED: 'Unapproved' },
}
