#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2c88c1204a08768aebd1ea09c360f4f4eaf0a4fc1f68daf4c3e73474faf6f68c/contract';
import startContract from '../../snapshots/2c88c1204a08768aebd1ea09c360f4f4eaf0a4fc1f68daf4c3e73474faf6f68c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/64049bfca7242c507d98c1aee2ef571b04780557fe299dff6b72299f54f0b105/contract';
import endContract from '../../snapshots/64049bfca7242c507d98c1aee2ef571b04780557fe299dff6b72299f54f0b105/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'legacy-module-metadata.cleanup',
        label: 'Remove metadata for retired CRM modules',
        operationClass: 'data',
        target: {
          id: 'public.sys_module_form',
          details: { schema: 'public', objectType: 'table', name: 'sys_module_form' },
        },
        precheck: [],
        execute: [
          {
            description: 'Delete saved views and conditions for retired resources',
            sql: `
DELETE FROM "public"."sys_user_view_condition"
WHERE "sys_user_view_id" IN (
  SELECT "id" FROM "public"."sys_user_view"
  WHERE upper("resource_type") IN (
    'CUSTOMER_CONTACT', 'CONTACT', 'OPPORTUNITY', 'OPPORTUNITY_QUOTATION',
    'QUOTE', 'QUOTATION', 'CONTRACT', 'CONTRACT_PAYMENT_PLAN',
    'CONTRACT_PAYMENT_RECORD', 'CONTRACT_INVOICE', 'INVOICE', 'BUSINESS_TITLE',
    'PRODUCT', 'PRODUCT_PRICE', 'ORDER', 'SALES_ORDER', 'BIDDING', 'APPROVAL'
  )
);
DELETE FROM "public"."sys_user_view"
WHERE upper("resource_type") IN (
  'CUSTOMER_CONTACT', 'CONTACT', 'OPPORTUNITY', 'OPPORTUNITY_QUOTATION',
  'QUOTE', 'QUOTATION', 'CONTRACT', 'CONTRACT_PAYMENT_PLAN',
  'CONTRACT_PAYMENT_RECORD', 'CONTRACT_INVOICE', 'INVOICE', 'BUSINESS_TITLE',
  'PRODUCT', 'PRODUCT_PRICE', 'ORDER', 'SALES_ORDER', 'BIDDING', 'APPROVAL'
);`.trim(),
          },
          {
            description: 'Delete retired module form metadata and cascading field definitions',
            sql: `
DELETE FROM "public"."sys_module_form"
WHERE lower("form_key") IN (
  'contact', 'customercontact', 'customer_contact',
  'opportunity', 'opportunityquotation', 'opportunity_quotation',
  'product', 'productprice', 'product_price',
  'quote', 'quotation', 'contract', 'contractpaymentplan', 'contract_payment_plan',
  'contractpaymentrecord', 'contract_payment_record', 'contractinvoice', 'contract_invoice',
  'invoice', 'businesstitle', 'business_title', 'order', 'salesorder', 'sales_order',
  'bidding', 'approval'
);`.trim(),
          },
          {
            description: 'Remove unsupported retired-module data-source selectors while preserving other field configuration',
            sql: `
UPDATE "public"."sys_module_field_blob"
SET "prop" = ("prop"::jsonb #- '{config,dataSourceType}')::text
WHERE "prop" IS NOT NULL
  AND CASE
    WHEN pg_input_is_valid("prop", 'jsonb') THEN
      jsonb_typeof("prop"::jsonb -> 'config') = 'object'
      AND upper(COALESCE("prop"::jsonb #>> '{config,dataSourceType}', '')) IN (
        'CONTACT', 'CUSTOMER_CONTACT', 'OPPORTUNITY', 'OPPORTUNITY_QUOTATION',
        'PRODUCT', 'PRODUCT_PRICE', 'QUOTE', 'QUOTATION', 'CONTRACT',
        'CONTRACT_PAYMENT_PLAN', 'CONTRACT_PAYMENT_RECORD', 'CONTRACT_INVOICE',
        'INVOICE', 'BUSINESS_TITLE', 'ORDER', 'SALES_ORDER', 'BIDDING', 'APPROVAL'
      )
    ELSE FALSE
  END;`.trim(),
          },
          {
            description: 'Remove form-link sources and scenarios that reference retired modules',
            sql: `
UPDATE "public"."sys_module_form_blob" AS blob
SET "prop" = jsonb_set(
  blob."prop"::jsonb,
  '{linkProp}',
  COALESCE((
    SELECT jsonb_object_agg(
      source_key,
      CASE
        WHEN jsonb_typeof(source_scenarios) = 'array' THEN COALESCE((
          SELECT jsonb_agg(scenario.item ORDER BY scenario.ordinality)
          FROM jsonb_array_elements(source_scenarios) WITH ORDINALITY AS scenario(item, ordinality)
          WHERE upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%CONTACT%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%OPPORTUNITY%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%PRODUCT%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%CONTRACT%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%QUOTATION%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%INVOICE%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%BUSINESS_TITLE%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%SALES_ORDER%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%BIDDING%'
            AND upper(COALESCE(scenario.item ->> 'key', '')) NOT LIKE '%APPROVAL%'
        ), '[]'::jsonb)
        ELSE source_scenarios
      END
    )
    FROM jsonb_each(
      CASE
        WHEN jsonb_typeof(blob."prop"::jsonb -> 'linkProp') = 'object'
          THEN blob."prop"::jsonb -> 'linkProp'
        ELSE '{}'::jsonb
      END
    ) AS source(source_key, source_scenarios)
    WHERE lower(source_key) NOT IN (
      'contact', 'customercontact', 'customer_contact',
      'opportunity', 'opportunityquotation', 'opportunity_quotation',
      'product', 'productprice', 'product_price', 'quote', 'quotation',
      'contract', 'contractpaymentplan', 'contract_payment_plan',
      'contractpaymentrecord', 'contract_payment_record', 'contractinvoice',
      'contract_invoice', 'invoice', 'businesstitle', 'business_title',
      'order', 'salesorder', 'sales_order', 'bidding', 'approval'
    )
  ), '{}'::jsonb),
  false
)::text
WHERE blob."prop" IS NOT NULL
  AND CASE
    WHEN pg_input_is_valid(blob."prop", 'jsonb') THEN
      jsonb_typeof(blob."prop"::jsonb -> 'linkProp') = 'object'
      AND (
        blob."prop"::jsonb::text ILIKE ANY (ARRAY[
          '%contact%', '%opportunity%', '%product%', '%contract%', '%quotation%',
          '%invoice%', '%business_title%', '%sales_order%', '%bidding%', '%approval%'
        ])
      )
    ELSE FALSE
  END;`.trim(),
          },
          {
            description: 'Delete retired business dictionaries and stage-transition rules',
            sql: `
DELETE FROM "public"."sys_dict_config"
WHERE upper("module") IN (
  'OPPORTUNITY_FAIL_RS', 'OPPORTUNITY', 'OPPORTUNITY_STAGE', 'CONTRACT_STAGE',
  'CONTRACT', 'PRODUCT', 'PRODUCT_PRICE', 'BUSINESS_TITLE', 'BIDDING',
  'QUOTE', 'QUOTATION', 'INVOICE', 'ORDER'
);
DELETE FROM "public"."sys_dict"
WHERE upper("module") IN (
  'OPPORTUNITY_FAIL_RS', 'OPPORTUNITY', 'OPPORTUNITY_STAGE', 'CONTRACT_STAGE',
  'CONTRACT', 'PRODUCT', 'PRODUCT_PRICE', 'BUSINESS_TITLE', 'BIDDING',
  'QUOTE', 'QUOTATION', 'INVOICE', 'ORDER'
);
DELETE FROM "public"."stage_advanced_config"
WHERE upper("module_type") IN ('OPPORTUNITY', 'CONTRACT', 'QUOTE', 'ORDER', 'PRODUCT');`.trim(),
          },
          {
            description: 'Delete stale navigation configuration rows before enforcing supported keys',
            sql: `
DELETE FROM "public"."module_configs"
WHERE lower("key") NOT IN ('home', 'lead', 'customer', 'system');
DELETE FROM "public"."top_navigation_configs"
WHERE lower("key") NOT IN ('event', 'notify');`.trim(),
          },
          {
            description: 'Remove permissions for retired business modules from existing roles',
            sql: `
UPDATE "public"."roles" AS role_row
SET "permissions" = ARRAY(
  SELECT entry.permission
  FROM unnest(role_row."permissions") WITH ORDINALITY AS entry(permission, ordinality)
  WHERE lower(entry.permission) !~ '^(contact|customer_contact|opportunity|opportunity_quotation|product|price|quote|quotation|contract|contract_payment_plan|contractpaymentplan|contract_payment_record|contractpaymentrecord|contract_invoice|contractinvoice|contract_business_title|business_title|invoice|order|sales_order|bidding|approval):'
    AND lower(entry.permission) NOT IN (
      'menu:contact', 'menu:contacts', 'menu:customer-contact', 'menu:about', 'menu:help', 'menu:api-docs',
      'menu:opportunity', 'menu:opportunityquotation', 'menu:opportunity-stage',
      'menu:product', 'menu:quote', 'menu:quotation', 'menu:contract',
      'menu:invoice', 'menu:order', 'menu:sales-order', 'menu:bidding',
      'menu:approval', 'menu:business-title', 'menu:contract-payment-plan',
      'menu:contract-payment-record', 'menu:contract-invoice'
    )
  ORDER BY entry.ordinality
)
WHERE role_row."permissions" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(role_row."permissions") AS entry(permission)
    WHERE lower(entry.permission) ~ '^(contact|customer_contact|opportunity|opportunity_quotation|product|price|quote|quotation|contract|contract_payment_plan|contractpaymentplan|contract_payment_record|contractpaymentrecord|contract_invoice|contractinvoice|contract_business_title|business_title|invoice|order|sales_order|bidding|approval):'
       OR lower(entry.permission) IN (
         'menu:contact', 'menu:contacts', 'menu:customer-contact', 'menu:about', 'menu:help', 'menu:api-docs',
         'menu:opportunity', 'menu:opportunityquotation', 'menu:opportunity-stage',
         'menu:product', 'menu:quote', 'menu:quotation', 'menu:contract',
         'menu:invoice', 'menu:order', 'menu:sales-order', 'menu:bidding',
         'menu:approval', 'menu:business-title', 'menu:contract-payment-plan',
         'menu:contract-payment-record', 'menu:contract-invoice'
       )
  );`.trim(),
          },
          {
            description: 'Delete obsolete notification settings and retire pending exports for removed modules',
            sql: `
DELETE FROM "public"."message_task_settings"
WHERE upper("module") NOT IN ('CLUE', 'CUSTOMER')
   OR upper("event") LIKE ANY (ARRAY[
     '%CONTACT%', '%OPPORTUNITY%', '%PRODUCT%', '%CONTRACT%', '%QUOTATION%',
     '%QUOTE%', '%INVOICE%', '%PAYMENT_PLAN%', '%PAYMENT_RECORD%',
     '%BUSINESS_TITLE%', '%BIDDING%', '%APPROVAL%', '%SALES_ORDER%'
   ])
   OR upper("event") IN ('CUSTOMER_CONCAT_ADD', 'CLUE_CONVERT_BUSINESS');
UPDATE "public"."export_tasks"
SET "status" = 'FAILED',
    "errorMessage" = '模块已移除，任务不再支持执行',
    "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP)
WHERE lower("module") IN (
  'contact', 'customer_contact', 'opportunity', 'product', 'price', 'quote',
  'quotation', 'contract', 'invoice', 'order', 'sales_order', 'bidding', 'approval'
)
  AND upper("status") IN ('PENDING', 'PROCESSING', 'RUNNING');`.trim(),
          },
        ],
        postcheck: [],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'module_configs',
        constraint: 'module_configs_supported_key_f71567dc',
        expression: "\"key\" IN ('home', 'lead', 'customer', 'system')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'top_navigation_configs',
        constraint: 'top_navigation_configs_supported_key_5e82199f',
        expression: "\"key\" IN ('event', 'notify')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
