import { Temporal } from '@js-temporal/polyfill'
import { not } from '@prisma/orm-postgres/orm-client'
import contractJson from '../prisma/generated/contract.json'
import { createPrisma8Client, type Prisma8Client } from '../prisma/prisma8-client'
import { prisma8Now, prisma8TimestampFromDate, prisma8TimestampToDate } from '../prisma/prisma8-temporal'
import { prisma8Id32 } from '../prisma/prisma8-varchar'
import { PRISMA_FIXTURE_MODELS, type PrismaFixtureModelName } from './prisma-fixture-metadata'

type AnyRecord = Record<string, any>
type ModelMeta = (typeof PRISMA_FIXTURE_MODELS)[PrismaFixtureModelName]

export interface PrismaFixtureDelegate {
  create(args: AnyRecord): Promise<any>
  createMany(args: AnyRecord): Promise<{ count: number }>
  findMany(args?: AnyRecord): Promise<any[]>
  findFirst(args?: AnyRecord): Promise<any | null>
  findFirstOrThrow(args?: AnyRecord): Promise<any>
  findUnique(args?: AnyRecord): Promise<any | null>
  findUniqueOrThrow(args?: AnyRecord): Promise<any>
  count(args?: AnyRecord): Promise<number>
  update(args: AnyRecord): Promise<any>
  updateMany(args: AnyRecord): Promise<{ count: number }>
  delete(args: AnyRecord): Promise<any>
  deleteMany(args?: AnyRecord): Promise<{ count: number }>
}

export type PrismaFixtureClient = {
  [K in PrismaFixtureModelName]: PrismaFixtureDelegate
} & {
  $connect(): Promise<void>
  $disconnect(): Promise<void>
}

const domainModels = (contractJson as any).domain.namespaces.public.models as Record<string, any>
const clientDefaults = new Set<string>(
  ((contractJson as any).execution?.mutations?.defaults ?? []).map(
    (item: any) => item.ref?.table + '.' + item.ref?.column,
  ),
)

function modelMeta(name: string): ModelMeta {
  const meta = (PRISMA_FIXTURE_MODELS as AnyRecord)[name] as ModelMeta | undefined
  if (!meta) throw new Error('Unknown Prisma fixture model: ' + name)
  return meta
}

function domainMeta(meta: ModelMeta): AnyRecord {
  return domainModels[meta.model]
}

function reverseFields(meta: ModelMeta): Record<string, string> {
  return Object.fromEntries(Object.entries(meta.fields).map(([legacy, prisma]) => [prisma, legacy]))
}

function fieldInfo(meta: ModelMeta, legacyField: string) {
  const prismaField = (meta.fields as AnyRecord)[legacyField] ?? legacyField
  return {
    prismaField,
    info: domainMeta(meta).fields?.[prismaField],
  }
}

function encodeScalar(meta: ModelMeta, legacyField: string, value: any): any {
  if (value === undefined || value === null) return value
  const { info } = fieldInfo(meta, legacyField)
  const codec = info?.type?.codecId as string | undefined
  if (value instanceof Date && codec === 'pg/timestamp-temporal@1') {
    return prisma8TimestampFromDate(value)
  }
  if (codec === 'pg/numeric@1' && typeof value === 'number') return String(value)
  if (codec === 'pg/int8@1' && typeof value === 'number') return BigInt(Math.trunc(value))
  if (Array.isArray(value)) return value.map((item) => encodeScalar(meta, legacyField, item))
  return value
}

function decodeScalar(value: any): any {
  if (value instanceof Temporal.PlainDateTime) return prisma8TimestampToDate(value)
  if (Array.isArray(value)) return value.map(decodeScalar)
  return value
}

function normalizeData(meta: ModelMeta, input: AnyRecord, mode: 'create' | 'update'): AnyRecord {
  const result: AnyRecord = {}
  for (const [legacyField, value] of Object.entries(input ?? {})) {
    if (value === undefined) continue
    const prismaField = (meta.fields as AnyRecord)[legacyField]
    if (!prismaField) {
      // These tests do not use Prisma nested writes. Fail loudly if one appears.
      if ((meta.relations as AnyRecord)[legacyField]) {
        throw new Error('Nested relation write is not supported by Prisma fixture: ' + legacyField)
      }
      result[legacyField] = value
      continue
    }
    result[prismaField] = encodeScalar(meta, legacyField, value)
  }

  const model = domainMeta(meta)
  if (mode === 'create' && model.fields?.id && result.id === undefined) {
    const idCodec = model.fields.id.type?.codecId
    const idLength = model.fields.id.type?.typeParams?.length
    const idColumn = model.storage?.fields?.id?.column ?? 'id'
    if (!clientDefaults.has(meta.table + '.' + idColumn) && idCodec === 'sql/varchar@1' && idLength === 32) {
      result.id = prisma8Id32()
    }
  }
  if (model.fields?.updatedAt && result.updatedAt === undefined) result.updatedAt = prisma8Now()
  return result
}

