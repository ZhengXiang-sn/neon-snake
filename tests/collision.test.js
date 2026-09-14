import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGrid, circlesOverlap } from '../src/game/collision.js'

test('circlesOverlap 边界包含', () => {
  assert.equal(circlesOverlap(0, 0, 1, 2, 0, 1), true)
  assert.equal(circlesOverlap(0, 0, 1, 2.001, 0, 1), false)
  assert.equal(circlesOverlap(0, 0, 5, 0, 0, 5), true)
})

test('网格插入后可按半径查询命中', () => {
  const grid = createGrid(96)
  grid.begin()
  grid.insert(10, 10, 5, 'a', 0)
  grid.insert(500, 500, 5, 'b', 1)

  const hits = []
  grid.query(12, 12, 3, (x, y, r, ref, idx) => {
    hits.push([ref, idx])
    return true
  })
  assert.deepEqual(hits, [['a', 0]])
})

test('查询半径外不返回，且 begin 会清空上一帧数据', () => {
  const grid = createGrid(96)
  grid.begin()
  grid.insert(0, 0, 5, 'x', 0)
  let count = 0
  grid.query(1000, 1000, 5, () => {
    count++
    return true
  })
  assert.equal(count, 0)

  grid.begin()
  grid.query(0, 0, 5, () => {
    count++
    return true
  })
  assert.equal(count, 0, 'begin 之后旧条目不应再被查到')
})

test('跨负坐标的格子键不冲突', () => {
  const grid = createGrid(96)
  grid.begin()
  grid.insert(-5000, 3000, 4, 'neg', 0)
  grid.insert(5000, -3000, 4, 'pos', 1)
  const found = []
  grid.query(-5000, 3000, 4, (x, y, r, ref) => {
    found.push(ref)
    return true
  })
  assert.deepEqual(found, ['neg'])
})

test('visit 返回 false 可提前终止遍历', () => {
  const grid = createGrid(256)
  grid.begin()
  for (let i = 0; i < 8; i++) grid.insert(i, 0, 10, `n${i}`, i)
  let visited = 0
  grid.query(0, 0, 60, () => {
    visited++
    return false
  })
  assert.equal(visited, 1)
})

test('桶数组跨帧复用，不随帧数增长', () => {
  const grid = createGrid(96)
  for (let frame = 0; frame < 50; frame++) {
    grid.begin()
    for (let i = 0; i < 20; i++) grid.insert(i * 10, i * 10, 4, 'ref', i)
  }
  assert.ok(grid.bucketCount > 0)
  assert.ok(grid.bucketCount < 200, `桶数量应有界，实际 ${grid.bucketCount}`)
})
