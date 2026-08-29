import type { FieldConfig, FieldOption, FieldType } from '@micromatrix/shared'

export interface SystemFieldTemplate {
  key: string
  label: string
  type: FieldType
  required?: boolean
  system?: boolean
  hidden?: boolean
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
  opportunity: [
    {
      key: 'name',
      label: '商机名称',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 200,
      sort: 0,
    },
    { key: 'customerId', label: '客户名称', type: 'text', span: 12, listWidth: 160, sort: 1 },
    { key: 'amount', label: '商机金额', type: 'currency', span: 12, listWidth: 130, sort: 2 },
    { key: 'possible', label: '可能性', type: 'number', span: 12, listWidth: 100, sort: 3 },
    {
      key: 'expectedEndTime',
      label: '结束时间',
      type: 'date',
      span: 12,
      listWidth: 130,
      sort: 4,
    },
    { key: 'products', label: '意向产品', type: 'multiselect', span: 12, listWidth: 160, sort: 5 },
    { key: 'contactId', label: '联系人', type: 'text', span: 12, listWidth: 120, sort: 6 },
    { key: 'owner', label: '负责人', type: 'member', required: true, span: 12, listWidth: 100, sort: 7 },
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
  product: [
    {
      key: 'name',
      label: '产品名称',
      type: 'text',
      required: true,
      config: { unique: true },
      span: 12,
      listWidth: 200,
      sort: 0,
    },
    { key: 'price', label: '产品价格', type: 'currency', span: 12, listWidth: 120, sort: 1 },
    {
      key: 'status',
      label: '状态',
      type: 'radio',
      required: true,
      options: [
        { label: '上架', value: '1' },
        { label: '下架', value: '2' },
      ],
      config: { defaultValue: '1' },
      span: 12,
      listWidth: 100,
      sort: 2,
    },
    {
      key: 'description',
      label: '描述',
      type: 'textarea',
      system: false,
      span: 24,
      showInList: false,
      sort: 3,
    },
    {
      key: 'productPic',
      label: '产品图片',
      type: 'picture',
      system: false,
      config: { pictureShowType: 'card', uploadLimit: 10, uploadSizeLimit: 20 },
      span: 24,
      showInList: false,
      sort: 4,
    },
  ],
  price: [
    {
      key: 'name',
      label: '价格表名称',
      type: 'text',
      required: true,
      config: { unique: true },
      span: 12,
      listWidth: 220,
      sort: 0,
    },
    {
      key: 'status',
      label: '状态',
      type: 'radio',
      required: true,
      options: [
        { label: '启用', value: '1' },
        { label: '禁用', value: '2' },
      ],
      config: { defaultValue: '1' },
      span: 12,
      listWidth: 100,
      sort: 1,
    },
    {
      key: 'products',
      label: '产品信息',
      type: 'textarea',
      hidden: true,
      showInList: false,
      sort: 2,
    },
    {
      key: 'product',
      label: '产品',
      type: 'text',
      required: true,
      hidden: true,
      showInList: false,
      sort: 3,
    },
    {
      key: 'amount',
      label: '产品定价',
      type: 'currency',
      required: true,
      hidden: true,
      showInList: false,
      sort: 4,
    },
    {
      key: 'priceProductSku',
      label: '产品SKU',
      type: 'text',
      system: false,
      hidden: true,
      showInList: false,
      sort: 5,
    },
    {
      key: 'priceProductTax',
      label: '税点',
      type: 'percent',
      system: false,
      hidden: true,
      showInList: false,
      sort: 6,
    },
    {
      key: 'remark',
      label: '备注',
      type: 'textarea',
      system: false,
      span: 24,
      showInList: false,
      sort: 7,
    },
  ],
  quote: [
    {
      key: 'name',
      label: '报价主题',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 200,
      sort: 0,
    },
    { key: 'validUntil', label: '有效期至', type: 'date', span: 12, listWidth: 110, sort: 1 },
    { key: 'ownerId', label: '负责人', type: 'member', span: 12, listWidth: 100, sort: 2 },
    { key: 'remark', label: '备注', type: 'textarea', span: 24, showInList: false, sort: 3 },
  ],
  contract: [
    {
      key: 'name',
      label: '合同名称',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 200,
      sort: 0,
    },
    { key: 'signedAt', label: '签约日期', type: 'date', span: 12, listWidth: 110, sort: 1 },
    { key: 'startAt', label: '生效日期', type: 'date', span: 12, showInList: false, sort: 2 },
    { key: 'endAt', label: '到期日期', type: 'date', span: 12, listWidth: 110, sort: 3 },
    { key: 'ownerId', label: '负责人', type: 'member', span: 12, listWidth: 100, sort: 4 },
    { key: 'remark', label: '备注', type: 'textarea', span: 24, showInList: false, sort: 5 },
  ],
  order: [
    {
      key: 'name',
      label: '订单名称',
      type: 'text',
      required: true,
      span: 12,
      listWidth: 200,
      sort: 0,
    },
    { key: 'amount', label: '订单金额', type: 'currency', span: 12, listWidth: 120, sort: 1 },
    { key: 'ownerId', label: '负责人', type: 'member', span: 12, listWidth: 100, sort: 2 },
    { key: 'remark', label: '备注', type: 'textarea', span: 24, showInList: false, sort: 3 },
  ],
}