function decodeRow(meta: ModelMeta, row: any): any {
  if (row == null) return row
  const reverse = reverseFields(meta)
  const out: AnyRecord = {}
  for (const [key, value] of Object.entries(row)) {
    const legacyKey = reverse[key] ?? key
    out[legacyKey] = decodeScalar(value)
  }
  return out
}

function scalarExpression(field: any, op: string, value: any) {
  if (op === 'eq' || op === 'equals') return value === null ? field.isNull() : field.eq(value)
  if (op === 'ne') return value === null ? field.isNotNull() : field.neq(value)
  if (op === 'in') return field.in(value)
  if (op === 'notIn') return not(field.in(value))
  if (op === 'gt') return field.gt(value)
  if (op === 'gte') return field.gte(value)
  if (op === 'lt') return field.lt(value)
  if (op === 'lte') return field.lte(value)
  if (op === 'contains') return field.ilike('%' + value + '%')
  if (op === 'startsWith') return field.ilike(value + '%')
  if (op === 'endsWith') return field.ilike('%' + value)
  throw new Error('Unsupported Prisma fixture filter operator: ' + op)
}

async function applyWhere(
  client: Prisma8Client,
  legacyModel: string,
  collection: any,
  where: AnyRecord | undefined,
): Promise<any> {
  if (!where || !Object.keys(where).length) return collection
  const meta = modelMeta(legacyModel)

  for (const [key, raw] of Object.entries(where)) {
    if (key === 'AND') {
      const parts = Array.isArray(raw) ? raw : [raw]
      for (const part of parts) collection = await applyWhere(client, legacyModel, collection, part as AnyRecord)
      continue
    }
    if (key === 'OR') {
      const parts = Array.isArray(raw) ? raw : [raw]
      const ids = new Set<any>()
      for (const part of parts) {
        for (const id of await matchingIds(client, legacyModel, part as AnyRecord)) ids.add(id)
      }
      if (!ids.size) return collection.where((row: any) => row.id.eq('__fixture_no_match__'))
      collection = collection.where((row: any) => row.id.in([...ids]))
      continue
    }
    if (key === 'NOT') {
      const parts = Array.isArray(raw) ? raw : [raw]
      for (const part of parts) {
        const ids = await matchingIds(client, legacyModel, part as AnyRecord)
        if (ids.length) collection = collection.where((row: any) => not(row.id.in(ids)))
      }
      continue
    }

    const prismaField = (meta.fields as AnyRecord)[key]
    if (prismaField) {
      const encoded = encodeScalar(meta, key, raw)
      if (raw === null || typeof raw !== 'object' || raw instanceof Date || Array.isArray(raw)) {
        collection = collection.where((row: any) => scalarExpression(row[prismaField], 'eq', encoded))
        continue
      }
      for (const [op, opValue] of Object.entries(raw as AnyRecord)) {
        if (op === 'mode') continue
        if (op === 'not') {
          const enc = encodeScalar(meta, key, opValue)
          collection = collection.where((row: any) => scalarExpression(row[prismaField], 'ne', enc))
          continue
        }
        const enc = encodeScalar(meta, key, opValue)
        collection = collection.where((row: any) => scalarExpression(row[prismaField], op, enc))
      }
      continue
    }

    const relation = (meta.relations as AnyRecord)[key]
    if (relation) {
      collection = await applyRelationWhere(client, legacyModel, collection, relation, raw as AnyRecord)
      continue
    }

    // Prisma compound unique aliases are objects whose values are scalar field filters.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const nestedKeys = Object.keys(raw)
      if (nestedKeys.every((candidate) => (meta.fields as AnyRecord)[candidate])) {
        collection = await applyWhere(client, legacyModel, collection, raw as AnyRecord)
        continue
      }
    }

    throw new Error('Unsupported Prisma fixture where key: ' + legacyModel + '.' + key)
  }
  return collection
}

