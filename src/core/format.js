/** 展示层格式化工具。纯函数，可被 Node 直接测试。 */

/** 秒 → "m:ss"（用于 HUD 计时与结算面板，保证两处格式完全一致） */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
