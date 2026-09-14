/** 展示层格式化工具。纯函数，可被 Node 直接测试。 */

/** 秒 → "m:ss"（用于 HUD 计时与结算面板，保证两处格式完全一致） */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * 分数 → 展示用整数串。
 *
 * 分数内部是浮点数：宝石掉落时按 `总价值 / 球数` 均分，
 * 连击倍率也参与相乘，于是原始值可能长成 `73.33333333333333`。
 * 直接 String() 会把这个脏数字糊到 HUD 和结算面板上，因此统一在展示层取整。
 */
export function formatScore(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return String(Math.max(0, Math.round(n)))
}

