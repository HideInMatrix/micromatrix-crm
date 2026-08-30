-- W3.6.5: complete the Cordys order default form after the direct-table cutover.
-- The main direct fields were normalized by the previous migration; this
-- forward repair adds the SUB_PRODUCT field topology and receiving fields to
-- already-upgraded databases without rewriting the applied migration.

UPDATE "sys_module_field" field
SET "type" = 'formula', "name" = '订单金额', "update_time" = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'order'
  AND field."internal_key" = 'amount';

WITH templates(internal_key, name, type, pos, mobile) AS (
  VALUES
    ('orderProducts', '产品明细', 'textarea', 6::bigint, true),
    ('orderProduct', '产品名称', 'text', 7::bigint, true),
    ('orderProductPrice', '产品单价', 'currency', 8::bigint, true),
    ('orderProductNumber', '数量', 'number', 9::bigint, true),
    ('orderProductAmount', '金额', 'formula', 10::bigint, true),
    ('orderDeliveryAddress', '收货地址', 'text', 11::bigint, false),
    ('orderConsignee', '收货人', 'text', 12::bigint, true),
    ('orderPhone', '收货人联系方式', 'phone', 13::bigint, true)
)
INSERT INTO "sys_module_field" (
  "id", "form_id", "internal_key", "name", "type", "mobile", "pos",
  "create_user", "create_time", "update_user", "update_time"
)
SELECT
  md5(form."id" || ':order:' || t.internal_key),
  form."id",
  t.internal_key,
  t.name,
  t.type,
  t.mobile,
  t.pos,
  form."create_user",
  form."create_time",
  form."update_user",
  (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form
CROSS JOIN templates t
WHERE form."form_key" = 'order'
  AND NOT EXISTS (
    SELECT 1 FROM "sys_module_field" existing
    WHERE existing."form_id" = form."id" AND existing."internal_key" = t.internal_key
  );

WITH templates(internal_key, prop) AS (
  VALUES
    ('amount', '{"key":"amount","required":true,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":140}'::text),
    ('orderProducts', '{"key":"orderProducts","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'::text),
    ('orderProduct', '{"key":"orderProduct","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('orderProductPrice', '{"key":"orderProductPrice","required":false,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('orderProductNumber', '{"key":"orderProductNumber","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('orderProductAmount', '{"key":"orderProductAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"formula":"orderProductPrice * orderProductNumber","precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('orderDeliveryAddress', '{"key":"orderDeliveryAddress","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'::text),
    ('orderConsignee', '{"key":"orderConsignee","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('orderPhone', '{"key":"orderPhone","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text)
)
INSERT INTO "sys_module_field_blob" ("id", "prop")
SELECT field."id", t.prop
FROM "sys_module_form" form
JOIN "sys_module_field" field ON field."form_id" = form."id"
JOIN templates t ON t.internal_key = field."internal_key"
WHERE form."form_key" = 'order'
ON CONFLICT ("id") DO UPDATE SET "prop" = EXCLUDED."prop";
