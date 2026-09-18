import { Injectable } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { jsonValue } from '../../prisma/json-value'
import { MODULE_TO_FORM_TYPE, toDbFormType } from './approval-flow-config.utils'
import type { ApprovalJsonValue, ApprovalResourceInstance } from './approval-runtime.types'

@Injectable()
export class ApprovalResourceSnapshotService {
  constructor(private readonly prisma8: Prisma8Service) {}

  async save(
    user: AuthUser,
    module: ApprovalModule,
    resourceId: string,
    snapshotData: ApprovalJsonValue,
  ) {
    const formType = this.formType(module)
    const scope = { tenantId: user.tenantId, formType, resourceId }
    const data = {
      snapshotData: jsonValue(snapshotData),
      updatedById: user.id,
      updatedAt: prisma8Now(),
    }
    const updated = await this.snapshots().where(scope).update(data)
    if (updated) return
    try {
      await this.snapshots().create({
        ...scope,
        snapshotData: data.snapshotData,
        createdById: user.id,
        updatedById: user.id,
        updatedAt: data.updatedAt,
      })
    } catch (error) {
      if ((error as { sqlState?: string }).sqlState !== '23505') throw error
      await this.snapshots().where(scope).update(data)
    }
  }

  async load(instance: ApprovalResourceInstance): Promise<ApprovalJsonValue | null> {
    const module = instance.module as ApprovalModule
    const row = await this.snapshots()
      .where({
        tenantId: instance.tenantId,
        formType: this.formType(module),
        resourceId: instance.targetId,
      })
      .select('snapshotData')
      .first()
    return (row?.snapshotData as ApprovalJsonValue | undefined) ?? null
  }

  async clear(instance: ApprovalResourceInstance) {
    const module = instance.module as ApprovalModule
    await this.snapshots()
      .where({
        tenantId: instance.tenantId,
        formType: this.formType(module),
        resourceId: instance.targetId,
      })
      .deleteAll()
  }

  private formType(module: ApprovalModule) {
    const formType = MODULE_TO_FORM_TYPE[module]
    if (!formType) throw new Error(`Unsupported approval resource module: ${module}`)
    return toDbFormType(formType)
  }

  private snapshots() {
    return this.prisma8.client.orm.public.ApprovalResourceSnapshots
  }
}
