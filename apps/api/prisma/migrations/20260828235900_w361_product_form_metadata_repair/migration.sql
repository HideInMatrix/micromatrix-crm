-- W3.6.1 forward-only repair for tenants whose Product form was initialized
-- before the Cordys direct Product model was adopted.
--
-- The old MicroMatrix product form exposed code/category/unit/cost as system
-- fields and treated description as a main-table field. Cordys Product keeps
-- only name/price/status in the main table; description is a form field value.

DELETE FROM "sys_module_field" field
USING "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'product'
  AND field."internal_key" IN ('code', 'category', 'unit', 'cost');

UPDATE "sys_module_field" field
SET "name" = CASE field."internal_key"
      WHEN 'name' THEN '产品名称'
      WHEN 'price' THEN '产品价格'
      WHEN 'status' THEN '状态'
      WHEN 'description' THEN '描述'
      ELSE field."name"
    END,
    "type" = CASE field."internal_key"
      WHEN 'name' THEN 'text'
      WHEN 'price' THEN 'currency'
      WHEN 'status' THEN 'radio'
      WHEN 'description' THEN 'textarea'
      ELSE field."type"
    END,
    "pos" = CASE field."internal_key"
      WHEN 'name' THEN 0
      WHEN 'price' THEN 1
      WHEN 'status' THEN 2
      WHEN 'description' THEN 3
      ELSE field."pos"
    END
FROM "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'product'
  AND field."internal_key" IN ('name', 'price', 'status', 'description');

UPDATE "sys_module_field_blob" blob
SET "prop" = CASE field."internal_key"
      WHEN 'name' THEN '{"key":"name","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":200}'
      WHEN 'price' THEN '{"key":"price","required":false,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":120}'
      WHEN 'status' THEN '{"key":"status","required":true,"system":true,"hidden":false,"options":[{"label":"上架","value":"1"},{"label":"下架","value":"2"}],"config":{"defaultValue":"1"},"span":12,"showInList":true,"listWidth":100}'
      WHEN 'description' THEN '{"key":"description","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'
      ELSE blob."prop"
    END
FROM "sys_module_field" field
JOIN "sys_module_form" form ON form."id" = field."form_id"
WHERE blob."id" = field."id"
  AND form."form_key" = 'product'
  AND field."internal_key" IN ('name', 'price', 'status', 'description');
