import { SetMetadata } from '@nestjs/common'

export const LOG_OPERATION_KEY = 'logOperation'

export interface LogOperationMeta {
  module: string
  action: string
}

export const OPERATION_LOG_RESULT_META = Symbol('operationLogResultMeta')

export interface OperationLogResultMeta {
  targetId?: string
  targetName?: string
  detail?: Record<string, unknown>
}

export function withOperationLogResult<T extends object>(
  result: T,
  meta: OperationLogResultMeta,
): T {
  Object.defineProperty(result, OPERATION_LOG_RESULT_META, {
    value: meta,
    enumerable: false,
    configurable: false,
  })
  return result
}

/** 标记接口写入操作日志（成功后异步记录，取结果中的 id/name 作为目标） */
export const LogOperation = (module: string, action: string) =>
  SetMetadata(LOG_OPERATION_KEY, { module, action } satisfies LogOperationMeta)
