import { Global, Module } from '@nestjs/common'
import { ApprovalsController } from './approvals.controller'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import { ApprovalsService } from './approvals.service'

/** 全局模块：业务模块需要检查审批流是否启用 */
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalFlowConfigService],
  exports: [ApprovalsService, ApprovalFlowConfigService],
})
export class ApprovalsModule {}
