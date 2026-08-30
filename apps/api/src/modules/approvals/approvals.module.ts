import { Global, Module } from '@nestjs/common'
import { ApprovalsController } from './approvals.controller'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import { ApprovalResourceCaptureService } from './approval-resource-capture.service'
import { ApprovalResourceRestoreService } from './approval-resource-restore.service'
import { ApprovalResourceService } from './approval-resource.service'
import { ApprovalResourceSnapshotService } from './approval-resource-snapshot.service'
import { ApprovalsService } from './approvals.service'

/** 全局模块：业务模块需要检查审批流是否启用 */
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalFlowConfigService,
    ApprovalResourceCaptureService,
    ApprovalResourceRestoreService,
    ApprovalResourceSnapshotService,
    ApprovalResourceService,
  ],
  exports: [ApprovalsService, ApprovalFlowConfigService],
})
export class ApprovalsModule {}
