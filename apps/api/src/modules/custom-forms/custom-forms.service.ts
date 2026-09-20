import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  filterOpsForType,
  formatLocationValue,
  isBuiltinDataSourceType,
  splitLocationValue,
  type BuiltinDataSourceType,
  type FieldConfig,
  type FieldVO,
  type FilterCondition,
  type ImportResultVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { BatchIdsDto, ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import type { PrismaClient } from '../../prisma/prisma-client.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AttachmentsService } from '../attachments/attachments.service'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  SpreadsheetService,
  type ParsedMultiSubTableSpreadsheetRow,
} from '../import-export/spreadsheet.service'
import { CreateFieldDto, ReorderFieldsDto, UpdateFieldDto } from '../metadata/dto/field.dto'
import { MetadataService } from '../metadata/metadata.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import type {
  CreateUserViewDto,
  EditUserViewPosDto,
  UpdateUserViewDto,
  UserViewConditionDto,
} from '../user-views/dto/user-view.dto'
import { customFormUserViewResourceType } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import type {
  CustomFormDataPageDto,
  CustomFormRoleKey,
  SaveCustomFormDataDto,
  SaveCustomFormDto,
} from './dto/custom-form.dto'

type PrismaRawExpression = ReturnType<ReturnType<PrismaService['client']['raw']['sql']>['returns']>
type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
type CustomFormDataRow = NonNullable<
  Awaited<ReturnType<PrismaService['client']['orm']['public']['CustomFormData']['first']>>
>

const ROLE_DEFINITIONS: Array<{ key: CustomFormRoleKey; name: string }> = [
  { key: 'MANAGE_ALL', name: '管理全部数据' },
  { key: 'VIEW_ALL', name: '查看全部数据' },
  { key: 'MANAGE_OWN', name: '管理本人数据' },
]

const BLOB_FIELD_TYPES = new Set([
  'textarea',
  'multiselect',
  'checkbox',
  'picture',
  'attachment',
  'data_source_multiple',
])
const CUSTOM_FORM_ATTACHMENT_TARGET = 'customFormData'
const BUILTIN_DATA_SOURCE_FORM_KEYS: Partial<Record<BuiltinDataSourceType, string>> = {
  CUSTOMER: 'customer',
  CONTACT: 'contact',
  OPPORTUNITY: 'opportunity',
  PRODUCT: 'product',
  CLUE: 'lead',
  PRICE: 'price',
  CONTRACT: 'contract',
  QUOTATION: 'quote',
  PAYMENT_PLAN: 'contractPaymentPlan',
  CONTRACT_PAYMENT_RECORD: 'contractPaymentRecord',
  ORDER: 'order',
  INVOICE: 'invoice',
}

function dataSourceReferenceKey(sourceType: string, id: string): string {
  return `${sourceType}:${id}`
}

interface AccessState {
  isAdmin: boolean
  canViewAll: boolean
  canManageAll: boolean
  canManageOwn: boolean
  canCreate: boolean
}

interface DataRow {
  id: string
  customFormId: string
  name: string
  ownerId: string
  organizationId: string
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
  fieldValues: Array<{
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: number | null
    bizId: string | null
  }>
  fieldBlobValues: Array<{
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: number | null
    bizId: string | null
  }>
}

interface DataExportRow {
  id: string
  customFormId: string
  name: string
  ownerId: string
  organizationId: string
  createTime: number
  updateTime: number
  createUser: string
  updateUser: string
  values: Record<string, unknown>
}

interface ExportReferenceMaps {
  users: Map<string, string>
  departments: Map<string, string>
  dataSources: Map<string, string>
}

interface CustomFormSubTableImportGroup {
  key: string
  rowNum: number
  resourceId?: string
  values: Record<string, unknown>
  subRows: Record<string, Record<string, unknown>[]>
  errors: string[]
}

