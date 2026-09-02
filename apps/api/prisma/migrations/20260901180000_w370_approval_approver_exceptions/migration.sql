-- W3.7-9.4B / DB-012: approver exception handling and dynamic direction.
CREATE TYPE "EmptyApproverAction" AS ENUM ('AUTO_PASS', 'ASSIGN_SPECIFIC', 'ASSIGN_ADMIN');
CREATE TYPE "SameSubmitterAction" AS ENUM ('SKIP', 'ALLOW', 'ASSIGN_SUPERIOR');
CREATE TYPE "ApproverDirection" AS ENUM ('BOTTOM_UP', 'TOP_DOWN');

ALTER TYPE "ApproverType" ADD VALUE IF NOT EXISTS 'MULTIPLE_DEPT_LEADER';
ALTER TYPE "ApproverType" ADD VALUE IF NOT EXISTS 'MULTIPLE_DIRECT_LEADER';

ALTER TABLE "approval_node_approvers"
  ADD COLUMN "empty_approver_action" "EmptyApproverAction" NOT NULL DEFAULT 'AUTO_PASS',
  ADD COLUMN "fallback_approver" TEXT,
  ADD COLUMN "same_submitter_action" "SameSubmitterAction" NOT NULL DEFAULT 'SKIP',
  ADD COLUMN "approver_direction" "ApproverDirection" NOT NULL DEFAULT 'BOTTOM_UP';

-- Cordys 自动通过记录允许没有 task；9.4B 用于 empty approver AUTO_PASS 审计事实。
ALTER TABLE "approval_records" ALTER COLUMN "taskId" DROP NOT NULL;
