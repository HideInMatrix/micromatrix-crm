import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'

export interface HarnessComment {
  id: string
  resourceId: string
  parentId: string | null
  replyToUserId: string | null
  content: string
  tenantId: string
  createdById: string
  updatedById: string
  createdAt: Date
  updatedAt: Date
}

export interface HarnessUser {
  id: string
  tenantId?: string
  name?: string
  status?: 'ACTIVE' | 'DISABLED'
  avatar?: string | null
}

interface HarnessOptions {
  kind: 'record' | 'plan'
  tenantId: string
  comments?: HarnessComment[]
  mentions?: Array<{ commentId: string; userId: string }>
  users?: HarnessUser[]
  targetNames?: Partial<Record<'customer' | 'lead' | 'opportunity', string>>
  nextCreatedId?: string
}

type Predicate<T> = (row: T) => boolean
type Order<T> = { field: keyof T; direction: 'asc' | 'desc' }

function accessor<T extends Record<string, unknown>>() {
  return new Proxy(
    {},
    {
      get: (_target, property: string) => ({
        in: (values: unknown[]) => (row: T) => values.includes(row[property] as never),
        eq: (value: unknown) => (row: T) => row[property] === value,
        neq: (value: unknown) => (row: T) => row[property] !== value,
        isNull: () => (row: T) => row[property] == null,
        asc: () => ({ field: property as keyof T, direction: 'asc' as const }),
        desc: () => ({ field: property as keyof T, direction: 'desc' as const }),
      }),
    },
  ) as {
    [K in keyof T]: {
      in(values: unknown[]): Predicate<T>
      eq(value: unknown): Predicate<T>
      neq(value: unknown): Predicate<T>
      isNull(): Predicate<T>
      asc(): Order<T>
      desc(): Order<T>
    }
  }
}

function makeCollection<T extends Record<string, unknown>>(
  rows: T[],
  hooks: {
    onCreate?: (data: Record<string, unknown>) => T
    onUpdate?: (row: T, data: Record<string, unknown>) => void
    onDelete?: (row: T) => void
    onCreateAll?: (data: Record<string, unknown>[]) => void
    onDeleteAndCount?: (count: number) => void
    onAggregate?: () => void
  } = {},
  state: {
    predicates?: Predicate<T>[]
    orders?: Order<T>[]
    offset?: number
    limit?: number
    selected?: Array<keyof T>
  } = {},
): any {
  const predicates = state.predicates ?? []
  const orders = state.orders ?? []

  const clone = (next: typeof state) => makeCollection(rows, hooks, { ...state, ...next })
  const materialize = () => {
    let result = rows.filter((row) => predicates.every((predicate) => predicate(row)))
    for (const order of [...orders].reverse()) {
      result = [...result].sort((left, right) => {
        const a = left[order.field]
        const b = right[order.field]
        const compared = String(a ?? '').localeCompare(String(b ?? ''))
        return order.direction === 'asc' ? compared : -compared
      })
    }
    const offset = state.offset ?? 0
    result = result.slice(offset, state.limit === undefined ? undefined : offset + state.limit)
    if (!state.selected) return result.map((row) => ({ ...row }))
    return result.map((row) =>
      Object.fromEntries(state.selected!.map((field) => [field, row[field]])),
    )
  }

  return {
    where(condition: Partial<T> | ((row: ReturnType<typeof accessor<T>>) => Predicate<T>)) {
      const predicate: Predicate<T> =
        typeof condition === 'function'
          ? condition(accessor<T>())
          : (row) =>
              Object.entries(condition).every(([key, value]) => row[key as keyof T] === value)
      return clone({ predicates: [...predicates, predicate] })
    },
    select(...fields: Array<keyof T>) {
      return clone({ selected: fields })
    },
    orderBy(selector: (row: ReturnType<typeof accessor<T>>) => Order<T>) {
      return clone({ orders: [...orders, selector(accessor<T>())] })
    },
    offset(value: number) {
      return clone({ offset: value })
    },
    limit(value: number) {
      return clone({ limit: value })
    },
    async all() {
      return materialize()
    },
    async first() {
      return materialize()[0] ?? null
    },
    async aggregate(spec: (aggregate: { count(): number }) => unknown) {
      hooks.onAggregate?.()
      return spec({ count: () => materialize().length })
    },
    async create(data: Record<string, unknown>) {
      const created = hooks.onCreate ? hooks.onCreate(data) : (data as T)
      rows.push(created)
      return { ...created }
    },
    async update(data: Record<string, unknown>) {
      const row = rows.find((item) => predicates.every((predicate) => predicate(item)))
      if (!row) return null
      Object.assign(row, data)
      hooks.onUpdate?.(row, data)
      return { ...row }
    },
    async delete() {
      const index = rows.findIndex((item) => predicates.every((predicate) => predicate(item)))
      if (index < 0) return null
      const [removed] = rows.splice(index, 1)
      hooks.onDelete?.(removed!)
      return { ...removed! }
    },
    async deleteAndCount() {
      let count = 0
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (!predicates.every((predicate) => predicate(rows[index]!))) continue
        rows.splice(index, 1)
        count += 1
      }
      hooks.onDeleteAndCount?.(count)
      return count
    },
    async createAll(data: Record<string, unknown>[]) {
      hooks.onCreateAll?.(data)
      for (const item of data) rows.push(item as T)
      return data
    },
  }
}