@Injectable()
export class CustomFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleForms: ModuleFormsService,
    private readonly metadata: MetadataService,
    private readonly attachments: AttachmentsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly userViews: UserViewsService,
  ) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.client.orm.public.CustomForm.where({
      organizationId: user.tenantId,
    })
      .orderBy([(row) => row.updateTime.desc(), (row) => row.id.asc()])
      .all()
    if (!rows.length) return []
    const formIds = rows.map((row) => row.id)
    const [admins, roleUsers] = await Promise.all([
      this.prisma.client.orm.public.CustomFormAdmin.where({
        userId: user.id,
      })
        .where((row) => row.customFormId.in(formIds))
        .select('customFormId')
        .all(),
      this.prisma.client.orm.public.CustomFormRoleUser.where({
        userId: user.id,
      })
        .select('roleId')
        .all(),
    ])
    const roleIds = [...new Set(roleUsers.map((row) => row.roleId))]
    const roles = roleIds.length
      ? await this.prisma.client.orm.public.CustomFormRole.where((role) => role.id.in(roleIds))
          .where((role) => role.customFormId.in(formIds))
          .select('customFormId', 'internalKey')
          .all()
      : []
    const adminFormIds = new Set(admins.map((row) => row.customFormId))
    const roleKeysByForm = new Map<string, Set<string>>()
    for (const role of roles) {
      const keys = roleKeysByForm.get(role.customFormId) ?? new Set<string>()
      keys.add(role.internalKey)
      roleKeysByForm.set(role.customFormId, keys)
    }

    return rows
      .filter((row) => adminFormIds.has(row.id) || (row.enable && roleKeysByForm.has(row.id)))
      .map((row) => {
        const roleKeys = roleKeysByForm.get(row.id) ?? new Set<string>()
        const isAdmin = adminFormIds.has(row.id)
        return {
          id: row.id,
          name: row.name,
          enable: row.enable,
          organizationId: row.organizationId,
          isAdmin,
          hasCreateDataPermission:
            isAdmin || roleKeys.has('MANAGE_ALL') || roleKeys.has('MANAGE_OWN'),
        }
      })
  }

  async options(user: AuthUser) {
    return this.prisma.client.orm.public.CustomForm.where({
      organizationId: user.tenantId,
      enable: true,
    })
      .select('id', 'name')
      .orderBy([(row) => row.updateTime.desc(), (row) => row.id.asc()])
      .all()
  }

  async detail(user: AuthUser, id: string) {
    const { form, access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const [config, creator] = await Promise.all([
      this.moduleForms.getConfig(user.tenantId, id),
      this.prisma.client.orm.public.Users.where({
        id: form.createUser,
        tenantId: user.tenantId,
      })
        .select('id', 'name')
        .first(),
    ])
    return {
      id: form.id,
      name: form.name,
      enable: form.enable,
      organizationId: form.organizationId,
      creator,
      isAdmin: access.isAdmin,
      hasCreateDataPermission: access.canCreate,
      formProp: config.formProp,
      fields: config.fields,
    }
  }

  async create(user: AuthUser, input: SaveCustomFormDto) {
    const name = input.name.trim()
    await this.ensureNameUnique(user.tenantId, name)
    const now = BigInt(Date.now())

    const form = await this.prisma.client.transaction(async (tx) => {
      const created = await tx.orm.public.CustomForm.create({
        id: createLegacyId32(),
        name: name,
        enable: input.enable ?? true,
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })

      await tx.orm.public.SysModuleForm.create({
        id: created.id,
        formKey: created.id,
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await tx.orm.public.SysModuleFormBlob.create({
        id: created.id,
        prop: JSON.stringify(input.formProp ?? {}),
      })

      await Promise.all([
        this.createSystemField(tx, created.id, 'name', '名称', 'text', 0, user.id, now),
        this.createSystemField(tx, created.id, 'ownerId', '负责人', 'member', 1, user.id, now),
      ])

      await tx.orm.public.CustomFormRole.createAll(
        ROLE_DEFINITIONS.map((role) => ({
          id: createLegacyId32(),
          name: role.name,
          customFormId: created.id,
          internalKey: role.key,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        })),
      )
      await tx.orm.public.CustomFormAdmin.create({
        id: createLegacyId32(),
        customFormId: created.id,
        userId: user.id,
      })
      return created
    })

    await this.moduleForms.invalidateFormCache(user.tenantId, form.id)
    return this.detail(user, form.id)
  }

  async update(user: AuthUser, id: string, input: SaveCustomFormDto) {
    await this.requireAdmin(user, id)
    const name = input.name.trim()
    await this.ensureNameUnique(user.tenantId, name, id)
    const now = BigInt(Date.now())
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.CustomForm.where({ id: id }).update({
        name: name,
        enable: input.enable,
        updateTime: now,
        updateUser: user.id,
      })
      if (input.formProp !== undefined) {
        await tx.orm.public.SysModuleForm.where({ id: id }).update({
          updateTime: now,
          updateUser: user.id,
        })
        const blob = await tx.orm.public.SysModuleFormBlob.where({
          id: id,
        })
          .select('id')
          .first()
        if (blob) {
          await tx.orm.public.SysModuleFormBlob.where({ id: blob.id }).update({
            prop: JSON.stringify(input.formProp),
          })
        } else {
          await tx.orm.public.SysModuleFormBlob.create({
            id: id,
            prop: JSON.stringify(input.formProp),
          })
        }
      }
    })
    await this.moduleForms.invalidateFormCache(user.tenantId, id)
    return this.detail(user, id)
  }

  async setStatus(user: AuthUser, id: string, enable: boolean) {
    await this.requireAdmin(user, id)
    const row = await this.prisma.client.orm.public.CustomForm.where({
      id: id,
    }).update({ enable, updateTime: BigInt(Date.now()), updateUser: user.id })
    if (!row) throw new NotFoundException('自定义表单不存在')
    return { id: row.id, enable: row.enable }
  }

  async remove(user: AuthUser, id: string) {
    await this.requireAdmin(user, id)
    const dataRows = await this.prisma.client.orm.public.CustomFormData.where({
      organizationId: user.tenantId,
      customFormId: id,
    })
      .select('id')
      .all()
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.SysUserView.where({
        organizationId: user.tenantId,
        resourceType: customFormUserViewResourceType(id),
      }).deleteAll()
      await tx.orm.public.SysModuleForm.where({
        id: id,
        organizationId: user.tenantId,
      }).deleteAll()
      await tx.orm.public.CustomForm.where({ id: id }).delete()
    })
    await this.attachments.removeAllFromTargets(
      user.tenantId,
      CUSTOM_FORM_ATTACHMENT_TARGET,
      dataRows.map((row) => row.id),
    )
    await this.moduleForms.invalidateFormCache(user.tenantId, id)
    return { id }
  }

  async admins(user: AuthUser, id: string) {
    await this.resolveAccess(user, id, { requireEnabled: false })
    const rows = await this.prisma.client.orm.public.CustomFormAdmin.where({
      customFormId: id,
    })
      .select('userId')
      .all()
    return this.userOptions(
      user.tenantId,
      rows.map((row) => row.userId),
    )
  }

  async setAdmins(user: AuthUser, id: string, userIds: string[]) {
    await this.requireAdmin(user, id)
    const normalized = [...new Set(userIds)]
    if (!normalized.length) throw new BadRequestException('自定义表单至少需要一个管理员')
    await this.ensureTenantUsers(user.tenantId, normalized)
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.CustomFormAdmin.where({ customFormId: id }).deleteAll()
      await tx.orm.public.CustomFormAdmin.createAll(
        normalized.map((userId) => ({
          id: createLegacyId32(),
          customFormId: id,
          userId: userId,
        })),
      )
    })
    return this.admins(user, id)
  }

  async roles(user: AuthUser, id: string) {
    await this.resolveAccess(user, id, { requireEnabled: false })
    const roles = await this.prisma.client.orm.public.CustomFormRole.where({
      customFormId: id,
    })
      .orderBy((role) => role.internalKey.asc())
      .all()
    const roleUsers = roles.length
      ? await this.prisma.client.orm.public.CustomFormRoleUser.where((row) =>
          row.roleId.in(roles.map((role) => role.id)),
        )
          .select('roleId', 'userId')
          .all()
      : []
    const ids = [...new Set(roleUsers.map((item) => item.userId))]
    const users = await this.userOptions(user.tenantId, ids)
    const userMap = new Map(users.map((item) => [item.id, item]))
    const usersByRole = new Map<string, string[]>()
    for (const item of roleUsers) {
      const idsForRole = usersByRole.get(item.roleId) ?? []
      idsForRole.push(item.userId)
      usersByRole.set(item.roleId, idsForRole)
    }
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      internalKey: role.internalKey,
      users: (usersByRole.get(role.id) ?? []).flatMap((userId) => {
        const option = userMap.get(userId)
        return option ? [option] : []
      }),
    }))
  }

  async setRoleUsers(user: AuthUser, id: string, roleKey: CustomFormRoleKey, userIds: string[]) {
    await this.requireAdmin(user, id)
    const normalized = [...new Set(userIds)]
    await this.ensureTenantUsers(user.tenantId, normalized)
    const role = await this.prisma.client.orm.public.CustomFormRole.where({
      customFormId: id,
      internalKey: roleKey,
    }).first()
    if (!role) throw new NotFoundException('自定义表单角色不存在')
    const now = BigInt(Date.now())
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.CustomFormRoleUser.where({ roleId: role.id }).deleteAll()
      if (normalized.length) {
        await tx.orm.public.CustomFormRoleUser.createAll(
          normalized.map((userId) => ({
            id: createLegacyId32(),
            roleId: role.id,
            userId: userId,
            createTime: now,
            updateTime: now,
            createUser: user.id,
            updateUser: user.id,
          })),
        )
      }
    })
    return this.roles(user, id)
  }

  async formConfig(user: AuthUser, id: string) {
    await this.resolveAccess(user, id, { requireEnabled: false })
    return this.moduleForms.getConfig(user.tenantId, id)
  }

  async createField(user: AuthUser, id: string, input: CreateFieldDto) {
    await this.requireAdmin(user, id)
    await this.validateDataSourceConfig(user, id, input)
    return this.moduleForms.createField(user.tenantId, id, input, user.id)
  }

  async updateField(user: AuthUser, id: string, fieldId: string, input: UpdateFieldDto) {
    await this.requireAdmin(user, id)
    const field = await this.requireField(id, user.tenantId, fieldId)
    await this.validateDataSourceConfig(user, id, {
      type: input.type ?? field.type,
      config: input.config === undefined ? (field.config ?? undefined) : input.config,
      subFields:
        input.subFields === undefined
          ? (field.subFields?.map((subField) => ({
              id: subField.id,
              key: subField.key,
              label: subField.label,
              type: subField.type,
              required: subField.required,
              options: subField.options ?? undefined,
              config: subField.config ?? undefined,
            })) as CreateFieldDto['subFields'])
          : input.subFields,
    })
    if (field.system && (input.required === false || input.hidden === true)) {
      throw new BadRequestException('名称和负责人系统字段必须保持必填且可见')
    }
    return this.moduleForms.updateField(user.tenantId, fieldId, input, user.id)
  }

  async deleteField(user: AuthUser, id: string, fieldId: string) {
    await this.requireAdmin(user, id)
    const field = await this.requireField(id, user.tenantId, fieldId)
    const attachmentRows =
      field.type === 'attachment'
        ? await this.prisma.client.orm.public.CustomFormDataFieldBlob.where({
            fieldId: fieldId,
          })
            .select('resourceId', 'fieldValue')
            .all()
        : []
    const result = await this.moduleForms.deleteField(user.tenantId, fieldId)
    for (const row of attachmentRows) {
      for (const attachmentId of this.decodeAttachmentIds(row.fieldValue)) {
        await this.attachments.removeFromTarget(
          user.tenantId,
          attachmentId,
          CUSTOM_FORM_ATTACHMENT_TARGET,
          row.resourceId,
        )
      }
    }
    return result
  }

  async reorderFields(user: AuthUser, id: string, input: ReorderFieldsDto) {
    await this.requireAdmin(user, id)
    return this.moduleForms.reorder(user.tenantId, id, input.orderedIds, user.id)
  }

  async dataPage(user: AuthUser, id: string, input: CustomFormDataPageDto) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const current = input.current ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim()
    const fields = await this.metadata.listFields(user.tenantId, id)
    const saved = input.viewId
      ? await this.userViews.resolveFilters(user, input.viewId, customFormUserViewResourceType(id))
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterDataIds(user.tenantId, id, fields, saved.conditions, saved.searchMode)
        : null,
      input.filters?.length
        ? this.filterDataIds(user.tenantId, id, fields, input.filters, input.filterMode ?? 'AND')
        : null,
    ])
    const filteredIds = this.intersectFilterIds(savedIds, adHocIds)
    if (filteredIds?.length === 0) {
      return { list: [], total: 0, current, pageSize, fields, access }
    }
    let query = this.prisma.client.orm.public.CustomFormData.where({
      organizationId: user.tenantId,
      customFormId: id,
    })
    if (!access.canViewAll) query = query.where({ owner: user.id })
    if (keyword) query = query.where((row) => row.name.ilike(`%${keyword}%`))
    if (filteredIds) query = query.where((row) => row.id.in(filteredIds))
    const [aggregate, baseRows] = await Promise.all([
      query.aggregate((agg) => ({ count: agg.count() })),
      query
        .orderBy([(row) => row.createTime.desc(), (row) => row.id.asc()])
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .all(),
    ])
    const rows = await this.hydrateDataRows(baseRows)
    return {
      list: rows.map((row) => this.dataToVO(row, fields)),
      total: aggregate.count,
      current,
      pageSize,
      fields,
      access,
    }
  }

  async dataSourcePage(user: AuthUser, id: string, input: CustomFormDataPageDto) {
    try {
      const page = await this.dataPage(user, id, {
        current: input.current,
        pageSize: input.pageSize,
        keyword: input.keyword,
        filters: input.filters,
        filterMode: input.filterMode,
      })
      return {
        list: page.list.map((row) => ({ id: row.id, name: row.name })),
        total: page.total,
        current: page.current,
        pageSize: page.pageSize,
      }
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        return {
          list: [],
          total: 0,
          current: input.current ?? 1,
          pageSize: input.pageSize ?? 20,
        }
      }
      throw error
    }
  }

  async dataSourceResolve(user: AuthUser, id: string, ids: string[]) {
    if (!ids.length) return []
    try {
      const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
      let query = this.prisma.client.orm.public.CustomFormData.where({
        organizationId: user.tenantId,
        customFormId: id,
      }).where((row) => row.id.in([...new Set(ids)]))
      if (!access.canViewAll) query = query.where({ owner: user.id })
      return query.select('id', 'name').all()
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return []
      throw error
    }
  }

  async dataDetail(user: AuthUser, id: string, dataId: string) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const row = await this.findData(user.tenantId, id, dataId)
    this.assertReadableData(access, user.id, row.ownerId)
    const fields = await this.metadata.listFields(user.tenantId, id)
    const data = this.dataToVO(row, fields)
    const attachmentMap = await this.buildAttachmentMap(user.tenantId, dataId, fields, data.values)
    return { ...data, fields, access, attachmentMap }
  }

  async createData(user: AuthUser, id: string, input: SaveCustomFormDataDto) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    if (!access.canCreate) throw new ForbiddenException('当前成员没有创建表单数据的权限')
    if (!access.canManageAll && input.ownerId !== user.id) {
      throw new ForbiddenException('当前成员只能创建本人负责的数据')
    }
    await this.ensureTenantUsers(user.tenantId, [input.ownerId])
    const { fields, values } = await this.validateValues(user.tenantId, id, input.values, true)
    const attachmentPlan = await this.validateAttachmentValues(user, null, fields, values)
    const now = BigInt(Date.now())
    const row = await this.prisma.client.transaction(async (tx) => {
      const created = await tx.orm.public.CustomFormData.create({
        id: createLegacyId32(),
        customFormId: id,
        name: input.name.trim(),
        owner: input.ownerId,
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await this.replaceFieldValues(tx, created.id, fields, values)
      await this.claimTemporaryAttachments(tx, user, created.id, attachmentPlan.tempIds)
      return created
    })
    return this.dataDetail(user, id, row.id)
  }

  async updateData(user: AuthUser, id: string, dataId: string, input: SaveCustomFormDataDto) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const current = await this.findData(user.tenantId, id, dataId)
    this.assertWritableData(access, user.id, current.ownerId)
    if (!access.canManageAll && input.ownerId !== user.id) {
      throw new ForbiddenException('当前成员不能把数据转交给其他负责人')
    }
    await this.ensureTenantUsers(user.tenantId, [input.ownerId])
    const { fields, values } = await this.validateValues(user.tenantId, id, input.values, true)
    const oldAttachmentIds = this.attachmentIdsFromRow(current, fields)
    const attachmentPlan = await this.validateAttachmentValues(user, dataId, fields, values)
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.CustomFormData.where({ id: dataId }).update({
        name: input.name.trim(),
        owner: input.ownerId,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      await this.replaceFieldValues(tx, dataId, fields, values)
      await this.claimTemporaryAttachments(tx, user, dataId, attachmentPlan.tempIds)
    })
    const retained = new Set(attachmentPlan.allIds)
    for (const attachmentId of oldAttachmentIds) {
      if (retained.has(attachmentId)) continue
      await this.attachments.removeFromTarget(
        user.tenantId,
        attachmentId,
        CUSTOM_FORM_ATTACHMENT_TARGET,
        dataId,
      )
    }
    return this.dataDetail(user, id, dataId)
  }

  async deleteData(user: AuthUser, id: string, dataId: string) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const current = await this.findData(user.tenantId, id, dataId)
    this.assertWritableData(access, user.id, current.ownerId)
    await this.prisma.client.orm.public.CustomFormData.where({
      id: dataId,
    }).delete()
    await this.attachments.removeAllFromTargets(user.tenantId, CUSTOM_FORM_ATTACHMENT_TARGET, [
      dataId,
    ])
    return { id: dataId }
  }

  async batchUpdateData(user: AuthUser, id: string, input: ResourceBatchEditDto) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const ids = [...new Set(input.ids)]
    const rows = await this.prisma.client.orm.public.CustomFormData.where({
      organizationId: user.tenantId,
      customFormId: id,
    })
      .where((row) => row.id.in(ids))
      .select('id', 'owner')
      .all()
    if (rows.length !== ids.length) throw new BadRequestException('批量数据包含不存在的记录')
    for (const row of rows) this.assertWritableData(access, user.id, row.owner)

    const field = await this.metadata.resolveEditableField(user.tenantId, id, input.fieldId)
    if (['attachment', 'picture', 'sub_product'].includes(field.type)) {
      throw new BadRequestException(`「${field.label}」不支持批量修改`)
    }
    this.metadata.validateBatchFieldValue(field, input.fieldValue)
    const now = BigInt(Date.now())

    if (field.key === 'name') {
      const name = typeof input.fieldValue === 'string' ? input.fieldValue.trim() : ''
      if (!name) throw new BadRequestException('名称不能为空')
      await this.prisma.client.orm.public.CustomFormData.where({
        organizationId: user.tenantId,
        customFormId: id,
      })
        .where((row) => row.id.in(ids))
        .updateAndCount({
          name: name,
          updateTime: now,
          updateUser: user.id,
        })
      return { count: ids.length }
    }

    if (field.key === 'ownerId') {
      const ownerId = typeof input.fieldValue === 'string' ? input.fieldValue.trim() : ''
      if (!ownerId) throw new BadRequestException('负责人不能为空')
      if (!access.canManageAll && ownerId !== user.id) {
        throw new ForbiddenException('当前成员不能把数据转交给其他负责人')
      }
      await this.ensureTenantUsers(user.tenantId, [ownerId])
      await this.prisma.client.orm.public.CustomFormData.where({
        organizationId: user.tenantId,
        customFormId: id,
      })
        .where((row) => row.id.in(ids))
        .updateAndCount({
          owner: ownerId,
          updateTime: now,
          updateUser: user.id,
        })
      return { count: ids.length }
    }

    await this.validateBatchReferenceValue(user.tenantId, field, input.fieldValue)
    const empty = this.isEmptyValue(input.fieldValue)
    const encoded = empty ? null : this.encodeValue(input.fieldValue)
    await this.prisma.client.transaction(async (tx) => {
      await Promise.all([
        tx.orm.public.CustomFormDataField.where({ fieldId: field.id })
          .where((row) => row.resourceId.in(ids))
          .deleteAll(),
        tx.orm.public.CustomFormDataFieldBlob.where({ fieldId: field.id })
          .where((row) => row.resourceId.in(ids))
          .deleteAll(),
      ])
      if (encoded !== null) {
        if (BLOB_FIELD_TYPES.has(field.type)) {
          await tx.orm.public.CustomFormDataFieldBlob.createAll(
            ids.map((resourceId) => ({
              id: createLegacyId32(),
              resourceId: resourceId,
              fieldId: field.id,
              fieldValue: encoded,
              refSubId: null,
              rowId: null,
              bizId: null,
            })),
          )
        } else {
          await tx.orm.public.CustomFormDataField.createAll(
            ids.map((resourceId) => ({
              id: createLegacyId32(),
              resourceId: resourceId,
              fieldId: field.id,
              fieldValue: encoded,
              refSubId: null,
              rowId: null,
              bizId: null,
            })),
          )
        }
      }
      await tx.orm.public.CustomFormData.where({
        organizationId: user.tenantId,
        customFormId: id,
      })
        .where((row) => row.id.in(ids))
        .updateAndCount({ updateTime: now, updateUser: user.id })
    })
    return { count: ids.length }
  }

  async batchDeleteData(user: AuthUser, id: string, input: BatchIdsDto) {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    const ids = [...new Set(input.ids)]
    const rows = await this.prisma.client.orm.public.CustomFormData.where({
      organizationId: user.tenantId,
      customFormId: id,
    })
      .where((row) => row.id.in(ids))
      .select('id', 'owner')
      .all()
    if (rows.length !== ids.length) throw new BadRequestException('批量数据包含不存在的记录')
    for (const row of rows) this.assertWritableData(access, user.id, row.owner)
    const count = await this.prisma.client.orm.public.CustomFormData.where({
      organizationId: user.tenantId,
      customFormId: id,
    })
      .where((row) => row.id.in(ids))
      .deleteAndCount()
    await this.attachments.removeAllFromTargets(user.tenantId, CUSTOM_FORM_ATTACHMENT_TARGET, ids)
    return { count }
  }

  async viewList(user: AuthUser, id: string) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.userViews.list(user, customFormUserViewResourceType(id))
  }

  async viewDetail(user: AuthUser, id: string, viewId: string) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.userViews.detail(user, viewId, customFormUserViewResourceType(id))
  }

  async createView(user: AuthUser, id: string, input: CreateUserViewDto) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    await this.assertViewConditions(user.tenantId, id, input.conditions ?? [])
    return this.userViews.create(user, customFormUserViewResourceType(id), input)
  }

  async updateView(user: AuthUser, id: string, input: UpdateUserViewDto) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    await this.assertViewConditions(user.tenantId, id, input.conditions ?? [])
    return this.userViews.update(user, customFormUserViewResourceType(id), input)
  }

  async removeView(user: AuthUser, id: string, viewId: string) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.userViews.remove(user, viewId, customFormUserViewResourceType(id))
  }

  async toggleViewFixed(user: AuthUser, id: string, viewId: string) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.userViews.toggleFixed(user, viewId, customFormUserViewResourceType(id))
  }

  async toggleViewEnabled(user: AuthUser, id: string, viewId: string) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.userViews.toggleEnabled(user, viewId, customFormUserViewResourceType(id))
  }

  async editViewPos(user: AuthUser, id: string, input: EditUserViewPosDto) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.userViews.editPos(user, customFormUserViewResourceType(id), input)
  }

  async importTemplate(user: AuthUser, id: string, importType: ImportType) {
    const { form, access } = await this.resolveAccess(user, id, { requireEnabled: true })
    this.assertImportAccess(access, importType)
    const fields = await this.metadata.listFields(user.tenantId, id)
    const { mainFields, groups } = this.subTableSpreadsheetConfig(fields)
    return {
      filename: `${form.name}${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data: groups.length
        ? await this.spreadsheet.buildMultiSubTableImportTemplate(mainFields, groups, importType)
        : await this.spreadsheet.buildImportTemplate(fields, importType),
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    id: string,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    this.assertImportAccess(access, importType)
    const fields = await this.metadata.listFields(user.tenantId, id)
    const rows = await this.parseCustomFormImportGroups(file, fields, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          await this.prepareImportGroup(user, id, row, fields, access, importType)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '数据校验失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
      else successCount++
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async importXlsx(
    user: AuthUser,
    id: string,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const { access } = await this.resolveAccess(user, id, { requireEnabled: true })
    this.assertImportAccess(access, importType)
    const fields = await this.metadata.listFields(user.tenantId, id)
    const rows = await this.parseCustomFormImportGroups(file, fields, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          const prepared = await this.prepareImportGroup(user, id, row, fields, access, importType)
          if (importType === 'ADD') await this.createData(user, id, prepared)
          else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.updateData(user, id, row.resourceId, prepared)
          }
          successCount++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '导入失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async exportAll(user: AuthUser, id: string, input: { fileName: string; headList: string[] }) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.enqueueExport(user, id, input)
  }

  async exportSelected(
    user: AuthUser,
    id: string,
    input: { fileName: string; headList: string[]; ids: string[] },
  ) {
    await this.resolveAccess(user, id, { requireEnabled: true })
    return this.enqueueExport(user, id, input)
  }

  async buildQueuedExport(
    user: AuthUser,
    payload: QueuedExportTaskPayload,
  ): Promise<ExportBuildResult> {
    if (!user.permissions.includes('*') && !user.permissions.includes('CUSTOM_FORM:READ')) {
      throw new ForbiddenException('当前用户已没有自定义表单读取权限')
    }
    const query = payload.query as { formId?: string }
    const formId = typeof query?.formId === 'string' ? query.formId : ''
    if (!formId) throw new BadRequestException('自定义表单导出任务缺少 formId')
    return this.buildExportXlsx(
      user,
      formId,
      payload.input as { headList: string[]; ids?: string[] },
    )
  }

  private enqueueExport(
    user: AuthUser,
    formId: string,
    input: { fileName: string; headList: string[]; ids?: string[] },
  ) {
    return this.exportTasks.enqueue(user, {
      module: 'customFormData',
      fileName: input.fileName,
      payload: {
        version: 1,
        query: { formId },
        input: { headList: input.headList, ids: input.ids },
      },
    })
  }

  private async collectExportItems(user: AuthUser, formId: string, ids?: string[]) {
    const all: DataExportRow[] = []
    let current = 1
    const pageSize = 500
    while (true) {
      const result = await this.dataPage(user, formId, { current, pageSize })
      all.push(...result.list)
      if (all.length >= result.total || !result.list.length) break
      current++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length != wanted.size) {
      throw new BadRequestException('选中数据包含不存在或无权导出的自定义表单数据')
    }
    return selected
  }

  private intersectFilterIds(first: string[] | null, second: string[] | null): string[] | null {
    if (first === null) return second
    if (second === null) return first
    const right = new Set(second)
    return first.filter((id) => right.has(id))
  }

  private async filterDataIds(
    tenantId: string,
    formId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    searchMode: 'AND' | 'OR',
  ): Promise<string[]> {
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const predicates = conditions.map((condition) => {
      const field = fieldMap.get(condition.key)
      if (!field) throw new BadRequestException(`筛选字段不存在：${condition.key}`)
      if (['formula', 'picture', 'attachment', 'sub_product'].includes(field.type)) {
        throw new BadRequestException(`「${field.label}」暂不支持高级筛选`)
      }
      if (!filterOpsForType(field.type).includes(condition.op)) {
        throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      }
      return field.system
        ? this.compileSystemFilterPredicate(field, condition)
        : this.compileDynamicFilterPredicate(field, condition)
    })
    if (!predicates.length) return []
    const client = this.prisma.client
    let combined = predicates[0]
    if (!combined) return []
    for (const predicate of predicates.slice(1)) {
      combined =
        searchMode === 'OR'
          ? client.raw.sql`(${combined}) OR (${predicate})`.returns('pg/bool@1')
          : client.raw.sql`(${combined}) AND (${predicate})`.returns('pg/bool@1')
    }
    const query = client.raw.sql`SELECT resource.id
      FROM custom_form_data AS resource
      WHERE resource.organization_id = ${tenantId}
        AND resource.custom_form_id = ${formId}
        AND (${combined})`.returnsRow({ id: client.sql.public.custom_form_data.columns.id })
    const rows: Array<{ id: string }> = []
    for await (const row of client.runtime().query(query.build())) rows.push(row)
    return rows.map((row) => row.id)
  }

  private compileSystemFilterPredicate(
    field: FieldVO,
    condition: FilterCondition,
  ): PrismaRawExpression {
    if (!['name', 'ownerId'].includes(field.key))
      throw new BadRequestException(`筛选字段不支持：${field.key}`)
    const client = this.prisma.client
    if (condition.op === 'isEmpty') {
      return field.key === 'name'
        ? client.raw.sql`resource.name = ''`.returns('pg/bool@1')
        : client.raw.sql`resource.owner = ''`.returns('pg/bool@1')
    }
    if (condition.op === 'notEmpty') {
      return field.key === 'name'
        ? client.raw.sql`resource.name <> ''`.returns('pg/bool@1')
        : client.raw.sql`resource.owner <> ''`.returns('pg/bool@1')
    }
    if (condition.op === 'in' || condition.op === 'notIn') {
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values = rawValues.map((value) => this.requiredFilterText(field, value))
      const valuesJson = JSON.stringify(values)
      const matched =
        field.key === 'name'
          ? client.raw.sql`resource.name IN (
              SELECT jsonb_array_elements_text(${valuesJson}::jsonb)
            )`.returns('pg/bool@1')
          : client.raw.sql`resource.owner IN (
              SELECT jsonb_array_elements_text(${valuesJson}::jsonb)
            )`.returns('pg/bool@1')
      return condition.op === 'notIn'
        ? client.raw.sql`NOT (${matched})`.returns('pg/bool@1')
        : matched
    }
    const value = this.requiredFilterText(field, condition.value)
    if ((condition.op === 'contains' || condition.op === 'notContains') && field.key === 'name') {
      const matched = client.raw.sql`resource.name ILIKE ${`%${value}%`}`.returns('pg/bool@1')
      return condition.op === 'notContains'
        ? client.raw.sql`NOT (${matched})`.returns('pg/bool@1')
        : matched
    }
    if (condition.op === 'eq') {
      return field.key === 'name'
        ? client.raw.sql`resource.name = ${value}`.returns('pg/bool@1')
        : client.raw.sql`resource.owner = ${value}`.returns('pg/bool@1')
    }
    if (condition.op === 'ne') {
      return field.key === 'name'
        ? client.raw.sql`resource.name <> ${value}`.returns('pg/bool@1')
        : client.raw.sql`resource.owner <> ${value}`.returns('pg/bool@1')
    }
    throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
  }

  private compileDynamicFilterPredicate(
    field: FieldVO,
    condition: FilterCondition,
  ): PrismaRawExpression {
    const client = this.prisma.client
    const existsNormal = (predicate?: PrismaRawExpression) =>
      this.customFormFieldExists(field.id, false, predicate)
    const existsBlob = (predicate?: PrismaRawExpression) =>
      this.customFormFieldExists(field.id, true, predicate)
    const negate = (expression: PrismaRawExpression) =>
      client.raw.sql`NOT (${expression})`.returns('pg/bool@1')

    if (condition.op === 'isEmpty') {
      return client.raw.sql`NOT (${existsNormal()}) AND NOT (${existsBlob()})`.returns('pg/bool@1')
    }
    if (condition.op === 'notEmpty') {
      return client.raw.sql`(${existsNormal()}) OR (${existsBlob()})`.returns('pg/bool@1')
    }

    if (
      (condition.op === 'contains' || condition.op === 'notContains') &&
      ['multiselect', 'checkbox', 'data_source_multiple'].includes(field.type)
    ) {
      const value = this.requiredFilterText(field, condition.value)
      const match = client.raw.sql`field_value.field_value::jsonb @> ${JSON.stringify([
        value,
      ])}::jsonb`.returns('pg/bool@1')
      const matched = existsBlob(match)
      return condition.op === 'notContains' ? negate(matched) : matched
    }

    if (condition.op === 'in' || condition.op === 'notIn') {
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      if (!rawValues.length) throw new BadRequestException(`「${field.label}」筛选值不能为空`)
      if (['multiselect', 'checkbox', 'data_source_multiple'].includes(field.type)) {
        const values = rawValues.map((value) => this.requiredFilterText(field, value))
        const valuesJson = JSON.stringify(values)
        const match = client.raw.sql`jsonb_exists_any(
          field_value.field_value::jsonb,
          ARRAY(SELECT jsonb_array_elements_text(${valuesJson}::jsonb))
        )`.returns('pg/bool@1')
        const matched = existsBlob(match)
        return condition.op === 'notIn' ? negate(matched) : matched
      }
      if (['number', 'currency', 'percent'].includes(field.type)) {
        const values = rawValues.map(Number)
        if (values.some((value) => !Number.isFinite(value))) {
          throw new BadRequestException(`「${field.label}」筛选值必须是数字`)
        }
        const valuesJson = JSON.stringify(values)
        const match = client.raw.sql`field_value.field_value::numeric IN (
          SELECT jsonb_array_elements_text(${valuesJson}::jsonb)::numeric
        )`.returns('pg/bool@1')
        const matched = existsNormal(match)
        return condition.op === 'notIn' ? negate(matched) : matched
      }
      const values = rawValues.map((value) => this.serializeFilterScalar(field, value))
      const valuesJson = JSON.stringify(values)
      const match = client.raw.sql`field_value.field_value IN (
        SELECT jsonb_array_elements_text(${valuesJson}::jsonb)
      )`.returns('pg/bool@1')
      const matched = BLOB_FIELD_TYPES.has(field.type) ? existsBlob(match) : existsNormal(match)
      return condition.op === 'notIn' ? negate(matched) : matched
    }

    if (['number', 'currency', 'percent'].includes(field.type)) {
      const number = Number(condition.value)
      if (!Number.isFinite(number))
        throw new BadRequestException(`「${field.label}」筛选值必须是数字`)
      const matched =
        condition.op === 'eq' || condition.op === 'ne'
          ? existsNormal(
              client.raw.sql`field_value.field_value::numeric = ${number}`.returns('pg/bool@1'),
            )
          : condition.op === 'gt'
            ? existsNormal(
                client.raw.sql`field_value.field_value::numeric > ${number}`.returns('pg/bool@1'),
              )
            : condition.op === 'gte'
              ? existsNormal(
                  client.raw.sql`field_value.field_value::numeric >= ${number}`.returns(
                    'pg/bool@1',
                  ),
                )
              : condition.op === 'lt'
                ? existsNormal(
                    client.raw.sql`field_value.field_value::numeric < ${number}`.returns(
                      'pg/bool@1',
                    ),
                  )
                : condition.op === 'lte'
                  ? existsNormal(
                      client.raw.sql`field_value.field_value::numeric <= ${number}`.returns(
                        'pg/bool@1',
                      ),
                    )
                  : null
      if (!matched) throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      return condition.op === 'ne' ? negate(matched) : matched
    }

    if (['date', 'datetime'].includes(field.type)) {
      const date = new Date(String(condition.value ?? ''))
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException(`「${field.label}」日期筛选值不合法`)
      const iso = date.toISOString()
      if (condition.op === 'gte') {
        return existsNormal(
          client.raw.sql`field_value.field_value::timestamptz >= ${iso}::timestamptz`.returns(
            'pg/bool@1',
          ),
        )
      }
      if (condition.op === 'lte') {
        return existsNormal(
          client.raw.sql`field_value.field_value::timestamptz <= ${iso}::timestamptz`.returns(
            'pg/bool@1',
          ),
        )
      }
      throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
    }

    if (field.type === 'location') {
      const text = this.requiredFilterText(field, condition.value)
      const parsed = splitLocationValue(text)
      const code = parsed?.code ?? text
      const equal =
        code === 'CHN'
          ? existsNormal(
              client.raw.sql`(
                field_value.field_value ~ '^[0-9]{2,6}(-.*)?$'
                OR field_value.field_value LIKE 'CHN-%'
              )`.returns('pg/bool@1'),
            )
          : existsNormal(
              client.raw.sql`field_value.field_value LIKE ${`${code}%`}`.returns('pg/bool@1'),
            )
      if (condition.op === 'eq') return equal
      if (condition.op === 'ne') return negate(equal)
      throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
    }

    const value = this.serializeFilterScalar(field, condition.value)
    const match =
      condition.op === 'contains' || condition.op === 'notContains'
        ? client.raw.sql`field_value.field_value ILIKE ${`%${value}%`}`.returns('pg/bool@1')
        : client.raw.sql`field_value.field_value = ${value}`.returns('pg/bool@1')
    const matched = BLOB_FIELD_TYPES.has(field.type) ? existsBlob(match) : existsNormal(match)
    if (condition.op === 'ne' || condition.op === 'notContains') return negate(matched)
    if (condition.op === 'eq' || condition.op === 'contains') return matched
    throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
  }

  private customFormFieldExists(
    fieldId: string,
    blob: boolean,
    predicate?: PrismaRawExpression,
  ): PrismaRawExpression {
    const client = this.prisma.client
    if (blob) {
      return predicate
        ? client.raw.sql`EXISTS (
            SELECT 1 FROM custom_form_data_field_blob AS field_value
            WHERE field_value.resource_id = resource.id
              AND field_value.field_id = ${fieldId}
              AND ${predicate}
          )`.returns('pg/bool@1')
        : client.raw.sql`EXISTS (
            SELECT 1 FROM custom_form_data_field_blob AS field_value
            WHERE field_value.resource_id = resource.id
              AND field_value.field_id = ${fieldId}
          )`.returns('pg/bool@1')
    }
    return predicate
      ? client.raw.sql`EXISTS (
          SELECT 1 FROM custom_form_data_field AS field_value
          WHERE field_value.resource_id = resource.id
            AND field_value.field_id = ${fieldId}
            AND ${predicate}
        )`.returns('pg/bool@1')
      : client.raw.sql`EXISTS (
          SELECT 1 FROM custom_form_data_field AS field_value
          WHERE field_value.resource_id = resource.id
            AND field_value.field_id = ${fieldId}
        )`.returns('pg/bool@1')
  }

  private requiredFilterText(field: FieldVO, value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException(`「${field.label}」筛选值不能为空`)
    return value.trim()
  }

  private serializeFilterScalar(field: FieldVO, value: unknown): string {
    if (value === undefined || value === null || value === '')
      throw new BadRequestException(`「${field.label}」筛选值不能为空`)
    if (field.type === 'switch') {
      if (typeof value !== 'boolean')
        throw new BadRequestException(`「${field.label}」筛选值格式不正确`)
      return String(value)
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new BadRequestException(`「${field.label}」筛选值格式不正确`)
    }
    return String(value)
  }

  private async assertViewConditions(
    tenantId: string,
    formId: string,
    conditions: UserViewConditionDto[],
  ) {
    const fields = await this.metadata.listFields(tenantId, formId)
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    for (const condition of conditions) {
      const field = fieldMap.get(condition.name)
      if (!field) throw new BadRequestException(`筛选字段不存在：${condition.name}`)
      if (['formula', 'picture'].includes(field.type)) {
        throw new BadRequestException(`「${field.label}」暂不支持保存为筛选条件`)
      }
      if (!filterOpsForType(field.type).includes(condition.operator)) {
        throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      }
    }
  }

  private async validateBatchReferenceValue(tenantId: string, field: FieldVO, value: unknown) {
    if (this.isEmptyValue(value)) return
    if (field.type === 'member') {
      await this.ensureTenantUsers(tenantId, [String(value)])
      return
    }
    if (field.type === 'dept') {
      const department = await this.prisma.client.orm.public.Departments.where({
        tenantId,
        id: String(value),
      })
        .select('id')
        .first()
      if (!department) throw new BadRequestException('部门不存在')
      return
    }
    if (field.type === 'data_source' || field.type === 'data_source_multiple') {
      await this.validateDataSourceFieldValue(tenantId, field, value)
    }
  }

  private isEmptyValue(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    formId: string,
    input: { headList: string[]; ids?: string[] },
  ): Promise<ExportBuildResult> {
    const [items, fields] = await Promise.all([
      this.collectExportItems(user, formId, input.ids),
      this.metadata.listFields(user.tenantId, formId),
    ])
    const references = await this.loadExportReferenceMaps(user.tenantId, fields, items)
    const fieldMap = new Map(
      fields
        .filter((field) => !field.hidden && !['picture', 'attachment'].includes(field.type))
        .map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
      ['createUser', '创建人'],
      ['updateUser', '更新人'],
    ])
    const selectedSubTables: FieldVO[] = []
    const columns: Array<{ key: string; label: string }> = []
    for (const key of input.headList) {
      const field = fieldMap.get(key)
      const label = extraColumns.get(key)
      if (!field && !label) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      if (field?.type === 'sub_product') {
        selectedSubTables.push(field)
        continue
      }
      columns.push({ key, label: field?.label ?? (label as string) })
    }
    const valueForColumn = (item: DataExportRow, key: string) => {
      const field = fieldMap.get(key)
      if (field) return this.exportFieldValue(field, item, references)
      if (key === 'createTime') return new Date(item.createTime).toISOString()
      if (key === 'updateTime') return new Date(item.updateTime).toISOString()
      if (key === 'createUser') return references.users.get(item.createUser) ?? item.createUser
      if (key === 'updateUser') return references.users.get(item.updateUser) ?? item.updateUser
      return ''
    }
    const rows = items.map((item) =>
      Object.fromEntries(columns.map((column) => [column.key, valueForColumn(item, column.key)])),
    )
    if (selectedSubTables.length) {
      const subGroups = selectedSubTables.map((parent) => ({
        key: parent.key,
        label: parent.label,
        columns: (parent.subFields ?? [])
          .filter((field) => field.type !== 'picture')
          .map((field) => ({ key: field.key, label: field.label })),
      }))
      const groups = items.map((item, itemIndex) => ({
        values: rows[itemIndex] ?? {},
        subRows: Object.fromEntries(
          selectedSubTables.map((parent) => {
            const rawValue = item.values[parent.key]
            const rawRows: unknown[] = Array.isArray(rawValue) ? rawValue : []
            const childMap = new Map((parent.subFields ?? []).map((field) => [field.key, field]))
            const exportRows = rawRows.flatMap((rawRow) => {
              if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return []
              const row = rawRow as Record<string, unknown>
              return [
                Object.fromEntries(
                  [...childMap.entries()]
                    .filter(([, field]) => field.type !== 'picture')
                    .map(([key, field]) => [
                      key,
                      this.formatFieldExportValue(field, row[key], references),
                    ]),
                ),
              ]
            })
            return [parent.key, exportRows]
          }),
        ),
      }))
      return {
        data: await this.spreadsheet.buildMultiSubTableExportWorkbook(columns, subGroups, groups),
        rowCount: items.length,
      }
    }
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
  }

  private exportFieldValue(
    field: FieldVO,
    item: DataExportRow,
    references: ExportReferenceMaps,
  ): unknown {
    const value = field.system
      ? field.key === 'name'
        ? item.name
        : field.key === 'ownerId'
          ? item.ownerId
          : undefined
      : item.values[field.key]
    return this.formatFieldExportValue(field, value, references)
  }

  private formatFieldExportValue(
    field: FieldVO,
    value: unknown,
    references: ExportReferenceMaps,
  ): unknown {
    if (value === undefined || value === null || value === '') return ''
    if (field.type === 'member') return references.users.get(String(value)) ?? String(value)
    if (field.type === 'dept') return references.departments.get(String(value)) ?? String(value)
    if (field.type === 'select' || field.type === 'radio')
      return field.options?.find((option) => option.value === value)?.label ?? String(value)
    if (field.type === 'multiselect' || field.type === 'checkbox') {
      const values = Array.isArray(value) ? value : [value]
      return values
        .map(
          (current) =>
            field.options?.find((option) => option.value === current)?.label ?? String(current),
        )
        .join('、')
    }
    if (field.type === 'data_source' || field.type === 'data_source_multiple') {
      const sourceType = field.config?.dataSourceType
      const values = Array.isArray(value) ? value : [value]
      if (!sourceType) return values.map(String).join('、')
      return values
        .map(
          (current) =>
            references.dataSources.get(dataSourceReferenceKey(sourceType, String(current))) ??
            String(current),
        )
        .join('、')
    }
    if (field.type === 'switch') return value ? '是' : '否'
    if (field.type === 'location') {
      return formatLocationValue(
        value,
        '-',
        '-',
        field.config?.scope ?? 'ALL',
        field.config?.locationType ?? 'PCD',
      )
    }
    return value
  }

  private async loadExportReferenceMaps(
    tenantId: string,
    fields: FieldVO[],
    items: DataExportRow[],
  ): Promise<ExportReferenceMaps> {
    const userIds = new Set<string>()
    const departmentIds = new Set<string>()
    const dataSourceIds = new Map<string, Set<string>>()

    const collectReference = (field: FieldVO, value: unknown) => {
      if (field.type === 'member' && typeof value === 'string' && value) userIds.add(value)
      if (field.type === 'dept' && typeof value === 'string' && value) departmentIds.add(value)
      if (!['data_source', 'data_source_multiple'].includes(field.type)) return
      const sourceType = field.config?.dataSourceType
      if (!sourceType) return
      const ids = dataSourceIds.get(sourceType) ?? new Set<string>()
      const values = Array.isArray(value) ? value : value ? [value] : []
      for (const current of values) {
        if (typeof current === 'string' && current) ids.add(current)
      }
      dataSourceIds.set(sourceType, ids)
    }

    for (const item of items) {
      userIds.add(item.ownerId)
      userIds.add(item.createUser)
      userIds.add(item.updateUser)
      for (const field of fields) {
        if (field.system) continue
        if (field.type !== 'sub_product') {
          collectReference(field, item.values[field.key])
          continue
        }
        const rawValue = item.values[field.key]
        const rows: unknown[] = Array.isArray(rawValue) ? rawValue : []
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue
          const rowValues = row as Record<string, unknown>
          for (const subField of field.subFields ?? []) {
            collectReference(subField, rowValues[subField.key])
          }
        }
      }
    }

    const [users, departments, dataSourceGroups] = await Promise.all([
      userIds.size
        ? this.prisma.client.orm.public.Users.where({ tenantId })
            .where((user) => user.id.in([...userIds]))
            .select('id', 'name')
            .all()
        : [],
      departmentIds.size
        ? this.prisma.client.orm.public.Departments.where({ tenantId })
            .where((department) => department.id.in([...departmentIds]))
            .select('id', 'name')
            .all()
        : [],
      Promise.all(
        [...dataSourceIds.entries()].map(async ([sourceType, ids]) => ({
          sourceType,
          rows: await this.loadDataSourceOptionsByIds(tenantId, sourceType, [...ids]),
        })),
      ),
    ])

    const dataSources = new Map<string, string>()
    for (const group of dataSourceGroups) {
      for (const row of group.rows) {
        dataSources.set(dataSourceReferenceKey(group.sourceType, row.id), row.name)
      }
    }

    return {
      users: new Map(users.map((item) => [item.id, item.name])),
      departments: new Map(departments.map((item) => [item.id, item.name])),
      dataSources,
    }
  }

  private assertImportAccess(access: AccessState, importType: ImportType) {
    if (importType === 'ADD' && !access.canCreate) {
      throw new ForbiddenException('当前成员没有导入新建表单数据的权限')
    }
    if (importType === 'UPDATE' && !access.canManageAll && !access.canManageOwn) {
      throw new ForbiddenException('当前成员没有导入更新表单数据的权限')
    }
  }

  private subTableSpreadsheetConfig(fields: FieldVO[]) {
    const parents = fields.filter((field) => field.type === 'sub_product' && !field.hidden)
    return {
      mainFields: fields.filter((field) => field.type !== 'sub_product'),
      groups: parents.map((field) => ({
        key: field.key,
        label: field.label,
        fields: field.subFields ?? [],
      })),
      parents,
    }
  }

  private async parseCustomFormImportGroups(
    file: Buffer,
    fields: FieldVO[],
    importType: ImportType,
  ): Promise<CustomFormSubTableImportGroup[]> {
    const { mainFields, groups } = this.subTableSpreadsheetConfig(fields)
    if (!groups.length) {
      const rows = await this.spreadsheet.parseImport(file, fields, importType)
      return rows.map((row) => ({
        key: `row:${row.rowNum}`,
        rowNum: row.rowNum,
        resourceId: row.resourceId,
        values: row.values,
        subRows: {},
        errors: row.errors,
      }))
    }
    const rows = await this.spreadsheet.parseMultiSubTableImport(
      file,
      mainFields,
      groups,
      importType,
    )
    return this.groupSubTableImportRows(rows, importType)
  }

  private groupSubTableImportRows(
    rows: ParsedMultiSubTableSpreadsheetRow[],
    importType: ImportType,
  ): CustomFormSubTableImportGroup[] {
    const groups: CustomFormSubTableImportGroup[] = []
    let current: CustomFormSubTableImportGroup | undefined
    for (const row of rows) {
      const rawKey = importType === 'UPDATE' ? row.resourceId : row.values['name']
      const explicitKey = rawKey === undefined || rawKey === null ? '' : String(rawKey).trim()
      if (explicitKey && (!current || current.key !== explicitKey)) {
        current = {
          key: explicitKey,
          rowNum: row.rowNum,
          ...(importType === 'UPDATE' ? { resourceId: explicitKey } : {}),
          values: {},
          subRows: {},
          errors: [],
        }
        groups.push(current)
      } else if (!current) {
        current = {
          key: `row:${row.rowNum}`,
          rowNum: row.rowNum,
          values: {},
          subRows: {},
          errors: [importType === 'UPDATE' ? '唯一ID不能为空' : '名称不能为空'],
        }
        groups.push(current)
      }
      if (importType === 'UPDATE' && row.resourceId && !current.resourceId) {
        current.resourceId = row.resourceId
      }
      for (const [key, value] of Object.entries(row.values)) {
        const existing = current.values[key]
        if (existing === undefined) {
          current.values[key] = value
          continue
        }
        if (JSON.stringify(existing) !== JSON.stringify(value)) {
          current.errors.push(`第 ${row.rowNum} 行主字段「${key}」与前序行不一致`)
        }
      }
      for (const [parentKey, subRow] of Object.entries(row.subValues)) {
        if (!Object.keys(subRow).length) continue
        current.subRows[parentKey] ??= []
        current.subRows[parentKey]!.push(subRow)
      }
      current.errors.push(...row.errors.map((error) => `第 ${row.rowNum} 行：${error}`))
    }
    return groups
  }

  private async prepareImportGroup(
    user: AuthUser,
    formId: string,
    group: CustomFormSubTableImportGroup,
    fields: FieldVO[],
    access: AccessState,
    importType: ImportType,
  ) {
    const input = { ...group.values }
    for (const parent of fields.filter((field) => field.type === 'sub_product')) {
      const rows = group.subRows[parent.key]
      if (!rows?.length) continue
      input[parent.key] = await this.resolveImportSubTableRows(user, parent, rows)
    }
    return this.prepareImportData(user, formId, input, fields, access, importType, group.resourceId)
  }

  private async resolveImportSubTableRows(
    user: AuthUser,
    parent: FieldVO,
    rows: Record<string, unknown>[],
  ) {
    const subFields = parent.subFields ?? []
    const byKey = new Map(subFields.map((field) => [field.key, field]))
    return Promise.all(
      rows.map(async (row) => {
        const output: Record<string, unknown> = {}
        for (const [key, rawValue] of Object.entries(row)) {
          const field = byKey.get(key)
          if (!field || field.type === 'formula') continue
          let value = rawValue
          if (field.type === 'member')
            value = await this.resolveImportUser(user, String(rawValue ?? ''))
          if (field.type === 'dept')
            value = await this.resolveImportDepartment(user, String(rawValue ?? ''))
          if (field.type === 'data_source') {
            value = await this.resolveImportDataSource(user, field, String(rawValue ?? ''))
          }
          output[key] = value
        }
        return output
      }),
    )
  }

  private async prepareImportData(
    user: AuthUser,
    formId: string,
    input: Record<string, unknown>,
    fields: FieldVO[],
    access: AccessState,
    importType: ImportType,
    resourceId?: string,
  ): Promise<SaveCustomFormDataDto> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    let name = ''
    let ownerId = ''
    const values: Record<string, unknown> = {}

    if (importType === 'UPDATE') {
      if (!resourceId) throw new BadRequestException('唯一ID不能为空')
      const current = await this.findData(user.tenantId, formId, resourceId)
      this.assertWritableData(access, user.id, current.ownerId)
      const currentVO = this.dataToVO(current, fields)
      name = current.name
      ownerId = current.ownerId
      for (const field of fields) {
        if (field.system || field.type === 'formula') continue
        if (currentVO.values[field.key] !== undefined)
          values[field.key] = currentVO.values[field.key]
      }
    }

    for (const [key, rawValue] of Object.entries(input)) {
      const field = fieldMap.get(key)
      if (!field || field.hidden || field.type === 'formula') continue
      if (field.system && key === 'name') {
        name = String(rawValue ?? '').trim()
        continue
      }
      if (field.system && key === 'ownerId') {
        ownerId = await this.resolveImportUser(user, String(rawValue ?? ''))
        continue
      }
      let value = rawValue
      if (field.type === 'member')
        value = await this.resolveImportUser(user, String(rawValue ?? ''))
      if (field.type === 'dept')
        value = await this.resolveImportDepartment(user, String(rawValue ?? ''))
      if (field.type === 'data_source') {
        value = await this.resolveImportDataSource(user, field, String(rawValue ?? ''))
      }
      if (field.type === 'data_source_multiple') {
        const texts = this.importDataSourceTexts(rawValue)
        value = await Promise.all(
          texts.map((text) => this.resolveImportDataSource(user, field, text)),
        )
      }
      values[key] = value
    }

    if (!name) throw new BadRequestException('名称不能为空')
    if (name.length > 255) throw new BadRequestException('名称不能超过 255 个字符')
    if (!ownerId) throw new BadRequestException('负责人不能为空')
    await this.ensureTenantUsers(user.tenantId, [ownerId])
    if (!access.canManageAll && ownerId !== user.id) {
      throw new ForbiddenException('当前成员只能导入本人负责的数据')
    }
    const validated = await this.metadata.validateCustomData(user.tenantId, formId, values, {
      requireAll: true,
    })
    return { name, ownerId, values: validated }
  }

  private async resolveImportUser(user: AuthUser, value: string) {
    const input = value.trim()
    if (!input) throw new BadRequestException('成员不能为空')
    let direct = await this.prisma.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
      id: input,
    })
      .select('id')
      .first()
    direct ??= await this.prisma.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .where((candidate) => candidate.email.ilike(input))
      .select('id')
      .first()
    if (direct) return direct.id
    const byName = await this.prisma.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
      name: input,
    })
      .select('id')
      .limit(2)
      .all()
    if (!byName.length) throw new BadRequestException(`成员「${input}」不存在或已停用`)
    if (byName.length > 1) {
      throw new BadRequestException(`成员名称「${input}」不唯一，请填写邮箱`)
    }
    return byName[0].id
  }

  private async resolveImportDepartment(user: AuthUser, value: string) {
    const input = value.trim()
    if (!input) throw new BadRequestException('部门不能为空')
    const direct = await this.prisma.client.orm.public.Departments.where({
      tenantId: user.tenantId,
      id: input,
    })
      .select('id')
      .first()
    if (direct) return direct.id
    const byName = await this.prisma.client.orm.public.Departments.where({
      tenantId: user.tenantId,
      name: input,
    })
      .select('id')
      .limit(2)
      .all()
    if (!byName.length) throw new BadRequestException(`部门「${input}」不存在`)
    if (byName.length > 1) {
      throw new BadRequestException(`部门名称「${input}」不唯一，请填写部门 ID`)
    }
    return byName[0].id
  }

  private async loadDataSourceOptionsByIds(
    tenantId: string,
    sourceType: string,
    ids: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (!uniqueIds.length) return []

    if (isBuiltinDataSourceType(sourceType)) {
      return this.loadBuiltinDataSourceOptionsByIds(tenantId, sourceType, uniqueIds)
    }

    const client = this.prisma.client
    const query = client.raw.sql`SELECT id, name
      FROM custom_form_data
      WHERE organization_id = ${tenantId}
        AND custom_form_id = ${sourceType}
        AND id IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(uniqueIds)}::jsonb)
        )`.returnsRow({
      id: client.sql.public.custom_form_data.columns.id,
      name: client.sql.public.custom_form_data.columns.name,
    })
    const rows: Array<{ id: string; name: string }> = []
    for await (const row of client.runtime().query(query.build())) rows.push(row)
    return rows
  }

  private async loadDataSourceOptionsByName(
    tenantId: string,
    sourceType: string,
    name: string,
  ): Promise<Array<{ id: string; name: string }>> {
    if (isBuiltinDataSourceType(sourceType)) {
      return this.loadBuiltinDataSourceOptionsByName(tenantId, sourceType, name)
    }

    const client = this.prisma.client
    const query = client.raw.sql`SELECT id, name
      FROM custom_form_data
      WHERE organization_id = ${tenantId}
        AND custom_form_id = ${sourceType}
        AND name = ${name}
      LIMIT 2`.returnsRow({
      id: client.sql.public.custom_form_data.columns.id,
      name: client.sql.public.custom_form_data.columns.name,
    })
    const rows: Array<{ id: string; name: string }> = []
    for await (const row of client.runtime().query(query.build())) rows.push(row)
    return rows
  }

  private async loadBuiltinDataSourceOptionsByIds(
    tenantId: string,
    sourceType: BuiltinDataSourceType,
    ids: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const client = this.prisma.client
    const idsJson = JSON.stringify(ids)
    const query = (() => {
      switch (sourceType) {
        case 'CUSTOMER':
          return client.raw.sql`SELECT id, name FROM customer
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.customer.columns.id,
            name: client.sql.public.customer.columns.name,
          })
        case 'CONTACT':
          return client.raw.sql`SELECT id, name FROM customer_contact
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.customer_contact.columns.id,
            name: client.sql.public.customer_contact.columns.name,
          })
        case 'OPPORTUNITY':
          return client.raw.sql`SELECT id, name FROM opportunity
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.opportunity.columns.id,
            name: client.sql.public.opportunity.columns.name,
          })
        case 'PRODUCT':
          return client.raw.sql`SELECT id, name FROM product
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.product.columns.id,
            name: client.sql.public.product.columns.name,
          })
        case 'CLUE':
          return client.raw.sql`SELECT id, name FROM clue
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.clue.columns.id,
            name: client.sql.public.clue.columns.name,
          })
        case 'PRICE':
          return client.raw.sql`SELECT id, name FROM product_price
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.product_price.columns.id,
            name: client.sql.public.product_price.columns.name,
          })
        case 'CONTRACT':
          return client.raw.sql`SELECT id, name FROM contract
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.contract.columns.id,
            name: client.sql.public.contract.columns.name,
          })
        case 'QUOTATION':
          return client.raw.sql`SELECT id, name FROM opportunity_quotation
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.opportunity_quotation.columns.id,
            name: client.sql.public.opportunity_quotation.columns.name,
          })
        case 'PAYMENT_PLAN':
          return client.raw.sql`SELECT id, name FROM contract_payment_plan
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.contract_payment_plan.columns.id,
            name: client.sql.public.contract_payment_plan.columns.name,
          })
        case 'CONTRACT_PAYMENT_RECORD':
          return client.raw.sql`SELECT id, name FROM contract_payment_record
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.contract_payment_record.columns.id,
            name: client.sql.public.contract_payment_record.columns.name,
          })
        case 'BUSINESS_TITLE':
          return client.raw.sql`SELECT id, name FROM business_title
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.business_title.columns.id,
            name: client.sql.public.business_title.columns.name,
          })
        case 'ORDER':
          return client.raw.sql`SELECT id, name FROM sales_order
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.sales_order.columns.id,
            name: client.sql.public.sales_order.columns.name,
          })
        case 'INVOICE':
          return client.raw.sql`SELECT id, name FROM contract_invoice
            WHERE organization_id = ${tenantId}
              AND id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`.returnsRow({
            id: client.sql.public.contract_invoice.columns.id,
            name: client.sql.public.contract_invoice.columns.name,
          })
      }
    })()
    const rows: Array<{ id: string; name: string }> = []
    for await (const row of client.runtime().query(query.build())) rows.push(row)
    return rows
  }

  private async loadBuiltinDataSourceOptionsByName(
    tenantId: string,
    sourceType: BuiltinDataSourceType,
    name: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const client = this.prisma.client
    const query = (() => {
      switch (sourceType) {
        case 'CUSTOMER':
          return client.raw.sql`SELECT id, name FROM customer
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.customer.columns.id,
            name: client.sql.public.customer.columns.name,
          })
        case 'CONTACT':
          return client.raw.sql`SELECT id, name FROM customer_contact
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.customer_contact.columns.id,
            name: client.sql.public.customer_contact.columns.name,
          })
        case 'OPPORTUNITY':
          return client.raw.sql`SELECT id, name FROM opportunity
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.opportunity.columns.id,
            name: client.sql.public.opportunity.columns.name,
          })
        case 'PRODUCT':
          return client.raw.sql`SELECT id, name FROM product
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.product.columns.id,
            name: client.sql.public.product.columns.name,
          })
        case 'CLUE':
          return client.raw.sql`SELECT id, name FROM clue
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.clue.columns.id,
            name: client.sql.public.clue.columns.name,
          })
        case 'PRICE':
          return client.raw.sql`SELECT id, name FROM product_price
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.product_price.columns.id,
            name: client.sql.public.product_price.columns.name,
          })
        case 'CONTRACT':
          return client.raw.sql`SELECT id, name FROM contract
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.contract.columns.id,
            name: client.sql.public.contract.columns.name,
          })
        case 'QUOTATION':
          return client.raw.sql`SELECT id, name FROM opportunity_quotation
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.opportunity_quotation.columns.id,
            name: client.sql.public.opportunity_quotation.columns.name,
          })
        case 'PAYMENT_PLAN':
          return client.raw.sql`SELECT id, name FROM contract_payment_plan
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.contract_payment_plan.columns.id,
            name: client.sql.public.contract_payment_plan.columns.name,
          })
        case 'CONTRACT_PAYMENT_RECORD':
          return client.raw.sql`SELECT id, name FROM contract_payment_record
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.contract_payment_record.columns.id,
            name: client.sql.public.contract_payment_record.columns.name,
          })
        case 'BUSINESS_TITLE':
          return client.raw.sql`SELECT id, name FROM business_title
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.business_title.columns.id,
            name: client.sql.public.business_title.columns.name,
          })
        case 'ORDER':
          return client.raw.sql`SELECT id, name FROM sales_order
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.sales_order.columns.id,
            name: client.sql.public.sales_order.columns.name,
          })
        case 'INVOICE':
          return client.raw.sql`SELECT id, name FROM contract_invoice
            WHERE organization_id = ${tenantId} AND name = ${name} LIMIT 2`.returnsRow({
            id: client.sql.public.contract_invoice.columns.id,
            name: client.sql.public.contract_invoice.columns.name,
          })
      }
    })()
    const rows: Array<{ id: string; name: string }> = []
    for await (const row of client.runtime().query(query.build())) rows.push(row)
    return rows
  }

  private async resolveImportDataSource(user: AuthUser, field: FieldVO, value: string) {
    const input = value.trim()
    if (!input) throw new BadRequestException(`「${field.label}」数据源值不能为空`)
    const sourceType = field.config?.dataSourceType
    if (!sourceType) throw new BadRequestException(`「${field.label}」未配置数据源类型`)

    const byId = await this.loadDataSourceOptionsByIds(user.tenantId, sourceType, [input])
    if (byId.some((row) => row.id === input)) return input

    const byName = await this.loadDataSourceOptionsByName(user.tenantId, sourceType, input)
    if (!byName.length) throw new BadRequestException(`「${field.label}」数据「${input}」不存在`)
    if (byName.length > 1) {
      throw new BadRequestException(`「${field.label}」数据名称「${input}」不唯一，请填写记录 ID`)
    }
    return byName[0].id
  }

  private importDataSourceTexts(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return String(value ?? '')
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  private async resolveAccess(user: AuthUser, id: string, options: { requireEnabled: boolean }) {
    const form = await this.prisma.client.orm.public.CustomForm.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!form) throw new NotFoundException('自定义表单不存在')
    const [admin, roleMemberships] = await Promise.all([
      this.prisma.client.orm.public.CustomFormAdmin.where({
        customFormId: id,
        userId: user.id,
      })
        .select('id')
        .first(),
      this.prisma.client.orm.public.CustomFormRoleUser.where({
        userId: user.id,
      })
        .select('roleId')
        .all(),
    ])
    const roleIds = [...new Set(roleMemberships.map((row) => row.roleId))]
    const roleRows = roleIds.length
      ? await this.prisma.client.orm.public.CustomFormRole.where({
          customFormId: id,
        })
          .where((role) => role.id.in(roleIds))
          .select('internalKey')
          .all()
      : []
    const roleKeys = new Set(roleRows.map((role) => String(role.internalKey)))
    const isAdmin = Boolean(admin)
    if (!isAdmin && options.requireEnabled && !form.enable) {
      throw new ForbiddenException('自定义表单当前未启用')
    }
    if (!isAdmin && roleKeys.size === 0) throw new ForbiddenException('没有该自定义表单的访问权限')
    const hasManageAll = roleKeys.has('MANAGE_ALL')
    const hasViewAll = roleKeys.has('VIEW_ALL')
    const hasManageOwn = roleKeys.has('MANAGE_OWN')
    const access: AccessState = {
      isAdmin,
      canViewAll: isAdmin || hasManageAll || hasViewAll,
      canManageAll: isAdmin || hasManageAll,
      canManageOwn: isAdmin || hasManageOwn,
      canCreate: isAdmin || hasManageAll || hasManageOwn,
    }
    return { form, access }
  }

  private async requireAdmin(user: AuthUser, id: string) {
    const result = await this.resolveAccess(user, id, { requireEnabled: false })
    if (!result.access.isAdmin) throw new ForbiddenException('只有表单管理员可以执行该操作')
    return result
  }

  private async ensureNameUnique(organizationId: string, name: string, excludeId?: string) {
    let query = this.prisma.client.orm.public.CustomForm.where({
      organizationId: organizationId,
      name: name,
    })
    if (excludeId) query = query.where((form) => form.id.neq(excludeId))
    const duplicated = await query.select('id').first()
    if (duplicated) throw new BadRequestException('自定义表单名称不能重复')
  }

  private async ensureTenantUsers(tenantId: string, userIds: string[]) {
    if (!userIds.length) return
    const unique = [...new Set(userIds)]
    const users = await this.prisma.client.orm.public.Users.where({
      tenantId,
      status: 'ACTIVE',
    })
      .where((user) => user.id.in(unique))
      .select('id')
      .all()
    if (users.length !== unique.length) throw new BadRequestException('成员不存在或已停用')
  }

  private async userOptions(tenantId: string, userIds: string[]) {
    if (!userIds.length) return []
    return this.prisma.client.orm.public.Users.where({ tenantId })
      .where((user) => user.id.in([...new Set(userIds)]))
      .select('id', 'name')
      .orderBy((user) => user.name.asc())
      .all()
  }

  private async requireField(formId: string, organizationId: string, fieldId: string) {
    const config = await this.moduleForms.getConfig(organizationId, formId)
    const field = config.fields.find((item) => item.id === fieldId)
    if (!field) throw new NotFoundException('字段不存在')
    return field
  }

  private async validateDataSourceConfig(
    user: AuthUser,
    currentFormId: string,
    input:
      | Pick<CreateFieldDto, 'type' | 'config' | 'subFields'>
      | Pick<UpdateFieldDto, 'type' | 'config' | 'subFields'>,
  ) {
    if (['data_source', 'data_source_multiple'].includes(input.type ?? '')) {
      await this.validateSingleDataSourceConfig(user, currentFormId, input.config?.dataSourceType)
      await this.validateDataSourceLinkageConfig(user, currentFormId, input.config)
    }
    for (const subField of input.subFields ?? []) {
      if (!['data_source', 'data_source_multiple'].includes(subField.type)) continue
      await this.validateSingleDataSourceConfig(
        user,
        currentFormId,
        subField.config?.dataSourceType,
      )
    }
  }

  private async validateSingleDataSourceConfig(
    user: AuthUser,
    currentFormId: string,
    rawSourceType?: string,
  ) {
    const sourceType = rawSourceType?.trim()
    if (!sourceType) throw new BadRequestException('数据源字段必须配置数据源类型')
    if (isBuiltinDataSourceType(sourceType)) return
    if (sourceType === currentFormId)
      throw new BadRequestException('自定义表单不能引用自身作为数据源')
    const target = await this.prisma.client.orm.public.CustomForm.where({
      id: sourceType,
      organizationId: user.tenantId,
    })
      .select('id')
      .first()
    if (!target) throw new BadRequestException('自定义表单数据源不存在')
  }

  private async dataSourceConfigFields(
    user: AuthUser,
    sourceType: string,
  ): Promise<FieldVO[] | null> {
    if (!isBuiltinDataSourceType(sourceType)) {
      return this.metadata.listFields(user.tenantId, sourceType)
    }
    const formKey = BUILTIN_DATA_SOURCE_FORM_KEYS[sourceType]
    // BUSINESS_TITLE 使用独立静态表单元数据，不在 SysModuleForm 重复维护。
    if (!formKey) return null
    return this.metadata.listFields(user.tenantId, formKey)
  }

  private dataSourceLinkCompatible(target: FieldVO, source: FieldVO): boolean {
    if (target.type === 'text' || target.type === 'textarea') {
      return !['sub_product', 'picture', 'attachment'].includes(source.type)
    }
    if (['number', 'currency', 'percent'].includes(target.type)) {
      return ['number', 'currency', 'percent', 'formula'].includes(source.type)
    }
    if (['select', 'multiselect'].includes(target.type)) {
      return ['select', 'multiselect', 'radio', 'checkbox'].includes(source.type)
    }
    if (['data_source', 'data_source_multiple'].includes(target.type)) {
      return (
        ['data_source', 'data_source_multiple'].includes(source.type) &&
        target.config?.dataSourceType === source.config?.dataSourceType
      )
    }
    return target.type === source.type
  }

  private async validateDataSourceLinkageConfig(
    user: AuthUser,
    currentFormId: string,
    config?: FieldConfig | null,
  ) {
    const sourceType = config?.dataSourceType?.trim()
    if (!sourceType) return
    const sourceFields = await this.dataSourceConfigFields(user, sourceType)
    if (!sourceFields) return
    const currentFields = await this.metadata.listFields(user.tenantId, currentFormId)
    const sourceById = new Map(sourceFields.map((field) => [field.id, field]))
    const currentById = new Map(currentFields.map((field) => [field.id, field]))

    for (const id of config?.showFields ?? []) {
      if (!sourceById.has(id)) throw new BadRequestException('数据源派生显示字段不存在')
    }
    for (const condition of config?.combineSearch?.conditions ?? []) {
      const source = sourceById.get(condition.leftFieldId)
      if (!source) throw new BadRequestException('数据源过滤引用的源字段不存在')
      if (condition.leftFieldType !== source.type) {
        throw new BadRequestException('数据源过滤字段类型与当前源表单不一致')
      }
      if (condition.matchType === 'MATCH_FIELD') {
        const current = condition.rightFieldId ? currentById.get(condition.rightFieldId) : undefined
        if (!current) throw new BadRequestException('数据源过滤引用的当前字段不存在')
        if (condition.rightFieldType && condition.rightFieldType !== current.type) {
          throw new BadRequestException('数据源过滤右侧字段类型与当前表单不一致')
        }
      }
    }
    for (const link of config?.linkFields ?? []) {
      const current = currentById.get(link.current)
      const source = sourceById.get(link.link)
      if (!current) throw new BadRequestException('数据源填充引用的当前字段不存在')
      if (!source) throw new BadRequestException('数据源填充引用的源字段不存在')
      if (!this.dataSourceLinkCompatible(current, source)) {
        throw new BadRequestException(`「${source.label}」不能填充到「${current.label}」`)
      }
    }
    for (const parentLink of config?.childLinkFields ?? []) {
      const currentParent = currentById.get(parentLink.current)
      const sourceParent = sourceById.get(parentLink.link)
      if (currentParent?.type !== 'sub_product' || sourceParent?.type !== 'sub_product') {
        throw new BadRequestException('数据源子表填充引用的源/目标子表不存在')
      }
      const currentChildren = new Map(
        (currentParent.subFields ?? []).map((field) => [field.id, field]),
      )
      const sourceChildren = new Map(
        (sourceParent.subFields ?? []).map((field) => [field.id, field]),
      )
      for (const childLink of parentLink.childLinks) {
        const current = currentChildren.get(childLink.current)
        const source = sourceChildren.get(childLink.link)
        if (!current || !source) {
          throw new BadRequestException('数据源子表填充引用的子字段不存在')
        }
        if (!this.dataSourceLinkCompatible(current, source)) {
          throw new BadRequestException(`「${source.label}」不能填充到「${current.label}」`)
        }
      }
    }
  }

  private async hydrateDataRows(rows: CustomFormDataRow[]): Promise<DataRow[]> {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const [fieldValues, fieldBlobValues] = await Promise.all([
      this.prisma.client.orm.public.CustomFormDataField.where((field) =>
        field.resourceId.in(ids),
      ).all(),
      this.prisma.client.orm.public.CustomFormDataFieldBlob.where((field) =>
        field.resourceId.in(ids),
      ).all(),
    ])
    const normalByResource = new Map<string, DataRow['fieldValues']>()
    const blobByResource = new Map<string, DataRow['fieldBlobValues']>()
    for (const field of fieldValues) {
      const bucket = normalByResource.get(field.resourceId) ?? []
      bucket.push({
        fieldId: field.fieldId,
        fieldValue: field.fieldValue,
        refSubId: field.refSubId,
        rowId: field.rowId,
        bizId: field.bizId,
      })
      normalByResource.set(field.resourceId, bucket)
    }
    for (const field of fieldBlobValues) {
      const bucket = blobByResource.get(field.resourceId) ?? []
      bucket.push({
        fieldId: field.fieldId,
        fieldValue: field.fieldValue,
        refSubId: field.refSubId,
        rowId: field.rowId,
        bizId: field.bizId,
      })
      blobByResource.set(field.resourceId, bucket)
    }
    return rows.map((row) => ({
      id: row.id,
      customFormId: row.customFormId,
      name: row.name,
      ownerId: row.owner,
      organizationId: row.organizationId,
      createTime: row.createTime,
      updateTime: row.updateTime,
      createUser: row.createUser,
      updateUser: row.updateUser,
      fieldValues: normalByResource.get(row.id) ?? [],
      fieldBlobValues: blobByResource.get(row.id) ?? [],
    }))
  }

  private async findData(organizationId: string, formId: string, dataId: string): Promise<DataRow> {
    const row = await this.prisma.client.orm.public.CustomFormData.where({
      id: dataId,
      customFormId: formId,
      organizationId: organizationId,
    }).first()
    if (!row) throw new NotFoundException('自定义表单数据不存在')
    const [hydrated] = await this.hydrateDataRows([row])
    if (!hydrated) throw new NotFoundException('自定义表单数据不存在')
    return hydrated
  }

  private assertReadableData(access: AccessState, userId: string, ownerId: string) {
    if (!access.canViewAll && ownerId !== userId)
      throw new NotFoundException('自定义表单数据不存在')
  }

  private assertWritableData(access: AccessState, userId: string, ownerId: string) {
    if (access.canManageAll) return
    if (access.canManageOwn && ownerId === userId) return
    throw new ForbiddenException('当前成员没有修改该表单数据的权限')
  }

  private decodeAttachmentIds(value: string): string[] {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        : []
    } catch {
      return []
    }
  }

  private attachmentIdsFromRow(row: DataRow, fields: FieldVO[]): string[] {
    const attachmentFieldIds = new Set(
      fields.filter((field) => field.type === 'attachment').map((field) => field.id),
    )
    return [
      ...new Set(
        row.fieldBlobValues
          .filter((stored) => attachmentFieldIds.has(stored.fieldId))
          .flatMap((stored) => this.decodeAttachmentIds(stored.fieldValue)),
      ),
    ]
  }

  private attachmentLimitBytes(field: FieldVO): number {
    const configured = field.config?.limitSize?.trim()
    if (!configured) return 20 * 1024 * 1024
    const match = configured.match(/^(\d+(?:\.\d+)?)(KB|MB)$/i)
    if (!match) return 20 * 1024 * 1024
    return Number(match[1]) * (match[2]?.toUpperCase() === 'KB' ? 1024 : 1024 * 1024)
  }

  private async validateAttachmentValues(
    user: AuthUser,
    dataId: string | null,
    fields: FieldVO[],
    values: Record<string, unknown>,
  ): Promise<{ allIds: string[]; tempIds: string[] }> {
    // 即使字段被隐藏，API 仍可能收到其值；附件归属校验不能因为 UI hidden 而被绕过。
    const attachmentFields = fields.filter((field) => field.type === 'attachment')
    const idsByField = new Map<string, string[]>()
    const allIds: string[] = []

    for (const field of attachmentFields) {
      const value = values[field.key]
      const ids = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        : []
      idsByField.set(field.id, ids)
      allIds.push(...ids)
    }

    if (new Set(allIds).size !== allIds.length) {
      throw new BadRequestException('同一个附件不能同时绑定到多个附件字段')
    }
    if (!allIds.length) return { allIds: [], tempIds: [] }

    const rows = await this.prisma.client.orm.public.Attachments.where({ tenantId: user.tenantId })
      .where((attachment) => attachment.id.in(allIds))
      .select('id', 'name', 'size', 'uploaderId', 'targetType', 'targetId')
      .all()
    if (rows.length !== allIds.length) throw new BadRequestException('附件包含不存在的记录')
    const rowMap = new Map(rows.map((row) => [row.id, row]))
    const tempIds: string[] = []

    for (const field of attachmentFields) {
      const accepted = (field.config?.accept ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
      const limitBytes = this.attachmentLimitBytes(field)
      for (const attachmentId of idsByField.get(field.id) ?? []) {
        const row = rowMap.get(attachmentId)
        if (!row) throw new BadRequestException('附件不存在')
        const isTemporary = row.targetType === null && row.targetId === null
        const isCurrentData =
          Boolean(dataId) &&
          row.targetType === CUSTOM_FORM_ATTACHMENT_TARGET &&
          row.targetId === dataId
        if (isTemporary) {
          if (row.uploaderId !== user.id) {
            throw new ForbiddenException(`「${field.label}」包含其他成员上传的临时附件`)
          }
          tempIds.push(row.id)
        } else if (!isCurrentData) {
          throw new BadRequestException(`「${field.label}」包含已绑定到其他业务对象的附件`)
        }
        if (
          accepted.length &&
          !accepted.some((extension) => row.name.toLowerCase().endsWith(extension))
        ) {
          throw new BadRequestException(`「${field.label}」包含不允许的文件类型：${row.name}`)
        }
        if (row.size > limitBytes) {
          throw new BadRequestException(`「${field.label}」附件超出单文件大小限制：${row.name}`)
        }
      }
    }
    return { allIds, tempIds }
  }

  private async claimTemporaryAttachments(
    tx: PrismaTransaction,
    user: AuthUser,
    dataId: string,
    ids: string[],
  ) {
    if (!ids.length) return
    const count = await tx.orm.public.Attachments.where({
      tenantId: user.tenantId,
      uploaderId: user.id,
      targetType: null,
      targetId: null,
    })
      .where((attachment) => attachment.id.in(ids))
      .updateAndCount({ targetType: CUSTOM_FORM_ATTACHMENT_TARGET, targetId: dataId })
    if (count !== ids.length) {
      throw new BadRequestException('附件状态已变化，请刷新后重试')
    }
  }

  private async buildAttachmentMap(
    tenantId: string,
    dataId: string,
    fields: FieldVO[],
    values: Record<string, unknown>,
  ) {
    const output: Record<
      string,
      Awaited<ReturnType<AttachmentsService['listByIdsFromTarget']>>
    > = {}
    for (const field of fields) {
      if (field.type !== 'attachment') continue
      const rawValue = values[field.key]
      const ids: string[] = Array.isArray(rawValue)
        ? rawValue.filter(
            (item: unknown): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      if (!ids.length) {
        output[field.key] = []
        continue
      }
      const rows = await this.attachments.listByIdsFromTarget(
        tenantId,
        ids,
        CUSTOM_FORM_ATTACHMENT_TARGET,
        dataId,
      )
      const byId = new Map(rows.map((row) => [row.id, row]))
      output[field.key] = ids.flatMap((id) => {
        const row = byId.get(id)
        return row ? [row] : []
      })
    }
    return output
  }

  async viewDataAttachment(user: AuthUser, formId: string, dataId: string, attachmentId: string) {
    const { access } = await this.resolveAccess(user, formId, { requireEnabled: true })
    const row = await this.findData(user.tenantId, formId, dataId)
    this.assertReadableData(access, user.id, row.ownerId)
    return this.attachments.viewFromTarget(
      user.tenantId,
      attachmentId,
      CUSTOM_FORM_ATTACHMENT_TARGET,
      dataId,
    )
  }

  private async validateValues(
    organizationId: string,
    formId: string,
    input: Record<string, unknown> | undefined,
    requireAll: boolean,
  ) {
    const fields = await this.metadata.listFields(organizationId, formId)
    const values = await this.metadata.validateCustomData(organizationId, formId, input, {
      requireAll,
    })
    await this.validateDataSourceValues(organizationId, fields, values)
    return { fields, values }
  }

  private async validateDataSourceValues(
    tenantId: string,
    fields: FieldVO[],
    values: Record<string, unknown>,
  ) {
    for (const field of fields) {
      if (field.type === 'sub_product') {
        const rows = values[field.key]
        if (!Array.isArray(rows)) continue
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue
          const record = row as Record<string, unknown>
          for (const subField of field.subFields ?? []) {
            if (!['data_source', 'data_source_multiple'].includes(subField.type)) continue
            const value = record[subField.key]
            if (this.isEmptyValue(value)) continue
            await this.validateDataSourceFieldValue(tenantId, subField, value)
          }
        }
        continue
      }
      if (!['data_source', 'data_source_multiple'].includes(field.type)) continue
      const value = values[field.key]
      if (this.isEmptyValue(value)) continue
      await this.validateDataSourceFieldValue(tenantId, field, value)
    }
  }

  private async validateDataSourceFieldValue(tenantId: string, field: FieldVO, value: unknown) {
    const sourceType = field.config?.dataSourceType
    if (!sourceType) throw new BadRequestException(`「${field.label}」未配置数据源类型`)
    const ids = Array.isArray(value) ? value.map(String) : [String(value)]
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    const rows = await this.loadDataSourceOptionsByIds(tenantId, sourceType, uniqueIds)
    const existing = new Set(rows.map((row) => row.id))
    const missing = uniqueIds.filter((id) => !existing.has(id))
    if (missing.length) {
      throw new BadRequestException(`「${field.label}」包含不存在的数据源记录`)
    }
  }

  private dataToVO(row: DataRow, fields: FieldVO[]) {
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    const values: Record<string, unknown> = {}
    for (const stored of [...row.fieldValues, ...row.fieldBlobValues]) {
      if (stored.refSubId) continue
      const field = fieldMap.get(stored.fieldId)
      if (!field) continue
      values[field.key] = this.decodeValue(field, stored.fieldValue)
    }
    for (const field of fields) {
      if (field.type !== 'sub_product') continue
      values[field.key] = this.decodeSubTableRows(row, field)
    }
    Object.assign(
      values,
      this.metadata.computeFormulas(fields, { name: row.name, ownerId: row.ownerId }, values),
    )
    return {
      id: row.id,
      customFormId: row.customFormId,
      name: row.name,
      ownerId: row.ownerId,
      organizationId: row.organizationId,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      createUser: row.createUser,
      updateUser: row.updateUser,
      values,
    }
  }

  private decodeValue(field: FieldVO, value: string): unknown {
    if (
      ['multiselect', 'checkbox', 'picture', 'attachment', 'data_source_multiple'].includes(
        field.type,
      )
    ) {
      try {
        const parsed: unknown = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    if (['number', 'currency', 'percent'].includes(field.type)) {
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    }
    if (field.type === 'switch') return value === 'true'
    return value
  }

  private decodeSubTableRows(row: DataRow, field: FieldVO): Array<Record<string, unknown>> {
    const subFields = field.subFields ?? []
    const subFieldMap = new Map(subFields.map((subField) => [subField.id, subField]))
    const grouped = new Map<number, Record<string, unknown>>()
    const cells = [...row.fieldValues, ...row.fieldBlobValues]
      .filter((stored) => stored.refSubId === field.id && stored.rowId !== null)
      .sort((a, b) => (a.rowId ?? 0) - (b.rowId ?? 0))
    for (const stored of cells) {
      const rowId = stored.rowId
      if (rowId === null) continue
      const subField = subFieldMap.get(stored.fieldId)
      if (!subField) continue
      if (!grouped.has(rowId)) grouped.set(rowId, { id: stored.bizId ?? undefined })
      const output = grouped.get(rowId)!
      if (!output['id'] && stored.bizId) output['id'] = stored.bizId
      output[subField.key] = this.decodeValue(subField, stored.fieldValue)
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, output]) => {
        Object.assign(output, this.metadata.computeFormulas(subFields, {}, output))
        return output
      })
  }

  private encodeValue(value: unknown): string {
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
      return JSON.stringify(value)
    }
    return String(value)
  }

  private async replaceFieldValues(
    tx: PrismaTransaction,
    resourceId: string,
    fields: FieldVO[],
    values: Record<string, unknown>,
  ) {
    await Promise.all([
      tx.orm.public.CustomFormDataField.where({ resourceId: resourceId }).deleteAll(),
      tx.orm.public.CustomFormDataFieldBlob.where({
        resourceId: resourceId,
      }).deleteAll(),
    ])
    const byKey = new Map(fields.map((field) => [field.key, field]))
    const normal: Array<{
      resourceId: string
      fieldId: string
      fieldValue: string
      refSubId?: string
      rowId?: number
      bizId?: string
    }> = []
    const blob: Array<{
      resourceId: string
      fieldId: string
      fieldValue: string
      refSubId?: string
      rowId?: number
      bizId?: string
    }> = []
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null || value === '') continue
      const field = byKey.get(key)
      if (!field || field.type === 'formula') continue
      if (field.type === 'sub_product') {
        this.appendSubTableValues(resourceId, field, value, normal, blob)
        continue
      }
      const target = BLOB_FIELD_TYPES.has(field.type) ? blob : normal
      target.push({ resourceId, fieldId: field.id, fieldValue: this.encodeValue(value) })
    }
    if (normal.length) {
      await tx.orm.public.CustomFormDataField.createAll(
        normal.map((row) => ({
          id: createLegacyId32(),
          resourceId: row.resourceId,
          fieldId: row.fieldId,
          fieldValue: row.fieldValue,
          refSubId: row.refSubId ? row.refSubId : null,
          rowId: row.rowId ?? null,
          bizId: row.bizId ? row.bizId : null,
        })),
      )
    }
    if (blob.length) {
      await tx.orm.public.CustomFormDataFieldBlob.createAll(
        blob.map((row) => ({
          id: createLegacyId32(),
          resourceId: row.resourceId,
          fieldId: row.fieldId,
          fieldValue: row.fieldValue,
          refSubId: row.refSubId ? row.refSubId : null,
          rowId: row.rowId ?? null,
          bizId: row.bizId ? row.bizId : null,
        })),
      )
    }
  }

  private appendSubTableValues(
    resourceId: string,
    field: FieldVO,
    value: unknown,
    normal: Array<{
      resourceId: string
      fieldId: string
      fieldValue: string
      refSubId?: string
      rowId?: number
      bizId?: string
    }>,
    blob: Array<{
      resourceId: string
      fieldId: string
      fieldValue: string
      refSubId?: string
      rowId?: number
      bizId?: string
    }>,
  ) {
    if (!Array.isArray(value)) return
    const subFields = new Map((field.subFields ?? []).map((subField) => [subField.key, subField]))
    value.forEach((rawRow, index) => {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return
      const row = rawRow as Record<string, unknown>
      const rowId = index + 1
      const bizId =
        typeof row['id'] === 'string' && row['id'].trim()
          ? row['id'].trim()
          : `sr_${randomBytes(10).toString('hex')}`
      for (const [key, cellValue] of Object.entries(row)) {
        if (key === 'id' || this.isEmptyValue(cellValue)) continue
        const subField = subFields.get(key)
        if (!subField || subField.type === 'formula') continue
        const target = BLOB_FIELD_TYPES.has(subField.type) ? blob : normal
        target.push({
          resourceId,
          fieldId: subField.id,
          fieldValue: this.encodeValue(cellValue),
          refSubId: field.id,
          rowId,
          bizId,
        })
      }
    })
  }

  private async createSystemField(
    tx: PrismaTransaction,
    formId: string,
    key: string,
    name: string,
    type: string,
    pos: number,
    actorId: string,
    now: bigint,
  ) {
    const fieldId = createLegacyId32()
    const created = await tx.orm.public.SysModuleField.create({
      id: fieldId,
      formId: formId,
      internalKey: key,
      name: name,
      _type: type,
      mobile: false,
      pos: BigInt(pos),
      createUser: actorId,
      updateUser: actorId,
      createTime: now,
      updateTime: now,
    })
    await tx.orm.public.SysModuleFieldBlob.create({
      id: fieldId,
      prop: JSON.stringify({
        key,
        required: true,
        system: true,
        hidden: false,
        options: null,
        config: null,
        span: 12,
        showInList: true,
        listWidth: null,
      }),
    })
    return created
  }
}
