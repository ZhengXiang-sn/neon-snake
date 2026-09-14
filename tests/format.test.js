import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime } from '../src/core/format.js'

test('formatTime 统一输出 m:ss 并做边界收敛', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(9), '0:09')
  assert.equal(formatTime(59.9), '0:59')
  assert.equal(formatTime(60), '1:00')
  assert.equal(formatTime(125), '2:05')
  assert.equal(formatTime(3599), '59:59')
  assert.equal(formatTime(3600), '60:00')
})

test('formatTime 对脏输入不产生 NaN', () => {
  assert.equal(formatTime(-5), '0:00')
  assert.equal(formatTime(NaN), '0:00')
  assert.equal(formatTime(undefined), '0:00')
  assert.equal(formatTime('42'), '0:42')
})
