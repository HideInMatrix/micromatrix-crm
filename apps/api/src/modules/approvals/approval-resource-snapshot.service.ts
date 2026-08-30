import { Injectable } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { ApprovalInstance } from '../../generated/prisma/client'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MODULE_TO_FORM_TYPE, toDbFormType } from './approval-flow-config.utils'

@Injectable()
export class ApprovalResourceSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    user: AuthUser,
    module: ApprovalModule,
    resourceId: string,
    snapshotData: Prisma.InputJsonValue,
  ) {
    const formType = this.formType(module)
    await this.prisma.approvalResourceSnapshot.upsert({
      where: {
        tenantId_formType_resourceId: {
          tenantId: user.tenantId,
          formType,
          resourceId,
        },
      },
      create: {
        tenantId: user.tenantId,
        formType,
        resourceId,
        snapshotData,
        createdById: user.id,
        updatedById: user.id,
      },
      update: {
        snapshotData,
        updatedById: user.id,
      },
    })
  }

  async load(instance: ApprovalInstance): Promise<Prisma.JsonValue | null> {
    const module = instance.module as ApprovalModule
    const row = await this.prisma.approvalResourceSnapshot.findUnique({
      where: {
        tenantId_formType_resourceId: {
          tenantId: instance.tenantId,
          formType: this.formType(module),
          resourceId: instance.targetId,
        },
      },
      select: { snapshotData: true },
    })
    return row?.snapshotData ?? null
  }

  async clear(instance: ApprovalInstance) {
    const module = instance.module as ApprovalModule
    await this.prisma.approvalResourceSnapshot.deleteMany({
      where: {
        tenantId: instance.tenantId,
        formType: this.formType(module),
        resourceId: instance.targetId,
      },
    })
  }

  private formType(module: ApprovalModule) {
    const formType = MODULE_TO_FORM_TYPE[module]
    if (!formType) throw new Error(`Unsupported approval resource module: ${module}`)
    return toDbFormType(formType)
  }
}
