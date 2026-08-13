import { SetMetadata } from '@nestjs/common'

export const LOG_OPERATION_KEY = 'logOperation'

export interface LogOperationMeta {
  module: string
  action: string
}

/** 标记接口写入操作日志（成功后异步记录，取结果中的 id/name 作为目标） */
export const LogOperation = (module: string, action: string) =>
  SetMetadata(LOG_OPERATION_KEY, { module, action } satisfies LogOperationMeta)