async function matchingIds(client: Prisma8Client, legacyModel: string, where: AnyRecord): Promise<any[]> {
  const meta = modelMeta(legacyModel)
  if (!(meta.fields as AnyRecord).id) {
    throw new Error('Fixture OR/NOT requires an id field for model ' + legacyModel)
  }
  const model = (client.orm.public as AnyRecord)[meta.model]
  let collection = model.where({})
  collection = await applyWhere(client, legacyModel, collection, where)
  const rows = await collection.select((meta.fields as AnyRecord).id).all()
  return rows.map((row: AnyRecord) => row[(meta.fields as AnyRecord).id])
}

async function applyRelationWhere(
  client: Prisma8Client,
  legacyModel: string,
  collection: any,
  relation: AnyRecord,
  nested: AnyRecord,
): Promise<any> {
  const target = modelMeta(relation.target)
  const targetModel = (client.orm.public as AnyRecord)[target.model]
  let targetCollection = targetModel.where({})
  const relationWhere =
    nested && typeof nested === 'object' && 'is' in nested ? nested.is :
    nested && typeof nested === 'object' && 'some' in nested ? nested.some :
    nested
  targetCollection = await applyWhere(client, relation.target, targetCollection, relationWhere || {})
  const targetFields = relation.targetFields as string[]
  const localFields = relation.localFields as string[]
  if (targetFields.length !== 1 || localFields.length !== 1) {
    throw new Error('Composite relation filter is not supported by Prisma fixture')
  }
  const matched = await targetCollection.select(targetFields[0]).all()
  const values = [...new Set(matched.map((row: AnyRecord) => row[targetFields[0]]).filter((value: any) => value != null))]
  if (!values.length) return collection.where((row: any) => row[localFields[0]].eq('__fixture_no_match__'))
  return collection.where((row: any) => row[localFields[0]].in(values))
}

async function buildCollection(client: Prisma8Client, legacyModel: string, args: AnyRecord = {}) {
  const meta = modelMeta(legacyModel)
  const model = (client.orm.public as AnyRecord)[meta.model]
  let collection = model.where({})
  collection = await applyWhere(client, legacyModel, collection, args.where)

  const orderBy = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : []
  for (const order of orderBy) {
    for (const [legacyField, direction] of Object.entries(order as AnyRecord)) {
      const prismaField = (meta.fields as AnyRecord)[legacyField] ?? legacyField
      collection = collection.orderBy((row: any) =>
        direction === 'desc' ? row[prismaField].desc() : row[prismaField].asc(),
      )
    }
  }
  if (args.skip != null) collection = collection.offset(args.skip)
  if (args.take != null) collection = collection.limit(args.take)

  const selectedLegacy = args.select
    ? Object.entries(args.select).filter(([, enabled]) => enabled).map(([field]) => field)
    : null
  if (selectedLegacy?.length) {
    const scalarFields = selectedLegacy.filter((field) => (meta.fields as AnyRecord)[field])
    if (scalarFields.length) {
      collection = collection.select(...scalarFields.map((field) => (meta.fields as AnyRecord)[field]))
    }
  }
  return { meta, collection, selectedLegacy }
}

async function attachIncludes(
  client: Prisma8Client,
  legacyModel: string,
  decoded: any,
  raw: AnyRecord,
  include: AnyRecord | undefined,
) {
  if (!include || decoded == null) return decoded
  const meta = modelMeta(legacyModel)
  for (const [legacyRelation, enabled] of Object.entries(include)) {
    if (!enabled) continue
    const relation = (meta.relations as AnyRecord)[legacyRelation]
    if (!relation) throw new Error('Unsupported Prisma fixture include: ' + legacyModel + '.' + legacyRelation)
    const target = modelMeta(relation.target)
    if (relation.localFields.length !== 1 || relation.targetFields.length !== 1) {
      throw new Error('Composite include is not supported by Prisma fixture')
    }
    const localValue = raw[relation.localFields[0]]
    const targetModel = (client.orm.public as AnyRecord)[target.model]
    const targetCollection = targetModel.where((row: any) => row[relation.targetFields[0]].eq(localValue))
    const rows = await targetCollection.all()
    if (relation.cardinality === '1:N') {
      decoded[legacyRelation] = rows.map((row: AnyRecord) => decodeRow(target, row))
    } else {
      decoded[legacyRelation] = rows[0] ? decodeRow(target, rows[0]) : null
    }
  }
  return decoded
}

