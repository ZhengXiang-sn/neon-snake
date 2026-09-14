import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime, formatScore } from '../src/core/format.js'

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

test('formatScore 把宝石均分产生的浮点分数收敛为整数展示（回归防护）', () => {
  // 宝石价值 = 掉落总价值 / 球数，天然是分数；连击倍率再乘上去。
  assert.equal(formatScore(0), '0')
  assert.equal(formatScore(1), '1')
  assert.equal(formatScore(5.5), '6')
  assert.equal(formatScore(73.33333333333333), '73')
  assert.equal(formatScore(12.5), '13')
  // 绝不出现小数点 / 科学计数法 / NaN（1e21 以上会退化成指数记法，
  // 但一局贪吃蛇的分数不可能到达那个量级，因此不为其增加复杂度）
  for (const bad of [73.33333333333333, 5.5, 999999.6, 0.4]) {
    assert.match(formatScore(bad), /^\d+$/)
  }
})

test('formatScore 对脏输入不产生 NaN', () => {
  assert.equal(formatScore(NaN), '0')
  assert.equal(formatScore(undefined), '0')
  assert.equal(formatScore(-9), '0')
  assert.equal(formatScore('120'), '120')
})
