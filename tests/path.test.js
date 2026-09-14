import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PathBuf } from '../src/core/path.js'

test('push 累加弧长，索引 0 为最旧、末位为最新', () => {
  const p = new PathBuf(16)
  p.push(0, 0)
  assert.equal(p.count, 1)
  assert.equal(p.length, 0)
  p.push(3, 4)
  assert.equal(p.count, 2)
  assert.equal(p.length, 5)
  assert.equal(p.x(0), 0)
  assert.equal(p.y(0), 0)
  assert.equal(p.x(1), 3)
  assert.equal(p.y(1), 4)
})

test('环形缓冲满时丢弃最旧点，弧长不被污染', () => {
  const cap = 4
  const p = new PathBuf(cap)
  for (let i = 0; i < 10; i++) p.push(i, 0)
  assert.equal(p.count, cap)
  assert.equal(p.x(0), 6)
  assert.equal(p.x(cap - 1), 9)
  // 仅剩 3 段、每段长度 1
  assert.equal(p.length, 3)
})

test('dropFrontOne 维护弧长且至少保留两个点', () => {
  const p = new PathBuf(8)
  p.push(0, 0)
  p.push(1, 0)
  p.push(2, 0)
  assert.equal(p.length, 2)
  assert.equal(p.dropFrontOne(), true)
  assert.equal(p.count, 2)
  assert.equal(p.length, 1)
  assert.equal(p.dropFrontOne(), false)
  assert.equal(p.count, 2)
})

test('trimTo 把总弧长裁剪到阈值以下（内存安全）', () => {
  const p = new PathBuf(64)
  for (let i = 0; i < 40; i++) p.push(i, 0)
  assert.equal(p.length, 39)
  p.trimTo(10)
  assert.ok(p.length <= 10 + 1e-9, `裁剪后弧长应 <= 10，实际 ${p.length}`)
  assert.ok(p.count >= 2)
  // 头部（最新点）必须保留
  assert.equal(p.x(p.count - 1), 39)
})

test('clear 重置状态', () => {
  const p = new PathBuf(8)
  p.push(0, 0)
  p.push(1, 1)
  p.clear()
  assert.equal(p.count, 0)
  assert.equal(p.length, 0)
})

test('容量为 1 的极端情况不会崩坏', () => {
  const p = new PathBuf(1)
  p.push(0, 0)
  p.push(1, 1)
  assert.equal(p.count, 1)
  assert.equal(p.x(0), 1)
})
