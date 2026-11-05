import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type {
  ExternalEventTemplateConfig,
  ExternalEventTemplateCreateInput,
  ExternalEventFlow,
  ExternalEventTemplateInput,
  ExternalEventTemplateVO,
  ExternalEventUserProvider,
} from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import {
  EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY,
  filterOpsForType,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma.service'
import { instantToISOString, nowInstant } from '../../prisma/temporal'
import { MetadataService } from '../metadata/metadata.service'
import { CustomersService } from '../../customers/customers.service'
import { LeadsService } from '../leads/leads.service'
import { ExternalResourceResolverService } from './external-resource-resolver.service'

const EXTERNAL_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/
const PROVIDERS = ['CRM', 'WECOM', 'DINGTALK', 'LARK'] as const

function validKey(key: unknown): key is string {
  return typeof key === 'string' && EXTERNAL_KEY.test(key)
}

function requireKey(key: unknown, description: string) {
  if (!validKey(key))
    throw new BadRequestException(`${description} 只能包含字母、数字和下划线，且以字母开头`)
}

@Injectable()
export class ExternalEventTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
    private readonly resolver: ExternalResourceResolverService,
    private readonly customers: CustomersService,
    private readonly leads: LeadsService,
  ) {}

  private table() {
    return this.prisma.client.orm.public.ExternalEventTemplates
  }

  private toVO(
    row: Awaited<
      ReturnType<ReturnType<ReturnType<ExternalEventTemplatesService['table']>['where']>['first']>
    >,
  ) {
    // Kept as a single projection to avoid leaking tenant metadata into API responses.
    if (!row) throw new NotFoundException('外部事件不存在')
    return {
      id: row.id,
      name: row.name,
      eventType: row.eventType,
      source: row.source,
      apiKeyUserId: row.apiKeyUserId,
      enabled: row.enabled,
      config: row.config as unknown as ExternalEventTemplateConfig,
      version: row.version,
      createdAt: instantToISOString(row.createdAt),
      updatedAt: instantToISOString(row.updatedAt),
    } satisfies ExternalEventTemplateVO
  }

  async list(user: AuthUser) {
    const rows = await this.table()
      .where({ tenantId: user.tenantId })
      .orderBy((row) => row.createdAt.desc())
      .all()
    return rows.map((row) => this.toVO(row))
  }

  async get(user: AuthUser, id: string) {
    const row = await this.table().where({ id, tenantId: user.tenantId }).first()
    return this.toVO(row)
  }

  async findEnabled(user: AuthUser, eventType: string, _legacySource?: string) {
    const row = await this.table()
      .where({ tenantId: user.tenantId, eventType, enabled: true })
      .first()
    if (!row)
      throw new NotFoundException({
        code: 'EVENT_NOT_CONFIGURED',
        message: '外部事件不存在或未启用',
      })
    if (row.apiKeyUserId !== user.id) {
      throw new ForbiddenException({
        code: 'EVENT_KEY_NOT_ALLOWED',
        message: '当前 API Key 不允许执行此事件',
      })
    }
    return this.toVO(row)
  }

  private async validate(user: AuthUser, input: ExternalEventTemplateCreateInput) {
    if (!input.name?.trim() || input.name.length > 100)
      throw new BadRequestException('事件名称长度不正确')
    const account = await this.prisma.client.orm.public.Users.where({
      id: input.apiKeyUserId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!account) throw new BadRequestException('API Key 所属账号不存在或已停用')

    const config = input.config
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new BadRequestException('事件配置无效')
    if (config.flow) {
      await this.validateFlow(user, config)
      return
    }
    if (
      !config.actions ||
      typeof config.actions.convertLead !== 'boolean' ||
      typeof config.actions.updateCustomer !== 'boolean' ||
      (!config.actions.convertLead && !config.actions.updateCustomer)
    )
      throw new BadRequestException('至少启用一种业务动作')
    if (!config.actions.convertLead && config.owner)
      throw new BadRequestException('禁用线索转换时不能设置新客户负责人')
    if (!Array.isArray(config.matches) || config.matches.length < 1 || config.matches.length > 10)
      throw new BadRequestException('需要配置 1～10 个定位字段')
    if (!Array.isArray(config.fields) || config.fields.length > 30)
      throw new BadRequestException('字段映射不能超过 30 个')
    if (!config.actions.convertLead && config.fields.some((field) => field?.source === 'leadOwner'))
      throw new BadRequestException('只有线索转换才能使用原线索负责人')
    if (!config.actions.updateCustomer && !config.actions.convertLead && config.fields.length)
      throw new BadRequestException('没有启用字段更新动作')
    const [leadFields, customerFields] = await Promise.all([
      this.metadata.listFields(user.tenantId, 'lead'),
      this.metadata.listFields(user.tenantId, 'customer'),
    ])
    const knownMatch = new Set([
      'id',
      ...[...leadFields, ...customerFields]
        .filter((f) => !f.hidden && filterOpsForType(f.type).includes('eq'))
        .flatMap((f) => [f.id, f.key]),
    ])
    const writableCustomer = new Map(
      customerFields
        .filter((f) => !f.hidden && !f.system && !['formula', 'sub_product'].includes(f.type))
        .flatMap((f) => [[f.key, f] as const, [f.id, f] as const]),
    )
    const matchKeys = new Set<string>()
    const matchedTargets = new Set<string>()
    for (const match of config.matches) {
      requireKey(match?.externalKey, '定位来源字段')
      if (typeof match?.crmFieldKey !== 'string' || !knownMatch.has(match.crmFieldKey))
        throw new BadRequestException('定位字段未在 CRM 中配置或不可见')
      if (matchKeys.has(match.externalKey)) throw new BadRequestException('定位来源字段重复')
      if (matchedTargets.has(match.crmFieldKey))
        throw new BadRequestException('CRM 定位字段不能重复')
      matchKeys.add(match.externalKey)
      matchedTargets.add(match.crmFieldKey)
    }
    const fieldKeys = new Set<string>()
    for (const mapping of config.fields) {
      if (mapping?.source !== 'event' && mapping?.source !== 'leadOwner')
        throw new BadRequestException('字段映射来源无效')
      if (mapping.source === 'event') requireKey(mapping.externalKey, '字段映射来源')
      const field = writableCustomer.get(mapping.customerFieldKey)
      if (!field) throw new BadRequestException('映射目标不是可写的客户动态字段')
      if (fieldKeys.has(field.key)) throw new BadRequestException('客户字段重复映射')
      if (mapping.source === 'leadOwner' && field.type !== 'member')
        throw new BadRequestException('线索负责人仅可映射成员类型字段')
      if (
        mapping.provider !== undefined &&
        (!PROVIDERS.includes(mapping.provider) ||
          field.type !== 'member' ||
          mapping.source !== 'event')
      )
        throw new BadRequestException('只有来自外部事件的成员型字段支持成员身份映射')
      fieldKeys.add(field.key)
    }
    if (config.owner !== null) {
      if (!config.owner || typeof config.owner !== 'object')
        throw new BadRequestException('客户负责人来源无效')
      requireKey(config.owner.externalKey, '负责人来源字段')
      if (!PROVIDERS.includes(config.owner.provider))
        throw new BadRequestException('负责人身份类型无效')
    }
  }

  private async validateFlow(user: AuthUser, config: ExternalEventTemplateConfig) {
    const flow = config.flow!
    if (!['lead', 'customer'].includes(flow.target))
      throw new BadRequestException('目标模块必须是线索或客户')
    if (!['update', 'create', 'convert', 'upsertCustomer'].includes(flow.action))
      throw new BadRequestException('不支持的业务动作')
    if (flow.action === 'convert' && flow.target !== 'lead')
      throw new BadRequestException('只有线索支持转换为客户')
    if (flow.action === 'upsertCustomer' && flow.target !== 'customer')
      throw new BadRequestException('缴费成功同步的目标模块必须是客户')
    if (flow.action === 'create' || flow.action === 'upsertCustomer') {
      requireKey(flow.nameExternalKey, '学生姓名参数')
    }

    if (
      !Array.isArray(config.matches) ||
      config.matches.length > 10 ||
      (!['create', 'upsertCustomer'].includes(flow.action) && config.matches.length === 0)
    ) {
      throw new BadRequestException('资源定位需要 1～10 个字段；创建和缴费成功同步使用各自的定位配置')
    }

    const target = flow.action === 'convert' || flow.action === 'upsertCustomer'
      ? 'customer'
      : flow.target
    const [lookupFields, targetFields, customerFields, leadFields] = await Promise.all([
      this.metadata.listFields(user.tenantId, flow.target),
      this.metadata.listFields(user.tenantId, target),
      flow.action === 'upsertCustomer'
        ? this.metadata.listFields(user.tenantId, 'customer')
        : Promise.resolve([]),
      flow.action === 'upsertCustomer'
        ? this.metadata.listFields(user.tenantId, 'lead')
        : Promise.resolve([]),
    ])

    if (flow.action === 'upsertCustomer') {
      const identity = flow.identity
      if (!identity) throw new BadRequestException('缴费成功同步必须配置姓名和手机号匹配字段')
      requireKey(identity.phoneExternalKey, '手机号参数')
      if (identity.phoneExternalKey === flow.nameExternalKey)
        throw new BadRequestException('姓名和手机号不能使用同一个外部参数')
      const customerPhone = customerFields.find(
        (field) => field.key === identity.customerPhoneFieldKey || field.id === identity.customerPhoneFieldKey,
      )
      const leadPhone = leadFields.find(
        (field) => field.key === identity.leadPhoneFieldKey || field.id === identity.leadPhoneFieldKey,
      )
      if (
        !customerPhone ||
        customerPhone.hidden ||
        customerPhone.system ||
        !['phone', 'text'].includes(customerPhone.type) ||
        !filterOpsForType(customerPhone.type).includes('eq')
      ) {
        throw new BadRequestException('客户手机号必须映射到可写的手机号或文本型自定义字段')
      }
      if (
        !leadPhone ||
        leadPhone.hidden ||
        !['phone', 'text'].includes(leadPhone.type) ||
        !filterOpsForType(leadPhone.type).includes('eq')
      ) {
        throw new BadRequestException('线索手机号必须映射到可精确匹配的手机号或文本字段')
      }
      if (flow.owner) throw new BadRequestException('缴费成功同步不支持指定新负责人；客户保留原负责人，线索转化继承原负责人')
    }

    const knownMatch = new Set([
      'id',
      ...lookupFields
        .filter((field) => !field.hidden && filterOpsForType(field.type).includes('eq'))
        .flatMap((field) => [field.id, field.key]),
    ])
    const matchKeys = new Set<string>()
    const matchTargets = new Set<string>()
    for (const item of config.matches) {
      requireKey(item?.externalKey, '定位来源字段')
      if (!knownMatch.has(item.crmFieldKey)) throw new BadRequestException('定位字段不属于目标模块')
      if (matchKeys.has(item.externalKey) || matchTargets.has(item.crmFieldKey))
        throw new BadRequestException('资源定位条件不能重复')
      matchKeys.add(item.externalKey)
      matchTargets.add(item.crmFieldKey)
    }

    if (!Array.isArray(flow.fields) || flow.fields.length > 30)
      throw new BadRequestException('字段映射不能超过 30 个')
    if (['update', 'upsertCustomer'].includes(flow.action) && !flow.fields.length)
      throw new BadRequestException('字段更新至少需要一个映射')
    const writable = new Map(
      targetFields
        .filter((field) => !field.hidden && !field.system && !['formula', 'sub_product'].includes(field.type))
        .flatMap((field) => [[field.id, field] as const, [field.key, field] as const]),
    )
    const targets = new Set<string>()
    for (const item of flow.fields) {
      if (item.source !== 'event' && item.source !== 'leadOwner')
        throw new BadRequestException('映射来源无效')
      if (item.source === 'event') requireKey(item.externalKey, '映射来源字段')
      if (item.source === 'leadOwner' && flow.action !== 'convert')
        throw new BadRequestException('原线索负责人只能用于线索转化动作')

      if (item.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY) {
        if (flow.action !== 'create' || flow.target !== 'lead' || item.source !== 'event')
          throw new BadRequestException('线索池映射仅支持新增线索，且必须来自外部事件参数')
        if (item.provider !== undefined)
          throw new BadRequestException('线索池映射不支持成员身份来源')
        if (targets.has(EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY))
          throw new BadRequestException('线索池不能重复映射')
        if (!Array.isArray(item.valueMap) || item.valueMap.length < 1 || item.valueMap.length > 100)
          throw new BadRequestException('线索池映射至少需要一个选项，最多支持 100 项')
        const externalValues = new Set<string>()
        for (const value of item.valueMap) {
          if (typeof value.externalValue !== 'string' || !value.externalValue.trim())
            throw new BadRequestException('外部线索池选项值不能为空')
          if (externalValues.has(value.externalValue))
            throw new BadRequestException('外部线索池选项值不能重复')
          if (typeof value.crmValue !== 'string' || !value.crmValue.trim())
            throw new BadRequestException('请选择对应的 CRM 线索池')
          await this.leads.assertExternalLeadPool(user, value.crmValue)
          externalValues.add(value.externalValue)
        }
        targets.add(EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY)
        continue
      }

      const field = writable.get(item.fieldKey)
      if (!field) throw new BadRequestException('字段映射目标必须为可写的自定义字段')
      if (targets.has(field.key)) throw new BadRequestException('目标字段重复映射')
      if (item.source === 'leadOwner' && field.type !== 'member')
        throw new BadRequestException('原线索负责人只能写入成员类型字段')
      if (item.provider && (!PROVIDERS.includes(item.provider) || field.type !== 'member' || item.source !== 'event'))
        throw new BadRequestException('只有外部成员字段支持身份来源选择')
      if (item.valueMap !== undefined) {
        if (!Array.isArray(item.valueMap) || item.valueMap.length > 100)
          throw new BadRequestException('字段选项映射最多支持 100 项')
        const externalValues = new Set<string>()
        for (const value of item.valueMap) {
          if (typeof value.externalValue !== 'string' || !value.externalValue.trim())
            throw new BadRequestException('外部选项值不能为空')
          if (externalValues.has(value.externalValue))
            throw new BadRequestException('外部选项值不能重复')
          if (!field.options?.some((option) => option.value === value.crmValue))
            throw new BadRequestException(`CRM 字段「${field.label}」不存在映射选项`)
          externalValues.add(value.externalValue)
        }
      }
      if (flow.action === 'upsertCustomer' && item.source !== 'event')
        throw new BadRequestException('缴费成功同步的客户字段映射必须来自外部事件参数')
      targets.add(field.key)
    }

    const poolMapping = flow.fields.find(
      (item) => item.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY,
    )
    if (flow.owner && poolMapping && flow.owner.externalKey === poolMapping.externalKey) {
      throw new BadRequestException('负责人身份参数与线索池参数不能使用同一个外部字段')
    }
    if (
      flow.action === 'create' &&
      flow.target === 'lead' &&
      flow.owner &&
      !poolMapping
    ) {
      throw new BadRequestException('配置了外部负责人时，必须增加「线索池」字段映射，用于负责人无法匹配时确定线索归属')
    }

    if (flow.action === 'upsertCustomer') {
      const identity = flow.identity!
      const customerPhone = customerFields.find(
        (field) => field.key === identity.customerPhoneFieldKey || field.id === identity.customerPhoneFieldKey,
      )!
      const phoneMapping = flow.fields.find(
        (item) =>
          item.source === 'event' &&
          (item.fieldKey === customerPhone.key || item.fieldKey === customerPhone.id),
      )
      if (!phoneMapping || phoneMapping.externalKey !== identity.phoneExternalKey) {
        throw new BadRequestException('客户手机号字段必须映射到与身份匹配相同的外部手机号参数')
      }
    }

    if (flow.owner) {
      if (!['convert', 'create'].includes(flow.action))
        throw new BadRequestException('当前动作不允许指定新负责人')
      requireKey(flow.owner.externalKey, '负责人来源字段')
      if (!PROVIDERS.includes(flow.owner.provider))
        throw new BadRequestException('负责人身份类型无效')
    }
  }

  private mapExternalFieldValue(
    value: unknown,
    mapping: ExternalEventFlow['fields'][number],
  ) {
    const valueMap = mapping.valueMap ?? []
    if (!valueMap.length) return value
    const lookup = new Map(valueMap.map((item) => [item.externalValue, item.crmValue]))
    const mapOne = (item: unknown) => {
      const mapped = lookup.get(String(item))
      if (mapped === undefined) {
        throw new BadRequestException(
          `外部字段 ${mapping.externalKey} 的值「${String(item)}」未配置 CRM 选项映射`,
        )
      }
      return mapped
    }
    return Array.isArray(value) ? value.map(mapOne) : mapOne(value)
  }

  private async preparePaymentSync(
    user: AuthUser,
    template: ExternalEventTemplateVO,
    data: Record<string, unknown>,
  ) {
    const flow = template.config.flow!
    const identity = flow.identity
    if (!identity) throw new BadRequestException('缴费成功同步缺少身份匹配配置')
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 80)
      throw new BadRequestException('外部事件 data 必须是至多 80 个属性的对象')
    const requireData = (key: string) => {
      if (
        !Object.prototype.hasOwnProperty.call(data, key) ||
        data[key] === undefined ||
        data[key] === null ||
        data[key] === ''
      ) {
        throw new BadRequestException(`缺少外部事件参数：${key}`)
      }
      return data[key]
    }

    const rawName = requireData(flow.nameExternalKey!)
    const rawPhone = requireData(identity.phoneExternalKey)
    if (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 100)
      throw new BadRequestException('学生姓名必须是长度 1～100 的字符串')
    if (typeof rawPhone !== 'string' || !rawPhone.trim() || rawPhone.trim().length > 50)
      throw new BadRequestException('手机号必须是长度 1～50 的字符串')

    const name = rawName.trim()
    const phone = rawPhone.trim()
    const resolved = await this.resolver.resolvePaymentTargetOptional(
      user,
      { name, [identity.customerPhoneFieldKey]: phone },
      { name, [identity.leadPhoneFieldKey]: phone },
    )

    const customerFields = await this.metadata.listFields(user.tenantId, 'customer')
    const customerPhoneField = customerFields.find(
      (field) => field.key === identity.customerPhoneFieldKey || field.id === identity.customerPhoneFieldKey,
    )
    if (
      !customerPhoneField ||
      customerPhoneField.hidden ||
      customerPhoneField.system ||
      !['phone', 'text'].includes(customerPhoneField.type)
    ) {
      throw new BadRequestException('客户手机号匹配字段已失效，请重新配置外部事件')
    }
    const memberTargets = new Set(
      customerFields.filter((field) => field.type === 'member').flatMap((field) => [field.id, field.key]),
    )
    const fieldMap = new Map(
      customerFields.flatMap((field) => [[field.id, field] as const, [field.key, field] as const]),
    )
    const set: Record<string, unknown> = {}
    for (const mapping of flow.fields) {
      if (mapping.source !== 'event')
        throw new BadRequestException('缴费成功同步的客户字段映射必须来自外部事件参数')
      const value = requireData(mapping.externalKey)
      const field = fieldMap.get(mapping.fieldKey)
      if (!field) throw new BadRequestException(`客户字段不存在：${mapping.fieldKey}`)
      const normalizedValue =
        mapping.externalKey === identity.phoneExternalKey && field.key === customerPhoneField.key
          ? phone
          : value
      set[field.key] = memberTargets.has(mapping.fieldKey)
        ? await this.resolveMember(user, normalizedValue, mapping.provider ?? 'CRM')
        : this.mapExternalFieldValue(normalizedValue, mapping)
    }
    const normalizedSet = await this.customers.normalizeWritableDynamicFields(user, set)

    return {
      flow,
      resolved,
      set: normalizedSet,
      // Keep the common prepared-flow shape stable; payment sync never assigns a new owner or lead pool.
      ownerId: null,
      poolId: null,
      name,
    }
  }

  async prepareFlow(
    user: AuthUser,
    template: ExternalEventTemplateVO,
    data: Record<string, unknown>,
  ) {
    const flow = template.config.flow
    if (!flow) throw new BadRequestException('不是通用事件配置')
    if (flow.action === 'upsertCustomer') return this.preparePaymentSync(user, template, data)
    if (!['update', 'create', 'convert'].includes(flow.action)) {
      throw new BadRequestException(
        '该外部事件使用已移除的线索状态动作，请编辑配置并重新选择业务动作',
      )
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 80)
      throw new BadRequestException('外部事件 data 必须是至多 80 个属性的对象')
    const requireData = (key: string) => {
      if (
        !Object.prototype.hasOwnProperty.call(data, key) ||
        data[key] === undefined ||
        data[key] === null ||
        data[key] === ''
      )
        throw new BadRequestException(`缺少外部事件参数：${key}`)
      return data[key]
    }
    const resolved =
      flow.action === 'create'
        ? null
        : await this.resolver.resolveTarget(
            user,
            flow.target,
            this.mappedWhere(template.config, data),
            false,
            flow.action === 'convert',
          )
    const target = flow.action === 'convert' ? 'customer' : flow.target
    const memberTargets = new Set(
      (await this.metadata.listFields(user.tenantId, target))
        .filter((f) => f.type === 'member')
        .flatMap((f) => [f.id, f.key]),
    )
    const set: Record<string, unknown> = {}
    for (const mapping of flow.fields) {
      if (mapping.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY) continue
      if (mapping.source === 'leadOwner') {
        if (!resolved || resolved.kind !== 'LEAD')
          throw new BadRequestException('原线索负责人不存在')
        // Pool leads have no owner: leave the original-owner field empty, never
        // misattribute the event-mapped new owner as the historical inviter.
        if (resolved.ownerId) set[mapping.fieldKey] = resolved.ownerId
      } else {
        const value = requireData(mapping.externalKey)
        const provider =
          mapping.provider ??
          (mapping.externalKey === flow.owner?.externalKey ? flow.owner.provider : 'CRM')
        set[mapping.fieldKey] = memberTargets.has(mapping.fieldKey)
          ? await this.resolveMember(user, value, provider)
          : this.mapExternalFieldValue(value, mapping)
      }
    }
    const ownerId = flow.owner
      ? flow.action === 'create' && flow.target === 'lead'
        ? await this.resolveMemberOptional(user, data[flow.owner.externalKey], flow.owner.provider)
        : await this.resolveMember(user, requireData(flow.owner.externalKey), flow.owner.provider)
      : null
    const poolMapping = flow.fields.find(
      (mapping) => mapping.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY,
    )
    let poolId: string | null = null
    if (flow.action === 'create' && flow.target === 'lead' && !ownerId && poolMapping) {
      const externalPoolValue = data[poolMapping.externalKey]
      if (externalPoolValue === undefined || externalPoolValue === null || externalPoolValue === '') {
        const reason = flow.owner ? '负责人无法匹配' : '未指定线索负责人'
        throw new BadRequestException(`${reason}，且缺少用于确定线索池的外部参数：${poolMapping.externalKey}`)
      }
      poolId = this.resolveMappedLeadPool(externalPoolValue, poolMapping)
    }
    if (flow.action === 'create' && flow.target === 'lead' && flow.owner && !ownerId && !poolId) {
      throw new BadRequestException('负责人无法匹配，且外部线索池参数未能映射到有效线索池')
    }
    const rawName = flow.action === 'create' ? requireData(flow.nameExternalKey!) : null
    if (
      rawName !== null &&
      (typeof rawName !== 'string' || !rawName.trim() || rawName.length > 100)
    )
      throw new BadRequestException('创建记录名称必须是长度 1～100 的字符串')
    return {
      flow,
      resolved,
      set,
      ownerId,
      poolId,
      name: rawName as string | null,
    }
  }

  async create(user: AuthUser, input: ExternalEventTemplateCreateInput) {
    await this.validate(user, input)
    // New templates get a stable, unpredictable identity. The stored source is
    // internal to legacy inbox partitioning and is never required in requests.
    const token = randomUUID().replaceAll('-', '').toUpperCase()
    const eventType = `EVENT_${token}`
    const source = `event-${token.toLowerCase()}`
    const now = nowInstant()
    const row = await this.table().create({
      tenantId: user.tenantId,
      name: input.name.trim(),
      eventType,
      source,
      apiKeyUserId: input.apiKeyUserId,
      enabled: input.enabled,
      config: JSON.parse(JSON.stringify(input.config)),
      updatedAt: now,
    })
    return this.toVO(row)
  }

  async update(user: AuthUser, id: string, patch: Partial<ExternalEventTemplateInput>) {
    const before = await this.get(user, id)
    if (patch.eventType !== undefined && patch.eventType !== before.eventType)
      throw new BadRequestException('事件标识不可修改')
    if (patch.source !== undefined && patch.source !== before.source)
      throw new BadRequestException('内部来源不可修改')
    const input = {
      name: before.name,
      apiKeyUserId: before.apiKeyUserId,
      enabled: before.enabled,
      config: before.config,
      ...patch,
      eventType: before.eventType,
      source: before.source,
    }
    await this.validate(user, input)
    const configChanged = !isDeepStrictEqual(input.config, before.config)
    const update: Record<string, unknown> = { updatedAt: nowInstant() }
    if (patch.name !== undefined) update.name = input.name.trim()
    if (patch.apiKeyUserId !== undefined) update.apiKeyUserId = input.apiKeyUserId
    if (patch.enabled !== undefined) update.enabled = input.enabled
    if (configChanged) {
      update.config = JSON.parse(JSON.stringify(input.config))
      update.version = before.version + 1
    }
    const row = await this.table()
      .where(
        configChanged
          ? { id, tenantId: user.tenantId, version: before.version }
          : { id, tenantId: user.tenantId },
      )
      .update(update)
    if (!row) throw new ConflictException('事件配置已被其他管理员修改，请刷新后重试')
    return this.toVO(row)
  }

  async delete(user: AuthUser, id: string) {
    const before = await this.get(user, id)
    if (before.enabled) throw new BadRequestException('请先停用事件，再删除配置')
    await this.table().where({ id, tenantId: user.tenantId }).delete()
    return { id }
  }

  private mappedWhere(config: ExternalEventTemplateConfig, data: Record<string, unknown>) {
    const where: Record<string, unknown> = {}
    for (const mapping of config.matches) {
      if (!Object.prototype.hasOwnProperty.call(data, mapping.externalKey))
        throw new BadRequestException(`缺少定位参数：${mapping.externalKey}`)
      const value = data[mapping.externalKey]
      if (value === null || value === undefined || value === '')
        throw new BadRequestException(`缺少定位参数：${mapping.externalKey}`)
      where[mapping.crmFieldKey] = value
    }
    return where
  }

  private async resolveMember(
    user: AuthUser,
    externalId: unknown,
    provider: ExternalEventUserProvider,
  ) {
    if (typeof externalId !== 'string' || !externalId.trim())
      throw new BadRequestException('缺少客户负责人身份标识')
    let ownerId = externalId.trim()
    if (provider !== 'CRM') {
      const rows = await this.prisma.client.orm.public.ExternalUserMappings.where({
        tenantId: user.tenantId,
        provider,
        active: true,
      })
        .where((row) => or(row.externalId.eq(ownerId), row.externalKey.eq(ownerId)))
        .select('userId')
        .all()
      const ids = [...new Set(rows.map((row) => row.userId))]
      if (ids.length !== 1) throw new BadRequestException('外部接待人员无法唯一映射到 CRM 成员')
      ownerId = ids[0]!
    }
    const active = await this.prisma.client.orm.public.Users.where({
      id: ownerId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!active) throw new BadRequestException('指定的客户负责人不存在或已被停用')
    return active.id
  }

  /** Lead creation treats an unresolved external owner as an unassigned pool lead. */
  private async resolveMemberOptional(
    user: AuthUser,
    externalId: unknown,
    provider: ExternalEventUserProvider,
  ): Promise<string | null> {
    if (typeof externalId !== 'string' || !externalId.trim()) return null
    let ownerId = externalId.trim()
    if (provider !== 'CRM') {
      const rows = await this.prisma.client.orm.public.ExternalUserMappings.where({
        tenantId: user.tenantId,
        provider,
        active: true,
      })
        .where((row) => or(row.externalId.eq(ownerId), row.externalKey.eq(ownerId)))
        .select('userId')
        .all()
      const ids = [...new Set(rows.map((row) => row.userId))]
      if (ids.length !== 1) return null
      ownerId = ids[0]!
    }
    const active = await this.prisma.client.orm.public.Users.where({
      id: ownerId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    return active?.id ?? null
  }

  private resolveMappedLeadPool(
    value: unknown,
    mapping: ExternalEventFlow['fields'][number],
  ) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new BadRequestException(`外部字段 ${mapping.externalKey} 必须提供有效的线索池选项值`)
    }
    const lookup = new Map((mapping.valueMap ?? []).map((item) => [item.externalValue, item.crmValue]))
    const mapped = lookup.get(String(value))
    if (!mapped) {
      throw new BadRequestException(
        `外部字段 ${mapping.externalKey} 的值「${String(value)}」未配置线索池映射`,
      )
    }
    return mapped
  }

  async prepare(user: AuthUser, template: ExternalEventTemplateVO, data: Record<string, unknown>) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new BadRequestException('data 必须为参数对象')
    if (Object.keys(data).length > 80) throw new BadRequestException('事件参数数量过多')
    const where = this.mappedWhere(template.config, data)
    const resolved = await this.resolver.resolve(user, where, template.config.actions.convertLead)
    const memberTargets = new Set(
      (await this.metadata.listFields(user.tenantId, 'customer'))
        .filter((field) => field.type === 'member')
        .flatMap((field) => [field.key, field.id]),
    )
    const set: Record<string, unknown> = {}
    for (const mapping of template.config.fields) {
      if (mapping.source === 'leadOwner') {
        if (resolved.kind === 'LEAD' && resolved.ownerId)
          set[mapping.customerFieldKey] = resolved.ownerId
      } else {
        if (!Object.prototype.hasOwnProperty.call(data, mapping.externalKey))
          throw new BadRequestException(`缺少字段参数：${mapping.externalKey}`)
        const identityProvider =
          mapping.provider ??
          (mapping.externalKey === template.config.owner?.externalKey
            ? template.config.owner.provider
            : 'CRM')
        set[mapping.customerFieldKey] = memberTargets.has(mapping.customerFieldKey)
          ? await this.resolveMember(user, data[mapping.externalKey], identityProvider)
          : data[mapping.externalKey]
      }
    }
    const ownerId =
      resolved.kind === 'LEAD' && template.config.owner
        ? await this.resolveMember(
            user,
            data[template.config.owner.externalKey],
            template.config.owner.provider,
          )
        : null
    return { resolved, where, set, ownerId }
  }

  async preview(user: AuthUser, id: string, data: Record<string, unknown>) {
    const template = await this.get(user, id)
    if (template.config.flow) {
      const plan = await this.prepareFlow(user, template, data)
      const { flow, resolved, set, ownerId } = plan
      if (flow.action === 'upsertCustomer') {
        if (resolved?.kind === 'CUSTOMER') {
          const prepared = await this.customers.prepareExternalEventDynamicFieldUpdate(
            user,
            resolved.customerId,
            set,
          )
          return {
            dryRun: true,
            resolvedType: 'CUSTOMER' as const,
            resolvedId: resolved.customerId,
            action: 'UPDATE_CUSTOMER',
            customerOwnerId: null,
            fieldUpdates: set,
            releasedFromPool: prepared.releaseFromPool,
            note: prepared.releaseFromPool
              ? '匹配到客户公海记录；字段更新后将按完结规则自动移出公海。未写入数据。'
              : '匹配到已有客户；将保留原负责人并更新动态字段。未写入数据。',
          }
        }
        if (resolved?.kind === 'LEAD') {
          if (!hasPermission(user.permissions, 'lead:convert'))
            throw new ForbiddenException('缺少线索转化权限')
          const prepared = await this.leads.prepareResolvedLeadConversion(
            user,
            resolved.leadId,
            set,
            undefined,
            true,
          )
          return {
            dryRun: true,
            resolvedType: 'LEAD' as const,
            resolvedId: resolved.leadId,
            action: 'CONVERT_LEAD',
            customerOwnerId: prepared.customerPrepared.owner?.id ?? null,
            fieldUpdates: set,
            note: '匹配到线索；将直接转化为客户、写入缴费字段并继承原负责人（无负责人时保持为空）。未写入数据。',
          }
        }
        return {
          dryRun: true,
          resolvedType: null,
          resolvedId: '',
          action: 'NO_MATCH',
          customerOwnerId: null,
          fieldUpdates: set,
          note: '未匹配到现有客户或线索；不会新建客户，也不会执行任何写入。未写入数据。',
        }
      }
      if (flow.action === 'update') {
        if (!resolved) throw new BadRequestException('没有定位结果')
        if (resolved.kind === 'CUSTOMER')
          await this.customers.prepareDynamicFieldUpdate(user, resolved.customerId, set)
        else await this.leads.prepareExternalDynamicFieldUpdate(user, resolved.leadId, set)
      } else if (flow.action === 'convert') {
        if (!resolved || resolved.kind !== 'LEAD') throw new BadRequestException('转换目标不是线索')
        if (!hasPermission(user.permissions, 'lead:convert'))
          throw new ForbiddenException('缺少线索转化权限')
        const values = Object.keys(set).length
          ? await this.customers.normalizeWritableDynamicFields(user, set)
          : {}
        await this.leads.prepareResolvedLeadConversion(
          user,
          resolved.leadId,
          values,
          ownerId ?? undefined,
        )
      } else if (flow.action === 'create') {
        if (!hasPermission(user.permissions, `${flow.target}:create`))
          throw new ForbiddenException('缺少创建目标模块的权限')
        if (flow.target === 'customer')
          await this.customers.prepareCreateForTransaction(user, {
            name: plan.name!,
            customData: set,
            ownerId: ownerId ?? undefined,
          })
        else
          await this.leads.prepareExternalLeadCreation(user, {
            name: plan.name!,
            customData: set,
            ownerId: ownerId ?? undefined,
            ...(plan.poolId ? { toPool: true, poolId: plan.poolId } : {}),
          })
      }
      return {
        dryRun: true,
        resolvedType: (resolved?.kind ?? flow.target.toUpperCase()) as 'LEAD' | 'CUSTOMER',
        resolvedId: resolved?.kind === 'LEAD' ? resolved.leadId : (resolved?.customerId ?? ''),
        action: flow.action.toUpperCase(),
        customerOwnerId: ownerId,
        leadPoolId: plan.poolId ?? null,
        fieldUpdates: set,
        note: plan.poolId
          ? flow.owner
            ? '负责人未能匹配到有效 CRM 成员，已根据外部线索池参数映射到目标线索池；未写入数据。'
            : '已根据外部线索池参数映射到目标线索池；未写入数据。'
          : '模拟验证通过；未写入数据。正式执行还会重新检查权限及并发状态',
      }
    }
    const prepared = await this.prepare(user, template, data)
    // Dry-run the same permission, field and customer-capacity validations as real execution.
    if (prepared.resolved.kind === 'LEAD' && template.config.actions.convertLead) {
      if (!hasPermission(user.permissions, 'lead:convert')) {
        throw new ForbiddenException('外部事件调用账号缺少线索转化权限')
      }
      const values = Object.keys(prepared.set).length
        ? await this.customers.normalizeWritableDynamicFields(user, prepared.set)
        : {}
      await this.leads.prepareResolvedLeadConversion(
        user,
        prepared.resolved.leadId,
        values,
        prepared.ownerId ?? undefined,
      )
    }
    if (
      prepared.resolved.kind === 'CUSTOMER' &&
      template.config.actions.updateCustomer &&
      Object.keys(prepared.set).length
    ) {
      await this.customers.prepareDynamicFieldUpdate(
        user,
        prepared.resolved.customerId,
        prepared.set,
      )
    }
    return {
      dryRun: true,
      resolvedType: prepared.resolved.kind,
      resolvedId:
        prepared.resolved.kind === 'LEAD' ? prepared.resolved.leadId : prepared.resolved.customerId,
      action:
        prepared.resolved.kind === 'LEAD'
          ? template.config.actions.convertLead
            ? 'CONVERT_AND_UPDATE'
            : 'SKIP_LEAD'
          : template.config.actions.updateCustomer
            ? 'UPDATE_CUSTOMER'
            : 'SKIP_CUSTOMER',
      customerOwnerId: prepared.ownerId,
      fieldUpdates: prepared.set,
      note: '已校验定位、字段与业务权限，但未执行数据库写入；正式调用还会检查并发状态',
    }
  }
}
