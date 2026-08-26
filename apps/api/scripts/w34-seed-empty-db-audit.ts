import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const TARGET_TABLES = [
  'customer',
  'customer_field',
  'customer_field_blob',
  'customer_owner',
  'customer_contact',
  'customer_contact_field',
  'customer_contact_field_blob',
  'customer_collaboration',
  'customer_relation',
  'customer_pool',
  'customer_pool_hidden_field',
  'customer_pool_pick_rule',
  'customer_pool_recycle_rule',
  'customer_capacity',
  'clue',
  'clue_field',
  'clue_field_blob',
  'clue_owner',
  'clue_pool',
  'clue_pool_hidden_field',
  'clue_pool_pick_rule',
  'clue_pool_recycle_rule',
  'clue_capacity',
  'sys_module_form',
  'sys_module_form_blob',
  'sys_module_field',
  'sys_module_field_blob',
  'sys_user_view',
  'sys_user_view_condition',
  'dashboard_module',
  'dashboard',
  'dashboard_collection',
] as const

const OLD_TABLES = [
  'contacts',
  'customer_relations',
  'customer_team_members',
  'customers',
  'field_definitions',
  'leads',
  'pool_rules',
  'resource_capacities',
  'resource_owner_histories',
  'resource_pool_pick_rules',
  'resource_pool_recycle_rules',
  'resource_pools',
  'saved_view_conditions',
  'saved_views',
] as const

const CRITICAL_INDEXES = [
  'customer_organization_id_idx',
  'customer_pool_id_idx',
  'customer_field_resource_id_field_id_key',
  'customer_contact_organization_id_idx',
  'customer_contact_field_resource_id_field_id_key',
  'customer_collaboration_customer_id_user_id_key',
  'customer_relation_source_customer_id_target_customer_id_key',
  'customer_pool_organization_id_idx',
  'customer_capacity_organization_id_idx',
  'clue_organization_id_idx',
  'clue_pool_id_idx',
  'clue_field_resource_id_field_id_key',
  'clue_pool_organization_id_idx',
  'clue_capacity_organization_id_idx',
  'sys_module_form_organization_id_form_key_key',
  'sys_module_field_form_id_internal_key_idx',
  'sys_user_view_organization_id_user_id_resource_type_name_key',
  'sys_user_view_condition_sys_user_view_id_idx',
  'dashboard_module_organization_id_idx',
  'dashboard_module_parent_id_idx',
  'dashboard_dashboard_module_id_idx',
  'dashboard_organization_id_idx',
  'dashboard_collection_user_id_dashboard_id_key',
] as const

