const DEFAULT_RETENTION_DAYS = 180
const DEFAULT_BATCH_SIZE = 1_000
const DEFAULT_MAX_BATCHES = 20
const MAX_BATCH_SIZE = 10_000
const MAX_BATCHES = 100

export interface OperationLogCleanupConfig {
  retentionDays: number
  batchSize: number
  maxBatches: number
}

function positiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  max?: number,
): number {
  const value = raw?.trim()
  if (!value) return fallback
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    const suffix = max === undefined ? '' : ` not greater than ${max}`
    throw new Error(`${name} must be a positive integer${suffix}`)
  }
  return parsed
}

export function resolveOperationLogCleanupConfig(
  env: NodeJS.ProcessEnv = process.env,
): OperationLogCleanupConfig {
  return {
    retentionDays: positiveInteger(
      'OPERATION_LOG_RETENTION_DAYS',
      env.OPERATION_LOG_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    ),
    batchSize: positiveInteger(
      'OPERATION_LOG_CLEANUP_BATCH_SIZE',
      env.OPERATION_LOG_CLEANUP_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MAX_BATCH_SIZE,
    ),
    maxBatches: positiveInteger(
      'OPERATION_LOG_CLEANUP_MAX_BATCHES',
      env.OPERATION_LOG_CLEANUP_MAX_BATCHES,
      DEFAULT_MAX_BATCHES,
      MAX_BATCHES,
    ),
  }
}
