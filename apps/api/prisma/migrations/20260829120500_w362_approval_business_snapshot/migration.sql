-- W3.6.2: Cordys HitApproval UPDATE semantics require restoring the pre-update
-- business state when an approval is rejected or revoked. Keep the snapshot on
-- the generic approval instance so later contract/order alignment can reuse it.
ALTER TABLE "approval_instances" ADD COLUMN "business_snapshot" JSONB;
