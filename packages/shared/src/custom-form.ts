import type { FieldVO } from './metadata'
import type { AttachmentVO } from './sales'

export type CustomFormRoleKey = 'MANAGE_ALL' | 'VIEW_ALL' | 'MANAGE_OWN'

export interface CustomFormListVO {
  id: string
  name: string
  enable: boolean
  organizationId: string
  isAdmin: boolean
  hasCreateDataPermission: boolean
}

export interface CustomFormDetailVO extends CustomFormListVO {
  creator: { id: string; name: string } | null
  formProp: Record<string, unknown>
  fields: FieldVO[]
}

export interface CustomFormRoleVO {
  id: string
  name: string
  internalKey: CustomFormRoleKey
  users: Array<{ id: string; name: string }>
}

export interface CustomFormDataAccessVO {
  isAdmin: boolean
  canViewAll: boolean
  canManageAll: boolean
  canManageOwn: boolean
  canCreate: boolean
}

export interface CustomFormDataVO {
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

export interface CustomFormDataDetailVO extends CustomFormDataVO {
  fields: FieldVO[]
  access: CustomFormDataAccessVO
  attachmentMap: Record<string, AttachmentVO[]>
}

export interface CustomFormDataPageVO {
  list: CustomFormDataVO[]
  total: number
  current: number
  pageSize: number
  fields: FieldVO[]
  access: CustomFormDataAccessVO
}

export interface SaveCustomFormInput {
  name: string
  enable?: boolean
  formProp?: Record<string, unknown>
}

export interface SaveCustomFormDataInput {
  name: string
  ownerId: string
  values?: Record<string, unknown>
}
