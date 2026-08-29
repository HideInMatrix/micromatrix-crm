-- W3.6.2 forward repair: keep quotation formulas/configuration source-driven.
-- Cordys default form/field.json defines quotationProductAmount and quotationDiscount as
-- INPUT_NUMBER fields and quotationAmount as FORMULA, but does not hard-code either a
-- discount default value or a formula expression. Those values belong to form configuration.

UPDATE "sys_module_field" field
SET "type" = 'number'
FROM "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'quote'
  AND field."internal_key" = 'productAmount';

UPDATE "sys_module_field_blob" blob
SET "prop" = CASE field."internal_key"
  WHEN 'productAmount' THEN '{"key":"productAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'
  WHEN 'discount' THEN '{"key":"discount","required":false,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'
  WHEN 'lineAmount' THEN '{"key":"lineAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'
  ELSE blob."prop"
END
FROM "sys_module_field" field
JOIN "sys_module_form" form ON form."id" = field."form_id"
WHERE blob."id" = field."id"
  AND form."form_key" = 'quote'
  AND field."internal_key" IN ('productAmount', 'discount', 'lineAmount');
