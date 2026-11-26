import assert from 'node:assert/strict'
import {
  memoFormConfigRead,
  withFormConfigReadMemo,
} from '../src/modules/metadata/form-config-read-memo'
import type { ModuleFormConfigVO } from '../src/modules/metadata/module-forms.service'

async function main() {
  let calls = 0
  const read = (tenant: string, form: string) =>
    memoFormConfigRead(tenant, form, async () => {
      calls++
      return { formKey: form, formProp: {}, fields: [] } as ModuleFormConfigVO
    })
  await withFormConfigReadMemo(async () => {
    const [a, b] = await Promise.all([read('t1', 'lead'), read('t1', 'lead')])
    assert.equal(a, b)
    assert.equal(await read('t1', 'lead'), a)
    assert.equal(await withFormConfigReadMemo(() => read('t1', 'lead')), a)
    assert.equal(calls, 1)
    await read('t2', 'lead')
    await read('t1', 'customer')
    assert.equal(calls, 3)
    await assert.rejects(
      memoFormConfigRead('t1', 'retry', async () => {
        throw new Error('fail')
      }),
    )
    assert.equal((await read('t1', 'retry')).formKey, 'retry')
  })
  await Promise.all([
    withFormConfigReadMemo(() => read('t1', 'lead')),
    withFormConfigReadMemo(() => read('t1', 'lead')),
  ])
  assert.equal(calls, 6)
  await read('t1', 'lead')
  await read('t1', 'lead')
  assert.equal(calls, 8)
  console.log('Request-local form config reuse, isolation and retry tests passed.')
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
