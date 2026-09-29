import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  ApprovalFieldPermission,
  ApprovalModule,
  ApprovalResourceFieldVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { ApprovalJsonValue, ApprovalResourceInstance } from './approval-runtime.types'

export interface ApprovalTargetInfo {
  name: string
  amount: number
  approvalStatus: string
}

/**
 * 审批引擎与业务资源之间的适配边界。
 *
 * 招生 CRM 已退出报价、合同、发票和订单交易域，因此审批核心不再直接访问这些
 * 业务表。保留该服务是为了让流程、实例、任务和 Webhook 等通用审批基础设施继续
 * 具备稳定边界；后续新增可审批资源时，应通过新的通用资源适配器显式接入。
 */
@Injectable()
export class ApprovalResourceService {
  capture(_user: AuthUser, module: ApprovalModule, _targetId: string): never {
    return this.unsupported(module)
  }

  savePreUpdateSnapshot(
    _user: AuthUser,
    module: ApprovalModule,
    _targetId: string,
    _snapshotData: ApprovalJsonValue,
  ): never {
    return this.unsupported(module)
  }

  async deriveUpdateFields(
    _user: AuthUser,
    module: ApprovalModule,
    _targetId: string,
    _before: ApprovalJsonValue,
  ): Promise<string[]> {
    return this.unsupported(module)
  }

  async conditionFieldValues(
    _user: AuthUser,
    module: ApprovalModule,
    _targetId: string,
  ): Promise<Record<string, unknown>> {
    return this.unsupported(module)
  }

  async approvalFields(
    _user: AuthUser,
    module: ApprovalModule,
    _targetId: string,
    _permissions: ApprovalFieldPermission[],
    _forceView = false,
  ): Promise<ApprovalResourceFieldVO[]> {
    return this.unsupported(module)
  }

  async updateApprovalFields(
    _user: AuthUser,
    module: ApprovalModule,
    _targetId: string,
    _updates: Array<{ fieldId: string; value: unknown }>,
    _editableFieldIds: ReadonlySet<string>,
  ): Promise<void> {
    return this.unsupported(module)
  }

  async updateApprovalPostFields(
    _tenantId: string,
    _operatorId: string,
    module: ApprovalModule,
    _targetId: string,
    updates: Array<{ fieldId: string; value: unknown }>,
  ): Promise<void> {
    if (!updates.length) return
    return this.unsupported(module)
  }

  async webhookVariables(
    _tenantId: string,
    module: ApprovalModule,
    _targetId: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    return this.unsupported(module)
  }

  targetInfo(_tenantId: string, module: ApprovalModule, _targetId: string): ApprovalTargetInfo {
    return this.unsupported(module)
  }

  setBizStatus(
    _tenantId: string,
    module: ApprovalModule,
    _targetId: string,
    _status: string,
  ): never {
    return this.unsupported(module)
  }

  async restore(instance: ApprovalResourceInstance, _operatorId: string): Promise<void> {
    if (instance.executeTiming !== 'UPDATE') return
    return this.unsupported(instance.module as ApprovalModule)
  }

  async effectApproved(instance: ApprovalResourceInstance): Promise<void> {
    if (instance.executeTiming === 'CREATE') return
    return this.unsupported(instance.module as ApprovalModule)
  }

  private unsupported(module: ApprovalModule): never {
    throw new BadRequestException(
      `审批业务资源「${module}」已退出当前产品，未注册可用的审批资源适配器`,
    )
  }
}
