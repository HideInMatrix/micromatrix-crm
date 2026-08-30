-- W3.6.4: after the direct payment migration copied all effective legacy data,
-- remove the old MicroMatrix receivable tables so they cannot become a second
-- business truth source again.

DROP TABLE IF EXISTS "receivable_records";
DROP TABLE IF EXISTS "receivable_plans";
