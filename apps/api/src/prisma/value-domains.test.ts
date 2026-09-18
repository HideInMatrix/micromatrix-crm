import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonValue } from './json-value'
import { decimalString, numericValue, tryNumericValues } from './numeric-value'

test('Numeric domain keeps decimal text exact and rejects implicit floating-point rounding', () => {
  const value = decimalString('123.4500', 10, 4)
  assert.equal(value, '123.4500')
  assert.equal(numericValue(value, 10, 4), '123.4500')

  assert.throws(() => decimalString('123456789.00', 10, 2), /out of range/)
  assert.throws(() => decimalString('1.234', 10, 2), /out of range/)
  assert.throws(() => decimalString(0.1 + 0.2, 14, 2), /out of range/)
  assert.throws(() => decimalString(Number.POSITIVE_INFINITY, 14, 2), /invalid/)

  assert.deepEqual(tryNumericValues(['1.20', 2, '3.45'], 10, 2), ['1.20', '2', '3.45'])
  assert.equal(tryNumericValues(['1.20', 'invalid'], 10, 2), null)
})

test('JSON domain accepts serializable values and rejects non-JSON payloads', () => {
  assert.deepEqual(
    jsonValue({
      text: 'value',
      nested: [1, true, null],
      omitted: undefined,
    }),
    {
      text: 'value',
      nested: [1, true, null],
    },
  )

  assert.throws(() => jsonValue(undefined), /JSON-serializable/)
  assert.throws(() => jsonValue({ value: Number.NaN }), /NaN or Infinity/)
  assert.throws(() => jsonValue([Number.NEGATIVE_INFINITY]), /NaN or Infinity/)
  assert.throws(() => jsonValue({ value: 1n }), TypeError)
})
