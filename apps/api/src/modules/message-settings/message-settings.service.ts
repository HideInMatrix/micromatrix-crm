import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {
  MESSAGE_TASK_DEFINITIONS,
  defaultMessageTaskConfig,
  type BatchUpdateMessageTaskSettingInput,
  type MessageTaskConfig,
  type MessageTaskDefinition,
  type MessageTaskEvent,
  type MessageTaskGroupVO,
  type MessageChannelGateVO,
  type MessageTaskModule,
  type MessageTaskSettingVO,
  type UpdateMessageTaskSettingInput,
} from '@micromatrix/shared'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { jsonValue } from '../../prisma/json-value'

const CACHE_NAMESPACE = 'message-settings'
const CACHE_TTL_SECONDS = 5 * 60

@Injectable()
export class MessageSettingsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  async list(tenantId: string): Promise<MessageTaskGroupVO[]> {
    if (this.cache) {
      return this.cache.remember({
        tenantId,
        namespace: CACHE_NAMESPACE,
        key: 'list',
        ttlSeconds: CACHE_TTL_SECONDS,
        loader: () => this.loadList(tenantId),
      })
    }
    return this.loadList(tenantId)
  }

  private async loadList(tenantId: string): Promise<MessageTaskGroupVO[]> {
    const rows = await this.prisma8.client.orm.public.MessageTaskSettings.where({ tenantId }).all()
    const rowMap = new Map(rows.map((row) => [row.event, row]))
    const groups = new Map<MessageTaskModule, MessageTaskGroupVO>()

    for (const definition of MESSAGE_TASK_DEFINITIONS) {
      const group = groups.get(definition.module) ?? {
        module: definition.module,
        moduleName: definition.moduleName,
        items: [],
      }
      group.items.push(this.toVO(definition, rowMap.get(definition.event)))
      groups.set(definition.module, group)
    }
    return [...groups.values()]
  }

  async getConfig(tenantId: string, event: string): Promise<MessageTaskConfig | null> {
    const definition = this.definition(event)
    if (!definition.configurable) return null
    return (await this.getEffectiveSetting(tenantId, event)).config
  }

  async getEffectiveSetting(tenantId: string, event: string): Promise<MessageTaskSettingVO> {
    const definition = this.definition(event)
    if (this.cache) {
      return this.cache.remember({
        tenantId,
        namespace: CACHE_NAMESPACE,
        key: `event:${definition.event}`,
        ttlSeconds: CACHE_TTL_SECONDS,
        loader: () => this.loadEffectiveSetting(tenantId, definition),
      })
    }
    return this.loadEffectiveSetting(tenantId, definition)
  }

  private async loadEffectiveSetting(
    tenantId: string,
    definition: MessageTaskDefinition,
  ): Promise<MessageTaskSettingVO> {
    const row = await this.prisma8.client.orm.public.MessageTaskSettings.where({
      tenantId,
      module: definition.module,
      event: definition.event,
    }).first()
    return this.toVO(definition, row ?? undefined)
  }

  async resolveRecipients(
    tenantId: string,
    event: string,
    context: { ownerId?: string | null; createUserId?: string | null },
  ): Promise<string[]> {
    const setting = await this.getEffectiveSetting(tenantId, event)
    if (!setting.configurable || !setting.config) {
      throw new BadRequestException('该事件不支持通知范围配置')
    }

    const config = setting.config
    const recipientIds = new Set<string>()
    for (const userId of config.userIds) {
      if (userId === 'OWNER') {
        if (context.ownerId) recipientIds.add(context.ownerId)
      } else if (userId === 'CREATE_USER') {
        if (context.createUserId) recipientIds.add(context.createUserId)
      } else {
        recipientIds.add(userId)
      }
    }

    if (config.roleEnable && config.roleIds.length > 0) {
      const roleMembers = await this.prisma8.client.orm.public.UserRoles.where({ tenantId })
        .where((row) => row.roleId.in(config.roleIds))
        .select('userId')
        .all()
      for (const member of roleMembers) recipientIds.add(member.userId)
    }

    if (config.ownerEnable && context.ownerId) {
      const owner = await this.prisma8.client.orm.public.Users.where({
        id: context.ownerId,
        tenantId,
        status: 'ACTIVE',
      })
        .select('deptId')
        .first()
      let departmentId = owner?.deptId ?? null
      const levelCount = Math.max(1, config.ownerLevel)
      for (let level = 0; departmentId && level < levelCount; level++) {
        const department = await this.prisma8.client.orm.public.Departments.where({
          id: departmentId,
          tenantId,
        })
          .select('leaderId', 'parentId')
          .first()
        if (!department) break
        if (department.leaderId) recipientIds.add(department.leaderId)
        departmentId = department.parentId
      }
    }

    if (recipientIds.size === 0) return []
    const activeUsers = await this.prisma8.client.orm.public.Users.where({
      tenantId,
      status: 'ACTIVE',
    })
      .where((row) => row.id.in([...recipientIds]))
      .select('id')
      .all()
    return activeUsers.map((user) => user.id)
  }

  async update(
    tenantId: string,
    event: string,
    input: UpdateMessageTaskSettingInput,
  ): Promise<MessageTaskSettingVO> {
    const definition = this.definition(event)
    if (input.module !== definition.module) throw new BadRequestException('消息模块与事件不匹配')
    if (
      input.systemEnabled === undefined &&
      input.emailEnabled === undefined &&
      input.weComEnabled === undefined &&
      input.dingTalkEnabled === undefined &&
      input.larkEnabled === undefined &&
      input.config === undefined
    ) {
      throw new BadRequestException('至少提供一项要更新的消息设置')
    }
    if (input.config !== undefined) {
      if (!definition.configurable) throw new BadRequestException('该事件不支持范围配置')
      await this.validateConfig(tenantId, definition, input.config)
    }
    if (input.weComEnabled === true) await this.assertWeComAvailable(tenantId)
    if (input.dingTalkEnabled === true) await this.assertDingTalkAvailable(tenantId)
    if (input.larkEnabled === true) await this.assertLarkAvailable(tenantId)

    const rows = this.prisma8.client.orm.public.MessageTaskSettings
    const existing = await rows
      .where({
        tenantId,
        module: definition.module,
        event: definition.event,
      })
      .first()
    const updateData = {
      ...(input.systemEnabled === undefined ? {} : { systemEnabled: input.systemEnabled }),
      ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
      ...(input.weComEnabled === undefined ? {} : { weComEnabled: input.weComEnabled }),
      ...(input.dingTalkEnabled === undefined ? {} : { dingTalkEnabled: input.dingTalkEnabled }),
      ...(input.larkEnabled === undefined ? {} : { larkEnabled: input.larkEnabled }),
      ...(input.config === undefined ? {} : { config: jsonValue(input.config) }),
      updatedAt: prisma8Now(),
    }
    const row = existing
      ? await rows.where({ id: existing.id }).update(updateData)
      : await rows.create({
          tenantId,
          module: definition.module,
          event: definition.event,
          systemEnabled: input.systemEnabled ?? definition.defaultSystemEnabled,
          emailEnabled: input.emailEnabled ?? definition.defaultEmailEnabled,
          weComEnabled: input.weComEnabled ?? false,
          dingTalkEnabled: input.dingTalkEnabled ?? false,
          larkEnabled: input.larkEnabled ?? false,
          ...(input.config === undefined ? {} : { config: jsonValue(input.config) }),
          updatedAt: prisma8Now(),
        })
    if (!row) throw new NotFoundException('消息设置不存在')
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.toVO(definition, row)
  }

  async batchUpdate(
    tenantId: string,
    input: BatchUpdateMessageTaskSettingInput,
  ): Promise<MessageTaskGroupVO[]> {
    if (
      input.systemEnabled === undefined &&
      input.emailEnabled === undefined &&
      input.weComEnabled === undefined &&
      input.dingTalkEnabled === undefined &&
      input.larkEnabled === undefined
    ) {
      throw new BadRequestException('至少提供一个渠道开关')
    }
    if (input.weComEnabled === true) await this.assertWeComAvailable(tenantId)
    if (input.dingTalkEnabled === true) await this.assertDingTalkAvailable(tenantId)
    if (input.larkEnabled === true) await this.assertLarkAvailable(tenantId)
    await this.prisma8.client.transaction(async (tx) => {
      const rows = tx.orm.public.MessageTaskSettings
      for (const definition of MESSAGE_TASK_DEFINITIONS) {
        const existing = await rows
          .where({
            tenantId,
            module: definition.module,
            event: definition.event,
          })
          .first()
        const patch = {
          ...(input.systemEnabled === undefined ? {} : { systemEnabled: input.systemEnabled }),
          ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
          ...(input.weComEnabled === undefined ? {} : { weComEnabled: input.weComEnabled }),
          ...(input.dingTalkEnabled === undefined
            ? {}
            : { dingTalkEnabled: input.dingTalkEnabled }),
          ...(input.larkEnabled === undefined ? {} : { larkEnabled: input.larkEnabled }),
          updatedAt: prisma8Now(),
        }
        if (existing) {
          await rows.where({ id: existing.id }).update(patch)
        } else {
          await rows.create({
            tenantId,
            module: definition.module,
            event: definition.event,
            systemEnabled: input.systemEnabled ?? definition.defaultSystemEnabled,
            emailEnabled: input.emailEnabled ?? definition.defaultEmailEnabled,
            weComEnabled: input.weComEnabled ?? false,
            dingTalkEnabled: input.dingTalkEnabled ?? false,
            larkEnabled: input.larkEnabled ?? false,
            updatedAt: prisma8Now(),
          })
        }
      }
    })
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.list(tenantId)
  }

  async isSystemEnabled(tenantId: string, event: MessageTaskEvent): Promise<boolean> {
    return (await this.getEffectiveSetting(tenantId, event)).systemEnabled
  }

  async isWeComEnabled(tenantId: string, event: MessageTaskEvent): Promise<boolean> {
    return (await this.getEffectiveSetting(tenantId, event)).weComEnabled
  }

  async isDingTalkEnabled(tenantId: string, event: MessageTaskEvent): Promise<boolean> {
    return (await this.getEffectiveSetting(tenantId, event)).dingTalkEnabled
  }

  async isLarkEnabled(tenantId: string, event: MessageTaskEvent): Promise<boolean> {
    return (await this.getEffectiveSetting(tenantId, event)).larkEnabled
  }

  async getWeComChannelGate(tenantId: string): Promise<MessageChannelGateVO> {
    const [integration, tenant] = await Promise.all([
      this.prisma8.client.orm.public.EnterpriseIntegrations.where({
        tenantId,
        provider: 'WECOM',
      }).first(),
      this.prisma8.client.orm.public.Tenants.where({ id: tenantId })
        .select('enterpriseSyncResource')
        .first(),
    ])
    const active = tenant?.enterpriseSyncResource === 'WECOM'
    const reason = !active
      ? '当前企业协同平台不是企业微信'
      : !integration
        ? '请先配置企业微信'
        : integration.lastTestSucceeded !== true
          ? '请先完成企业微信连接测试'
          : !integration.syncEnabled
            ? '请先开启企业微信组织同步'
            : null
    return {
      channel: 'WECOM',
      configured: Boolean(integration),
      verified: integration?.lastTestSucceeded === true,
      enabled: active && integration?.syncEnabled === true,
      available: reason === null,
      reason,
    }
  }

  async getDingTalkChannelGate(tenantId: string): Promise<MessageChannelGateVO> {
    const [integration, tenant] = await Promise.all([
      this.prisma8.client.orm.public.EnterpriseIntegrations.where({
        tenantId,
        provider: 'DINGTALK',
      }).first(),
      this.prisma8.client.orm.public.Tenants.where({ id: tenantId })
        .select('enterpriseSyncResource')
        .first(),
    ])
    const active = tenant?.enterpriseSyncResource === 'DINGTALK'
    const reason = !active
      ? '当前企业协同平台不是钉钉'
      : !integration
        ? '请先配置钉钉'
        : integration.lastTestSucceeded !== true
          ? '请先完成钉钉连接测试'
          : !integration.syncEnabled
            ? '请先开启钉钉组织同步'
            : null
    return {
      channel: 'DINGTALK',
      configured: Boolean(integration),
      verified: integration?.lastTestSucceeded === true,
      enabled: active && integration?.syncEnabled === true,
      available: reason === null,
      reason,
    }
  }

  async getLarkChannelGate(tenantId: string): Promise<MessageChannelGateVO> {
    const [integration, tenant] = await Promise.all([
      this.prisma8.client.orm.public.EnterpriseIntegrations.where({
        tenantId,
        provider: 'LARK',
      }).first(),
      this.prisma8.client.orm.public.Tenants.where({ id: tenantId })
        .select('enterpriseSyncResource')
        .first(),
    ])
    const active = tenant?.enterpriseSyncResource === 'LARK'
    const reason = !active
      ? '当前企业协同平台不是飞书'
      : !integration
        ? '请先配置飞书'
        : integration.lastTestSucceeded !== true
          ? '请先完成飞书连接测试'
          : !integration.syncEnabled
            ? '请先开启飞书组织同步'
            : null
    return {
      channel: 'LARK',
      configured: Boolean(integration),
      verified: integration?.lastTestSucceeded === true,
      enabled: active && integration?.syncEnabled === true,
      available: reason === null,
      reason,
    }
  }

  private definition(event: string): MessageTaskDefinition {
    const definition = MESSAGE_TASK_DEFINITIONS.find((item) => item.event === event)
    if (!definition) throw new NotFoundException('消息事件不存在')
    return definition
  }

  private async validateConfig(
    tenantId: string,
    definition: MessageTaskDefinition,
    config: MessageTaskConfig,
  ): Promise<void> {
    if (!definition.timeConfigurable && config.timeList.length > 0) {
      throw new BadRequestException('该事件不支持提前提醒时间')
    }
    const timeValues = config.timeList.map((item) => `${item.timeValue}:${item.timeUnit}`)
    if (new Set(timeValues).size !== timeValues.length) {
      throw new BadRequestException('提醒时间不能重复')
    }
    if (!config.userIds.includes('OWNER')) {
      throw new BadRequestException('通知人员必须包含负责人')
    }
    const normalUserIds = [...new Set(config.userIds.filter((id) => id !== 'OWNER'))]
    if (normalUserIds.length > 0) {
      const users = await this.prisma8.client.orm.public.Users.where({
        tenantId,
        status: 'ACTIVE',
      })
        .where((row) => row.id.in(normalUserIds))
        .select('id')
        .all()
      if (users.length !== normalUserIds.length) throw new BadRequestException('存在无效的通知成员')
    }
    const roleIds = [...new Set(config.roleIds)]
    if (config.roleEnable && roleIds.length === 0) {
      throw new BadRequestException('开启角色通知后至少选择一个角色')
    }
    if (roleIds.length > 0) {
      const roles = await this.prisma8.client.orm.public.Roles.where({ tenantId })
        .where((row) => row.id.in(roleIds))
        .select('id')
        .all()
      if (roles.length !== roleIds.length) throw new BadRequestException('存在无效的通知角色')
    }
  }

  private toVO(
    definition: MessageTaskDefinition,
    row?: {
      systemEnabled: boolean
      emailEnabled: boolean
      weComEnabled: boolean
      dingTalkEnabled: boolean
      larkEnabled: boolean
      config: unknown
    },
  ): MessageTaskSettingVO {
    return {
      ...definition,
      systemEnabled: row?.systemEnabled ?? definition.defaultSystemEnabled,
      emailEnabled: row?.emailEnabled ?? definition.defaultEmailEnabled,
      weComEnabled: row?.weComEnabled ?? false,
      dingTalkEnabled: row?.dingTalkEnabled ?? false,
      larkEnabled: row?.larkEnabled ?? false,
      config: this.configFrom(row?.config, definition.event),
    }
  }

  private configFrom(value: unknown, event: MessageTaskEvent): MessageTaskConfig | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return defaultMessageTaskConfig(event)
    }
    return value as unknown as MessageTaskConfig
  }

  private async assertWeComAvailable(tenantId: string): Promise<void> {
    const gate = await this.getWeComChannelGate(tenantId)
    if (!gate.available) throw new BadRequestException(gate.reason ?? '企业微信消息渠道不可用')
  }

  private async assertDingTalkAvailable(tenantId: string): Promise<void> {
    const gate = await this.getDingTalkChannelGate(tenantId)
    if (!gate.available) throw new BadRequestException(gate.reason ?? '钉钉消息渠道不可用')
  }

  private async assertLarkAvailable(tenantId: string): Promise<void> {
    const gate = await this.getLarkChannelGate(tenantId)
    if (!gate.available) throw new BadRequestException(gate.reason ?? '飞书消息渠道不可用')
  }
}
