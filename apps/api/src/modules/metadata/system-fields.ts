import type { FieldConfig, FieldOption, FieldType } from '@micromatrix/shared'

export interface SystemFieldTemplate {
  key: string
  label: string
  type: FieldType
  required?: boolean
  system?: boolean
  hidden?: boolean
  mobile?: boolean
  options?: FieldOption[]
  config?: FieldConfig
  span?: number
  showInList?: boolean
  listWidth?: number
  sort: number
}

const INDUSTRY_OPTIONS: FieldOption[] = [
  { label: '软件与信息服务', value: '软件与信息服务' },
  { label: '互联网', value: '互联网' },
  { label: '装备制造', value: '装备制造' },
  { label: '电子商务', value: '电子商务' },
  { label: '进出口贸易', value: '进出口贸易' },
  { label: '金融', value: '金融' },
  { label: '教育', value: '教育' },
  { label: '医疗健康', value: '医疗健康' },
  { label: '其他', value: '其他' },
]

/**
 * 各业务对象的系统字段模板（首次访问时初始化到租户）。
 * key 与业务表列名一一对应；系统字段不可删除、key/type 不可修改。
 */
const LEAD_SOURCE_OPTIONS: FieldOption[] = [
  { label: '官网表单', value: '官网表单' },
  { label: '电话咨询', value: '电话咨询' },
  { label: '展会活动', value: '展会活动' },
  { label: '朋友介绍', value: '朋友介绍' },
  { label: '标讯', value: '标讯' },
  { label: '广告投放', value: '广告投放' },
  { label: '其他', value: '其他' },
]

const LEAD_LEVEL_OPTIONS: FieldOption[] = [
  { label: '高意向', value: 'A' },
  { label: '中意向', value: 'B' },
  { label: '低意向', value: 'C' },
]

export const MODULE_SYSTEM_FIELDS: Record<string, SystemFieldTemplate[]> = {
  lead: [
    {
      key: 'name',
      label: '线索名称',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 200,
      sort: 0,
    },
    { key: 'contact', label: '联系人', type: 'text', span: 12, listWidth: 110, sort: 1 },
    { key: 'phone', label: '电话', type: 'phone', span: 12, listWidth: 140, sort: 2 },
    {
      key: 'cf_source',
      label: '线索来源',
      type: 'select',
      system: false,
      options: LEAD_SOURCE_OPTIONS,
      span: 12,
      listWidth: 110,
      sort: 3,
    },
    {
      key: 'cf_level',
      label: '意向等级',
      type: 'select',
      system: false,
      options: LEAD_LEVEL_OPTIONS,
      span: 12,
      listWidth: 100,
      sort: 4,
    },
    { key: 'owner', label: '负责人', type: 'member', span: 12, listWidth: 100, sort: 5 },
  ],
  customer: [
    {
      key: 'name',
      label: '客户名称',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 220,
      sort: 0,
    },
    {
      key: 'cf_industry',
      label: '所属行业',
      type: 'select',
      system: false,
      options: INDUSTRY_OPTIONS,
      span: 12,
      listWidth: 140,
      sort: 1,
    },
    {
      key: 'cf_phone',
      label: '联系电话',
      type: 'phone',
      system: false,
      span: 12,
      listWidth: 150,
      sort: 2,
    },
    {
      key: 'cf_email',
      label: '邮箱',
      type: 'email',
      system: false,
      span: 12,
      listWidth: 200,
      sort: 3,
    },
    { key: 'owner', label: '负责人', type: 'member', span: 12, listWidth: 110, sort: 4 },
    {
      key: 'cf_remark',
      label: '备注',
      type: 'textarea',
      system: false,
      span: 24,
      showInList: false,
      sort: 5,
    },
  ],
  contact: [
    { key: 'name', label: '姓名', type: 'text', required: true, span: 12, listWidth: 120, sort: 0 },
    { key: 'customerId', label: '客户', type: 'text', span: 12, listWidth: 180, sort: 1 },
    { key: 'phone', label: '电话', type: 'phone', span: 12, listWidth: 150, sort: 2 },
    { key: 'owner', label: '负责人', type: 'member', span: 12, listWidth: 110, sort: 3 },
    { key: 'enable', label: '状态', type: 'switch', span: 12, listWidth: 90, sort: 4 },
  ],
  followRecord: [
    {
      key: 'targetType',
      label: '关联类型',
      type: 'select',
      required: true,
      options: [
        { label: '客户', value: 'customer' },
        { label: '线索', value: 'lead' },
      ],
      span: 12,
      listWidth: 100,
      sort: 0,
    },
    {
      key: 'targetId',
      label: '关联对象',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 180,
      sort: 1,
    },
    {
      key: 'ownerId',
      label: '负责人',
      type: 'member',
      required: true,
      span: 12,
      listWidth: 110,
      sort: 2,
    },
    { key: 'contactId', label: '联系人', type: 'text', span: 12, listWidth: 120, sort: 3 },
    {
      key: 'followedAt',
      label: '跟进时间',
      type: 'datetime',
      span: 12,
      listWidth: 170,
      sort: 4,
    },
    {
      key: 'content',
      label: '跟进内容',
      type: 'textarea',
      required: true,
      span: 24,
      listWidth: 240,
      sort: 5,
    },
    {
      key: 'type',
      label: '跟进方式',
      type: 'select',
      options: [
        { label: '电话', value: '电话' },
        { label: '拜访', value: '拜访' },
        { label: '微信', value: '微信' },
        { label: '邮件', value: '邮件' },
        { label: '会议', value: '会议' },
        { label: '其他', value: '其他' },
      ],
      span: 12,
      listWidth: 110,
      sort: 6,
    },
  ],
  followPlan: [
    {
      key: 'targetType',
      label: '关联类型',
      type: 'select',
      required: true,
      mobile: true,
      options: [
        { label: '客户', value: 'customer' },
        { label: '线索', value: 'lead' },
      ],
      span: 12,
      listWidth: 100,
      sort: 0,
    },
    {
      key: 'targetId',
      label: '关联对象',
      type: 'text',
      required: true,
      mobile: true,
      span: 12,
      listWidth: 180,
      sort: 1,
    },
    {
      key: 'ownerId',
      label: '负责人',
      type: 'member',
      required: true,
      mobile: true,
      span: 12,
      listWidth: 110,
      sort: 2,
    },
    {
      key: 'contactId',
      label: '联系人',
      type: 'text',
      mobile: true,
      span: 12,
      listWidth: 120,
      sort: 3,
    },
    {
      key: 'estimatedAt',
      label: '计划时间',
      type: 'datetime',
      mobile: true,
      span: 12,
      listWidth: 150,
      sort: 4,
    },
    {
      key: 'content',
      label: '预计沟通内容',
      type: 'textarea',
      required: true,
      mobile: true,
      span: 24,
      listWidth: 220,
      sort: 7,
    },
    {
      key: 'method',
      label: '跟进方式',
      type: 'select',
      mobile: true,
      options: [
        { label: '电话', value: '电话' },
        { label: '拜访', value: '拜访' },
        { label: '微信', value: '微信' },
        { label: '邮件', value: '邮件' },
        { label: '会议', value: '会议' },
        { label: '其他', value: '其他' },
      ],
      span: 12,
      listWidth: 110,
      sort: 5,
    },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      hidden: true,
      options: [
        { label: '未开始', value: 'PREPARED' },
        { label: '进行中', value: 'UNDERWAY' },
        { label: '已完成', value: 'COMPLETED' },
        { label: '已取消', value: 'CANCELLED' },
      ],
      span: 12,
      listWidth: 100,
      sort: 8,
    },
  ],
}