export function createFollowCommentPrisma8Harness(options: HarnessOptions) {
  const calls: string[] = []
  const comments = [...(options.comments ?? [])]
  const mentions = [...(options.mentions ?? [])]
  const users = (options.users ?? []).map((item) => ({
    id: item.id,
    tenantId: item.tenantId ?? options.tenantId,
    name: item.name ?? `成员-${item.id}`,
    status: item.status ?? ('ACTIVE' as const),
  }))
  const extensions = (options.users ?? []).map((item) => ({
    id: item.id,
    avatar: item.avatar ?? null,
  }))
  const targetNames = {
    customer: '客户A',
    lead: '线索A',
    opportunity: '商机A',
    ...options.targetNames,
  }
  let createdSequence = 0

  const commentRows = comments.map((comment) => ({
    id: comment.id,
    resourceId: comment.resourceId,
    parentId: comment.parentId,
    replyToUserId: comment.replyToUserId,
    content: comment.content,
    organizationId: comment.tenantId,
    createUser: comment.createdById,
    updateUser: comment.updatedById,
    createTime: prisma8TimestampFromDate(comment.createdAt),
    updateTime: prisma8TimestampFromDate(comment.updatedAt),
  }))
  const mentionRows = mentions.map((mention, index) => ({
    id: `mention-${index + 1}`,
    ...mention,
  }))
  const resources = [{
    id: options.kind === 'record' ? 'record-1' : 'plan-1',
    tenantId: options.tenantId,
    commentCount: comments.length,
    updatedAt: prisma8TimestampFromDate(new Date('2026-09-06T03:00:00.000Z')),
  }]

  const commentHooks = {
    onCreate: (data: Record<string, unknown>) => {
      calls.push('comment')
      const now = new Date('2026-09-06T04:00:00.000Z')
      return {
        ...data,
        id: options.nextCreatedId ?? `comment-${++createdSequence}`,
        createTime: prisma8TimestampFromDate(now),
        updateTime: data['updateTime'] ?? prisma8TimestampFromDate(now),
      } as (typeof commentRows)[number]
    },
    onAggregate: () => calls.push('count'),
  }
  const mentionHooks = {
    onDeleteAndCount: () => calls.push('mention-delete'),
    onCreateAll: () => calls.push('mention-create'),
  }
  const resourceHooks = {
    onUpdate: () => calls.push(options.kind === 'record' ? 'record-count' : 'plan-count'),
  }

  const publicOrm: Record<string, unknown> = {
    Users: makeCollection(users),
    UserExtensions: makeCollection(extensions),
    Customer: makeCollection([
      { id: 'customer-1', organizationId: options.tenantId, name: targetNames.customer },
    ]),
    Clue: makeCollection([
      { id: 'lead-1', organizationId: options.tenantId, name: targetNames.lead },
    ]),
    Opportunity: makeCollection([
      { id: 'opportunity-1', organizationId: options.tenantId, name: targetNames.opportunity },
    ]),
  }
  if (options.kind === 'record') {
    publicOrm['FollowUpRecordComment'] = makeCollection(commentRows, commentHooks)
    publicOrm['FollowUpRecordCommentMention'] = makeCollection(mentionRows, mentionHooks)
    publicOrm['FollowUpRecords'] = makeCollection(resources, resourceHooks)
  } else {
    publicOrm['FollowUpPlanComment'] = makeCollection(commentRows, commentHooks)
    publicOrm['FollowUpPlanCommentMention'] = makeCollection(mentionRows, mentionHooks)
    publicOrm['FollowUpPlans'] = makeCollection(resources, resourceHooks)
  }

  const client = {
    orm: { public: publicOrm },
    transaction: async <T>(callback: (tx: { orm: { public: typeof publicOrm } }) => Promise<T>) =>
      callback({ orm: { public: publicOrm } }),
  }

  return {
    prisma8: { client } as unknown as Prisma8Service,
    calls,
    comments,
    mentions,
  }
}