function delegate(getClient: () => Promise<Prisma8Client>, legacyModel: string) {
  return {
    async create(args: AnyRecord) {
      const client = await getClient()
      const meta = modelMeta(legacyModel)
      const model = (client.orm.public as AnyRecord)[meta.model]
      const raw = await model.create(normalizeData(meta, args.data ?? {}, 'create'))
      const decoded = decodeRow(meta, raw)
      return attachIncludes(client, legacyModel, decoded, raw, args.include)
    },
    async createMany(args: AnyRecord) {
      const client = await getClient()
      const meta = modelMeta(legacyModel)
      const model = (client.orm.public as AnyRecord)[meta.model]
      const data = (args.data ?? []).map((row: AnyRecord) => normalizeData(meta, row, 'create'))
      if (data.length) await model.createAll(data)
      return { count: data.length }
    },
    async findMany(args: AnyRecord = {}) {
      const client = await getClient()
      const { meta, collection } = await buildCollection(client, legacyModel, args)
      const rows = await collection.all()
      const result = []
      for (const raw of rows) {
        const decoded = decodeRow(meta, raw)
        result.push(await attachIncludes(client, legacyModel, decoded, raw, args.include))
      }
      return result
    },
    async findFirst(args: AnyRecord = {}) {
      const client = await getClient()
      const { meta, collection } = await buildCollection(client, legacyModel, args)
      const raw = await collection.first()
      if (!raw) return null
      return attachIncludes(client, legacyModel, decodeRow(meta, raw), raw, args.include)
    },
    async findFirstOrThrow(args: AnyRecord = {}) {
      const row = await this.findFirst(args)
      if (!row) throw new Error('Prisma fixture row not found: ' + legacyModel)
      return row
    },
    async findUnique(args: AnyRecord = {}) {
      return this.findFirst(args)
    },
    async findUniqueOrThrow(args: AnyRecord = {}) {
      return this.findFirstOrThrow(args)
    },
    async count(args: AnyRecord = {}) {
      const client = await getClient()
      const { collection } = await buildCollection(client, legacyModel, args)
      const value = await collection.aggregate((row: any) => ({ count: row.count() }))
      return Number(value.count)
    },
    async update(args: AnyRecord) {
      const client = await getClient()
      const { meta, collection } = await buildCollection(client, legacyModel, { where: args.where })
      const raw = await collection.update(normalizeData(meta, args.data ?? {}, 'update'))
      if (!raw) throw new Error('Prisma fixture update row not found: ' + legacyModel)
      return decodeRow(meta, raw)
    },
    async updateMany(args: AnyRecord) {
      const client = await getClient()
      const { meta, collection } = await buildCollection(client, legacyModel, { where: args.where })
      const count = await collection.updateAndCount(normalizeData(meta, args.data ?? {}, 'update'))
      return { count: Number(count) }
    },
    async delete(args: AnyRecord) {
      const client = await getClient()
      const { meta, collection } = await buildCollection(client, legacyModel, { where: args.where })
      const raw = await collection.delete()
      if (!raw) throw new Error('Prisma fixture delete row not found: ' + legacyModel)
      return decodeRow(meta, raw)
    },
    async deleteMany(args: AnyRecord = {}) {
      const client = await getClient()
      const { collection } = await buildCollection(client, legacyModel, { where: args.where })
      const count = await collection.deleteAndCount()
      return { count: Number(count) }
    },
  }
}

export function createPrismaFixtureClient(databaseUrl: string): PrismaFixtureClient {
  let clientPromise: Promise<Prisma8Client> | undefined
  const getClient = () => (clientPromise ??= createPrisma8Client(databaseUrl))
  const delegateCache = new Map<string, any>()

  return new Proxy(
    {
      async $connect() {
        await (await getClient()).connect()
      },
      async $disconnect() {
        if (clientPromise) await (await clientPromise).close()
      },
    } as AnyRecord,
    {
      get(target, property, receiver) {
        if (typeof property !== 'string' || property.startsWith('$')) return Reflect.get(target, property, receiver)
        if (!(property in PRISMA_FIXTURE_MODELS)) return Reflect.get(target, property, receiver)
        if (!delegateCache.has(property)) delegateCache.set(property, delegate(getClient, property))
        return delegateCache.get(property)
      },
    },
  ) as PrismaFixtureClient
}
