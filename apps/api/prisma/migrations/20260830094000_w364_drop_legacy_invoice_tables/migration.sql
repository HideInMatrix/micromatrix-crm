-- W3.6.4: direct contract_invoice/business_title have replaced the legacy
-- invoice_records/invoice_titles runtime completely. Drop the old tables so
-- PENDING/ISSUED/VOID cannot become a second invoice truth source again.

DROP TABLE IF EXISTS "invoice_records";
DROP TABLE IF EXISTS "invoice_titles";
