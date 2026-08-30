-- W3.6.5: normalize order form positions for databases upgraded from the
-- legacy four-field order form. Existing rows may retain their old pos even
-- after the direct fields are renamed, so pin the Cordys order order here.

WITH positions(internal_key, pos) AS (
  VALUES
    ('name', 0::bigint),
    ('number', 1::bigint),
    ('customerId', 2::bigint),
    ('contractId', 3::bigint),
    ('owner', 4::bigint),
    ('amount', 5::bigint),
    ('orderProducts', 6::bigint),
    ('orderProduct', 7::bigint),
    ('orderProductPrice', 8::bigint),
    ('orderProductNumber', 9::bigint),
    ('orderProductAmount', 10::bigint),
    ('orderDeliveryAddress', 11::bigint),
    ('orderConsignee', 12::bigint),
    ('orderPhone', 13::bigint)
)
UPDATE "sys_module_field" field
SET "pos" = positions.pos,
    "update_time" = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form, positions
WHERE field."form_id" = form."id"
  AND form."form_key" = 'order'
  AND field."internal_key" = positions.internal_key;
