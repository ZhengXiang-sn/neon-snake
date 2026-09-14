/**
 * 纯数学工具：无副作用、无 DOM 依赖，可被 Node 直接导入做单元测试。
 *
 * 这里导出的是"被标记为稳定、且有单元测试覆盖"的工具集；
 * 其中 `dist` / `pointSegmentDist2` / `approachLinear` / `lerpAngle` 目前只有测试在调用，
 * 保留它们是因为后续玩法（碰撞预测、平滑相机）会用到，且已有测试防止回归。
 */

export const TAU = Math.PI * 2

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

/** 把任意角度归一到 [-PI, PI) */
export function wrapAngle(a) {
  let x = (a + Math.PI) % TAU
  if (x < 0) x += TAU
  return x - Math.PI
}

/** 从 from 转到 to 的最短有向角差，范围 [-PI, PI) */
export function angleDelta(from, to) {
  return wrapAngle(to - from)
}

/**
 * 以受限于 maxStep 的角速度把 current 转向 target。
 * 这是"惯性转向"手感的核心：永不瞬转。
 */
export function rotateTowards(current, target, maxStep) {
  const d = angleDelta(current, target)
  if (Math.abs(d) <= maxStep) return wrapAngle(target)
  return wrapAngle(current + Math.sign(d) * maxStep)
}

/** 指数趋近（与帧率无关的平滑），rate 越大越快。 */
export function approach(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt))
}

function dist2(ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}

export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by))
}

/** 点到线段的平方距离 */
export function pointSegmentDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  if (len2 < 1e-12) return dist2(px, py, ax, ay)
  let t = ((px - ax) * vx + (py - ay) * vy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = ax + vx * t
  const cy = ay + vy * t
  return dist2(px, py, cx, cy)
}

export function easeOutCubic(t) {
  const p = 1 - t
  return 1 - p * p * p
}

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
}

/** 把 v 从 [lo,hi] 线性映射到 [0,1] 并截断 */
export function normalize(v, lo, hi) {
  if (hi === lo) return 0
  return clamp((v - lo) / (hi - lo), 0, 1)
}

/** 让 a 朝 b 靠拢，每次最多移动 maxDelta */
export function approachLinear(current, target, maxDelta) {
  const d = target - current
  if (Math.abs(d) <= maxDelta) return target
  return current + Math.sign(d) * maxDelta
}

/** 角度插值（走最短弧） */
export function lerpAngle(a, b, t) {
  return wrapAngle(a + angleDelta(a, b) * t)
}
