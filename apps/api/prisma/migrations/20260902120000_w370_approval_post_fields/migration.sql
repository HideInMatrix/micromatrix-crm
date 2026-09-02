ALTER TABLE "approval_node_approvers"
ADD COLUMN "pass_post_config" JSONB,
ADD COLUMN "reject_post_config" JSONB;