const REQUIRED_FORM_KEYS = ['lead', 'customer', 'contact'] as const
const REQUIRED_VIEW_TYPES = [
  'CLUE',
  'CLUE_POOL',
  'CUSTOMER',
  'CUSTOMER_CONTACT',
  'CUSTOMER_POOL',
] as const

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const tableRows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [...TARGET_TABLES, ...OLD_TABLES],
  )
  const existingTables = new Set(tableRows.map((row) => row.table_name))

  const indexRows = await prisma.$queryRawUnsafe<Array<{ tablename: string; indexname: string }>>(
    `SELECT tablename, indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY tablename, indexname`,
    [...TARGET_TABLES],
  )
  const existingIndexes = new Set(indexRows.map((row) => row.indexname))

  const missingTargetTables = TARGET_TABLES.filter((table) => !existingTables.has(table))
  const remainingOldTables = OLD_TABLES.filter((table) => existingTables.has(table))
  const missingCriticalIndexes = CRITICAL_INDEXES.filter((index) => !existingIndexes.has(index))

  const [forms, userViews, cluePools, customerPools, convertedClues, dashboardRows] =
    await Promise.all([
      prisma.sysModuleForm.findMany({ select: { formKey: true } }),
      prisma.sysUserView.findMany({ select: { resourceType: true } }),
      prisma.cluePool.findMany({ select: { scopeId: true, ownerId: true } }),
      prisma.customerPool.findMany({ select: { scopeId: true, ownerId: true } }),
      prisma.clue.findMany({
        where: { transitionType: 'CUSTOMER', transitionId: { not: null } },
        select: { transitionId: true },
      }),
      prisma.dashboard.findMany({ select: { scopeId: true } }),
    ])
  const formKeys = new Set(forms.map((form) => form.formKey))
  const userViewTypes = new Set(userViews.map((view) => view.resourceType))
  const convertedCustomerIds = convertedClues
    .map((clue) => clue.transitionId)
    .filter((id): id is string => Boolean(id))
  const convertedTargetCount = convertedCustomerIds.length
    ? await prisma.customer.count({ where: { id: { in: convertedCustomerIds } } })
    : 0

  const parseNonEmptyStringArray = (value: string) => {
    try {
      const parsed: unknown = JSON.parse(value)
      return (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((item) => typeof item === 'string' && item.length > 0)
      )
    } catch {
      return false
    }
  }
  const validPoolScopes = [...cluePools, ...customerPools].every(
    (pool) => parseNonEmptyStringArray(pool.scopeId) && parseNonEmptyStringArray(pool.ownerId),
  )
  const validDashboardScopes = dashboardRows.every((row) => parseNonEmptyStringArray(row.scopeId))

  const seedCounts = {
    moduleForms: await prisma.sysModuleForm.count(),
    moduleFields: await prisma.sysModuleField.count(),
    userViews: await prisma.sysUserView.count(),
    userViewConditions: await prisma.sysUserViewCondition.count(),
    cluePools: await prisma.cluePool.count(),
    customerPools: await prisma.customerPool.count(),
    clueCapacities: await prisma.clueCapacity.count(),
    customerCapacities: await prisma.customerCapacity.count(),
    clues: await prisma.clue.count(),
    customers: await prisma.customer.count(),
    contacts: await prisma.customerContact.count(),
    clueFieldValues: await prisma.clueField.count(),
    clueFieldBlobValues: await prisma.clueFieldBlob.count(),
    customerFieldValues: await prisma.customerField.count(),
    customerFieldBlobValues: await prisma.customerFieldBlob.count(),
    contactFieldValues: await prisma.customerContactField.count(),
    contactFieldBlobValues: await prisma.customerContactFieldBlob.count(),
    clueHiddenFields: await prisma.cluePoolHiddenField.count(),
    customerHiddenFields: await prisma.customerPoolHiddenField.count(),
    cluePickRules: await prisma.cluePoolPickRule.count(),
    clueRecycleRules: await prisma.cluePoolRecycleRule.count(),
    customerPickRules: await prisma.customerPoolPickRule.count(),
    customerRecycleRules: await prisma.customerPoolRecycleRule.count(),
    clueOwnerHistory: await prisma.clueOwner.count(),
    customerOwnerHistory: await prisma.customerOwner.count(),
    customerCollaborations: await prisma.customerCollaboration.count(),
    customerRelations: await prisma.customerRelation.count(),
    convertedClues: convertedClues.length,
    convertedTargets: convertedTargetCount,
    dashboardModules: await prisma.dashboardModule.count(),
    dashboards: await prisma.dashboard.count(),
    dashboardCollections: await prisma.dashboardCollection.count(),
  }

  const assertions = {
    targetTables: missingTargetTables.length === 0 && TARGET_TABLES.length === 32,
    oldTablesRemoved: remainingOldTables.length === 0,
    targetIndexes: missingCriticalIndexes.length === 0,
    formsAndFields:
      REQUIRED_FORM_KEYS.every((key) => formKeys.has(key)) &&
      seedCounts.moduleForms >= REQUIRED_FORM_KEYS.length &&
      seedCounts.moduleFields >= 20,
    fiveUserViewTypes:
      REQUIRED_VIEW_TYPES.every((type) => userViewTypes.has(type)) &&
      seedCounts.userViews >= REQUIRED_VIEW_TYPES.length &&
      seedCounts.userViewConditions >= 3,
    multiplePools:
      seedCounts.cluePools >= 2 &&
      seedCounts.customerPools >= 2 &&
      seedCounts.clueHiddenFields >= 1 &&
      seedCounts.customerHiddenFields >= 1 &&
      seedCounts.cluePickRules >= seedCounts.cluePools &&
      seedCounts.clueRecycleRules >= seedCounts.cluePools &&
      seedCounts.customerPickRules >= seedCounts.customerPools &&
      seedCounts.customerRecycleRules >= seedCounts.customerPools &&
      validPoolScopes,
    capacities: seedCounts.clueCapacities >= 2 && seedCounts.customerCapacities >= 2,
    businessSamples: seedCounts.clues >= 3 && seedCounts.customers >= 6 && seedCounts.contacts >= 1,
    dynamicFieldValues:
      seedCounts.clueFieldValues >= 2 &&
      seedCounts.clueFieldBlobValues >= 1 &&
      seedCounts.customerFieldValues >= 1 &&
      seedCounts.customerFieldBlobValues >= 1 &&
      seedCounts.contactFieldValues >= 1 &&
      seedCounts.contactFieldBlobValues >= 1,
    ownershipAndRelations:
      seedCounts.clueOwnerHistory >= 1 &&
      seedCounts.customerOwnerHistory >= 1 &&
      seedCounts.customerCollaborations >= 1 &&
      seedCounts.customerRelations >= 1 &&
      seedCounts.convertedClues >= 1 &&
      seedCounts.convertedTargets === seedCounts.convertedClues,
    dashboardSamples:
      seedCounts.dashboardModules >= 1 &&
      seedCounts.dashboards >= 1 &&
      seedCounts.dashboardCollections >= 1 &&
      validDashboardScopes,
  }

  console.log(
    JSON.stringify(
      {
        targetTables: {
          expected: TARGET_TABLES.length,
          existing: TARGET_TABLES.length - missingTargetTables.length,
          missing: missingTargetTables,
        },
        oldTables: { expectedAbsent: OLD_TABLES.length, remaining: remainingOldTables },
        indexes: {
          expectedCritical: CRITICAL_INDEXES.length,
          existingCritical: CRITICAL_INDEXES.length - missingCriticalIndexes.length,
          missing: missingCriticalIndexes,
        },
        formKeys: [...formKeys].sort(),
        userViewTypes: [...userViewTypes].sort(),
        seedCounts,
        assertions,
      },
      null,
      2,
    ),
  )

  const failed = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failed.length) throw new Error(`W3.4 task 1.8 audit failed: ${failed.join(', ')}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
