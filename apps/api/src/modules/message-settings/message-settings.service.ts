import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  MESSAGE_TASK_DEFINITIONS,
  defaultMessageTaskConfig,
  type BatchUpdateMessageTaskSettingInput,
  type MessageTaskConfig,
  type MessageTaskDefinition,
  type MessageTaskEvent,
  type MessageTaskGroupVO,
  type MessageTaskModule,
  type MessageTaskSettingVO,
  type UpdateMessageTaskSettingInput,
} from '@micromatrix/shared'
import { Prisma, type MessageTaskSetting } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class MessageSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<MessageTaskGroupVO[]> {
    const rows = await this.prisma.messageTaskSetting.findMany({ where: { tenantId } })
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
    const row = await this.prisma.messageTaskSetting.findFirst({
      where: { tenantId, module: definition.module, event: definition.event },
    })
    return this.configFrom(row?.config, definition.event)
  }

  async getEffectiveSetting(tenantId: string, event: string): Promise<MessageTaskSettingVO> {
    const definition = this.definition(event)
    const row = await this.prisma.messageTaskSetting.findFirst({
      where: { tenantId, module: definition.module, event: definition.event },
    })
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
      const roleMembers = await this.prisma.userRole.findMany({
        where: { tenantId, roleId: { in: config.roleIds } },
        select: { userId: true },
      })
      for (const member of roleMembers) recipientIds.add(member.userId)
    }

    if (config.ownerEnable && context.ownerId) {
      const owner = await this.prisma.user.findFirst({
        where: { id: context.ownerId, tenantId, status: 'ACTIVE' },
        select: { deptId: true },
      })
      let departmentId = owner?.deptId ?? null
      const levelCount = Math.max(1, config.ownerLevel)
      for (let level = 0; departmentId && level < levelCount; level++) {
        const department = await this.prisma.department.findFirst({
          where: { id: departmentId, tenantId },
          select: { leaderId: true, parentId: true },
        })
        if (!department) break
        if (department.leaderId) recipientIds.add(department.leaderId)
        departmentId = department.parentId
      }
    }

    if (recipientIds.size === 0) return []
    const activeUsers = await this.prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', id: { in: [...recipientIds] } },
      select: { id: true },
    })
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
      input.config === undefined
    ) {
      throw new BadRequestException('至少提供一项要更新的消息设置')
    }
    if (input.config !== undefined) {
      if (!definition.configurable) throw new BadRequestException('该事件不支持范围配置')
      await this.validateConfig(tenantId, definition, input.config)
    }

    const row = await this.prisma.messageTaskSetting.upsert({
      where: {
        tenantId_module_event: {
          tenantId,
          module: definition.module,
          event: definition.event,
        },
      },
      update: {
        ...(input.systemEnabled === undefined ? {} : { systemEnabled: input.systemEnabled }),
        ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
        ...(input.config === undefined
          ? {}
          : { config: input.config as unknown as Prisma.InputJsonValue }),
      },
      create: {
        tenantId,
        module: definition.module,
        event: definition.event,
        systemEnabled: input.systemEnabled ?? definition.defaultSystemEnabled,
        emailEnabled: input.emailEnabled ?? definition.defaultEmailEnabled,
        config:
          input.config === undefined
            ? undefined
            : (input.config as unknown as Prisma.InputJsonValue),
      },
    })
    return this.toVO(definition, row)
  }

  async batchUpdate(
    tenantId: string,
    input: BatchUpdateMessageTaskSettingInput,
  ): Promise<MessageTaskGroupVO[]> {
    if (input.systemEnabled === undefined && input.emailEnabled === undefined) {
      throw new BadRequestException('至少提供一个渠道开关')
    }
    await this.prisma.$transaction(
      MESSAGE_TASK_DEFINITIONS.map((definition) =>
        this.prisma.messageTaskSetting.upsert({
          where: {
            tenantId_module_event: {
              tenantId,
              module: definition.module,
              event: definition.event,
            },
          },
          update: {
            ...(input.systemEnabled === undefined ? {} : { systemEnabled: input.systemEnabled }),
            ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
          },
          create: {
            tenantId,
            module: definition.module,
            event: definition.event,
            systemEnabled: input.systemEnabled ?? definition.defaultSystemEnabled,
            emailEnabled: input.emailEnabled ?? definition.defaultEmailEnabled,
          },
        }),
      ),
    )
    return this.list(tenantId)
  }

  async isSystemEnabled(tenantId: string, event: MessageTaskEvent): Promise<boolean> {
    const definition = this.definition(event)
    const row = await this.prisma.messageTaskSetting.findFirst({
      where: { tenantId, module: definition.module, event: definition.event },
      select: { systemEnabled: true },
    })
    return row?.systemEnabled ?? definition.defaultSystemEnabled
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
      const count = await this.prisma.user.count({
        where: { tenantId, id: { in: normalUserIds }, status: 'ACTIVE' },
      })
      if (count !== normalUserIds.length) throw new BadRequestException('存在无效的通知成员')
    }
    const roleIds = [...new Set(config.roleIds)]
    if (config.roleEnable && roleIds.length === 0) {
      throw new BadRequestException('开启角色通知后至少选择一个角色')
    }
    if (roleIds.length > 0) {
      const count = await this.prisma.role.count({ where: { tenantId, id: { in: roleIds } } })
      if (count !== roleIds.length) throw new BadRequestException('存在无效的通知角色')
    }
  }

  private toVO(
    definition: MessageTaskDefinition,
    row?: Pick<MessageTaskSetting, 'systemEnabled' | 'emailEnabled' | 'config'>,
  ): MessageTaskSettingVO {
    return {
      ...definition,
      systemEnabled: row?.systemEnabled ?? definition.defaultSystemEnabled,
      emailEnabled: row?.emailEnabled ?? definition.defaultEmailEnabled,
      config: this.configFrom(row?.config, definition.event),
    }
  }

  private configFrom(
    value: Prisma.JsonValue | undefined,
    event: MessageTaskEvent,
  ): MessageTaskConfig | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return defaultMessageTaskConfig(event)
    }
    return value as unknown as MessageTaskConfig
  }
}
