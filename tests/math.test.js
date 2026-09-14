import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TAU,
  clamp,
  lerp,
  wrapAngle,
  angleDelta,
  rotateTowards,
  approach,
  dist,
  pointSegmentDist2,
  normalize,
  approachLinear,
  lerpAngle,
} from '../src/core/math.js'

test('clamp / lerp / normalize 基本行为', () => {
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(-5, 0, 3), 0)
  assert.equal(clamp(2, 0, 3), 2)
  assert.equal(lerp(0, 10, 0.25), 2.5)
  assert.equal(normalize(5, 0, 10), 0.5)
  assert.equal(normalize(-5, 0, 10), 0)
  assert.equal(normalize(50, 0, 10), 1)
  assert.equal(normalize(1, 2, 2), 0)
})

test('wrapAngle 归一到 [-PI, PI)', () => {
  assert.ok(Math.abs(wrapAngle(TAU) - 0) < 1e-9)
  assert.ok(Math.abs(wrapAngle(TAU + 0.5) - 0.5) < 1e-9)
  assert.ok(Math.abs(wrapAngle(-TAU - 0.5) + 0.5) < 1e-9)
  assert.ok(Math.abs(wrapAngle(Math.PI) + Math.PI) < 1e-9)
  for (let i = -20; i <= 20; i++) {
    const a = wrapAngle(i * 1.37)
    assert.ok(a >= -Math.PI - 1e-9 && a < Math.PI + 1e-9)
  }
})

test('angleDelta 走最短弧（不绕远路）', () => {
  const d = angleDelta(Math.PI * 0.95, -Math.PI * 0.95)
  assert.ok(Math.abs(d - 0.1 * Math.PI) < 1e-9, `期望 +0.1π，实际 ${d}`)
  assert.ok(Math.abs(angleDelta(0, Math.PI / 2) - Math.PI / 2) < 1e-9)
})

test('rotateTowards 受限转向：永不瞬转，且能被角度限制截断', () => {
  let a = 0
  a = rotateTowards(a, 1, 0.1)
  assert.ok(Math.abs(a - 0.1) < 1e-9)
  a = rotateTowards(a, -0.2, 0.1)
  assert.ok(Math.abs(a) < 1e-9, '向负方向转应该按 -maxStep 推进到 0')
  // 目标在可达范围内时直接到达
  assert.ok(Math.abs(rotateTowards(0, 0.05, 0.1) - 0.05) < 1e-9)
  // 正对反向（±PI）时按 wrapAngle 归一后的符号取最短弧
  assert.ok(Math.abs(rotateTowards(0, Math.PI, 0.1) + 0.1) < 1e-9)
  // 连续小步转向最终会收敛到目标
  let b = 0
  for (let i = 0; i < 200; i++) b = rotateTowards(b, 2.5, 0.05)
  assert.ok(Math.abs(angleDelta(b, 2.5)) < 1e-6)
})

test('approach 与帧率无关：两个半步 ≈ 一个整步', () => {
  const one = approach(0, 100, 3, 0.1)
  const two = approach(approach(0, 100, 3, 0.05), 100, 3, 0.05)
  assert.ok(Math.abs(one - two) < 1e-9)
  assert.ok(one < 100 && one > 0)
})

test('dist / pointSegmentDist2', () => {
  assert.equal(dist(0, 0, 3, 4), 5)
  assert.equal(pointSegmentDist2(0, 2, -5, 0, 5, 0), 4)
  // 投影落在线段外时退化为端点距离
  assert.equal(pointSegmentDist2(10, 0, -5, 0, 5, 0), 25)
  // 退化线段
  assert.equal(pointSegmentDist2(3, 4, 0, 0, 0, 0), 25)
})

test('approachLinear 每次最多移动 maxDelta', () => {
  assert.equal(approachLinear(0, 10, 3), 3)
  assert.equal(approachLinear(9, 10, 3), 10)
  assert.equal(approachLinear(10, 0, 3), 7)
})

test('lerpAngle 走最短弧', () => {
  const r = lerpAngle(-Math.PI * 0.9, Math.PI * 0.9, 0.5)
  assert.ok(Math.abs(Math.abs(r) - Math.PI) < 1e-6)
})
