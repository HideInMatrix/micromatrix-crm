-- W3.6.1 forward-only metadata completion.
--
-- Existing tenants may already own Product/Price forms, so code-level
-- MODULE_SYSTEM_FIELDS only fills missing fields when the form is next read.
-- This migration makes migrate deploy alone sufficient: Product gets the
-- Cordys productPic PICTURE field and Price gets the canonical SUB_PRODUCT
-- cells with required product/amount semantics.

WITH canonical(form_key, internal_key, name, type, pos, prop) AS (
  VALUES
    (
      'product', 'productPic', '产品图片', 'picture', 4,
      '{"key":"productPic","required":false,"system":false,"hidden":false,"options":null,"config":{"pictureShowType":"card","uploadLimit":10,"uploadSizeLimit":20},"span":24,"showInList":false,"listWidth":null}'
    ),
    (
      'price', 'products', '产品信息', 'textarea', 2,
      '{"key":"products","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'
    ),
    (
      'price', 'product', '产品', 'text', 3,
      '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'
    ),
    (
      'price', 'amount', '产品定价', 'currency', 4,
      '{"key":"amount","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'
    ),
    (
      'price', 'priceProductSku', '产品SKU', 'text', 5,
      '{"key":"priceProductSku","required":false,"system":false,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'
    ),
    (
      'price', 'priceProductTax', '税点', 'percent', 6,
      '{"key":"priceProductTax","required":false,"system":false,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'
    )
)
INSERT INTO "sys_module_field" (
  "id", "form_id", "internal_key", "name", "type", "mobile", "pos",
  "create_user", "create_time", "update_user", "update_time"
)
SELECT
  md5(form."id" || ':' || canonical.internal_key),
  form."id",
  canonical.internal_key,
  canonical.name,
  canonical.type,
  false,
  canonical.pos,
  form."create_user",
  form."create_time",
  form."update_user",
  form."update_time"
FROM "sys_module_form" form
JOIN canonical ON canonical.form_key = form."form_key"
WHERE NOT EXISTS (
  SELECT 1
  FROM "sys_module_field" existing
  WHERE existing."form_id" = form."id"
    AND existing."internal_key" = canonical.internal_key
);

WITH canonical(form_key, internal_key, name, type, pos, prop) AS (
  VALUES
    ('product', 'productPic', '产品图片', 'picture', 4, '{"key":"productPic","required":false,"system":false,"hidden":false,"options":null,"config":{"pictureShowType":"card","uploadLimit":10,"uploadSizeLimit":20},"span":24,"showInList":false,"listWidth":null}'),
    ('price', 'products', '产品信息', 'textarea', 2, '{"key":"products","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'product', '产品', 'text', 3, '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'amount', '产品定价', 'currency', 4, '{"key":"amount","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'priceProductSku', '产品SKU', 'text', 5, '{"key":"priceProductSku","required":false,"system":false,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'priceProductTax', '税点', 'percent', 6, '{"key":"priceProductTax","required":false,"system":false,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}')
)
UPDATE "sys_module_field" field
SET "name" = canonical.name,
    "type" = canonical.type,
    "pos" = canonical.pos
FROM "sys_module_form" form, canonical
WHERE field."form_id" = form."id"
  AND form."form_key" = canonical.form_key
  AND field."internal_key" = canonical.internal_key;

WITH canonical(form_key, internal_key, prop) AS (
  VALUES
    ('product', 'productPic', '{"key":"productPic","required":false,"system":false,"hidden":false,"options":null,"config":{"pictureShowType":"card","uploadLimit":10,"uploadSizeLimit":20},"span":24,"showInList":false,"listWidth":null}'),
    ('price', 'products', '{"key":"products","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'product', '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'amount', '{"key":"amount","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'priceProductSku', '{"key":"priceProductSku","required":false,"system":false,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'),
    ('price', 'priceProductTax', '{"key":"priceProductTax","required":false,"system":false,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}')
)
INSERT INTO "sys_module_field_blob" ("id", "prop")
SELECT field."id", canonical.prop
FROM "sys_module_field" field
JOIN "sys_module_form" form ON form."id" = field."form_id"
JOIN canonical ON canonical.form_key = form."form_key" AND canonical.internal_key = field."internal_key"
ON CONFLICT ("id") DO UPDATE SET "prop" = EXCLUDED."prop";
