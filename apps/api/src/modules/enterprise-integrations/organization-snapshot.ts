export interface OrganizationDepartmentSnapshot {
  id: string
  externalKey: string
  name: string
  parentId: string
  parentExternalKey: string
  order: number
  isRoot: boolean
}

export interface OrganizationUserSnapshot {
  userId: string
  externalKey: string
  name: string
  email: string | null
  mobile: string | null
  position: string | null
  mainDepartmentId: string
  mainDepartmentExternalKey: string
  isLeader: boolean
  unionId?: string | null
}

export interface OrganizationSnapshot {
  departments: OrganizationDepartmentSnapshot[]
  users: OrganizationUserSnapshot[]
}

export class OrganizationSnapshotError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OrganizationSnapshotError'
  }
}
