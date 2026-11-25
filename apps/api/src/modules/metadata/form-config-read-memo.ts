import { AsyncLocalStorage } from 'node:async_hooks'
import type { ModuleFormConfigVO } from './module-forms.service'

const reads = new AsyncLocalStorage<Map<string, Promise<ModuleFormConfigVO>>>()

/** Only wrap read preparation for one external request, never admin/config writes. */
export function withFormConfigReadMemo<T>(task: () => Promise<T>): Promise<T> {
  return reads.run(new Map(), task)
}

export function memoFormConfigRead(
  tenantId: string,
  formKey: string,
  loader: () => Promise<ModuleFormConfigVO>,
): Promise<ModuleFormConfigVO> {
  const memo = reads.getStore()
  if (!memo) return loader()
  const key = JSON.stringify([tenantId, formKey])
  const existing = memo.get(key)
  if (existing) return existing
  const pending = Promise.resolve().then(loader)
  memo.set(key, pending)
  void pending.catch(() => {
    if (memo.get(key) === pending) memo.delete(key)
  })
  return pending
}
