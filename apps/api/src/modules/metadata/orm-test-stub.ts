type TestRow = Record<string, unknown>

type Predicate = (row: TestRow) => boolean

type Expression =
  | { kind: 'in'; field: string; values: readonly unknown[] }
  | { kind: 'neq'; field: string; value: unknown }

function callbackPredicate(callback: (row: Record<string, unknown>) => unknown): Predicate {
  const row = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, field) => ({
        in: (values: readonly unknown[]): Expression => ({
          kind: 'in',
          field: String(field),
          values,
        }),
        neq: (value: unknown): Expression => ({ kind: 'neq', field: String(field), value }),
        asc: () => ({ kind: 'asc', field: String(field) }),
      }),
    },
  )
  const expression = callback(row) as Expression
  if (expression?.kind === 'in') {
    return (candidate) => expression.values.includes(candidate[expression.field])
  }
  if (expression?.kind === 'neq') {
    return (candidate) => candidate[expression.field] !== expression.value
  }
  return () => true
}

function objectPredicate(where: Record<string, unknown>): Predicate {
  return (row) =>
    Object.entries(where).every(([field, value]) => {
      if (value && typeof value === 'object' && 'in' in value) {
        const values = (value as { in: readonly unknown[] }).in
        return values.includes(row[field])
      }
      if (value && typeof value === 'object' && 'not' in value) {
        return row[field] !== (value as { not: unknown }).not
      }
      return row[field] === value
    })
}

export function createMemoryOrmTable<T extends object>(
  rows: T[],
  options: {
    onAll?: () => void
    beforeCreateAll?: (data: readonly T[]) => void
  } = {},
) {
  const buildQuery = (predicates: Predicate[]) => ({
    where(condition: Record<string, unknown> | ((row: Record<string, unknown>) => unknown)) {
      const predicate =
        typeof condition === 'function' ? callbackPredicate(condition) : objectPredicate(condition)
      return buildQuery([...predicates, predicate])
    },
    select(..._fields: string[]) {
      return buildQuery(predicates)
    },
    orderBy(_expression: (row: Record<string, unknown>) => unknown) {
      return buildQuery(predicates)
    },
    async all(): Promise<T[]> {
      options.onAll?.()
      return rows.filter((row) =>
        predicates.every((predicate) => predicate(row as unknown as TestRow)),
      )
    },
    async deleteAll(): Promise<number> {
      let count = 0
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index]
        if (
          row &&
          predicates.every((predicate) => predicate(row as unknown as TestRow))
        ) {
          rows.splice(index, 1)
          count++
        }
      }
      return count
    },
    async updateAndCount(data: Record<string, unknown>): Promise<number> {
      let count = 0
      for (const row of rows) {
        if (!predicates.every((predicate) => predicate(row as unknown as TestRow))) continue
        Object.assign(row, data)
        count++
      }
      return count
    },
  })

  return {
    ...buildQuery([]),
    async create(data: T): Promise<T> {
      rows.push(data)
      return data
    },
    async createAll(data: readonly T[]): Promise<number> {
      options.beforeCreateAll?.(data)
      rows.push(...data)
      return data.length
    },
  }
}

export function createTransactionStub(publicNamespace: Record<string, unknown>) {
  return {
    orm: { public: publicNamespace },
    query: async function* (_query: unknown) {
      yield { locked: 1 }
    },
  }
}
