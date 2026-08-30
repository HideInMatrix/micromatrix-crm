-- W3.6.5 final schema repair: the legacy `orders` table used NOT NULL for
-- contractId/amount. The direct Cordys-compatible `sales_order` model allows
-- both columns to be nullable, and contract deletion uses ON DELETE SET NULL.
-- Keep this as a follow-up migration because 20260830113000 has already been
-- applied in development databases.

ALTER TABLE "sales_order"
  ALTER COLUMN "contract_id" DROP NOT NULL,
  ALTER COLUMN "amount" DROP NOT NULL;
