/**
 * 预渲染发光精灵。
 *
 * 调研结论：`shadowBlur` / CSS `filter: blur()` 在热路径上的代价极高，
 * 而"加性混合 + 一次性预渲染的径向渐变精灵"几乎免费。
 * 因此所有光晕都走 drawImage(sprite) + globalCompositeOperation='lighter'。
 */
const SPRITE_SIZE = 128
const cache = new Map()

function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function getGlowSprite(color) {
  let sprite = cache.get(color)
  if (sprite) return sprite
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_SIZE
  canvas.height = SPRITE_SIZE
  const ctx = canvas.getContext('2d')
  const half = SPRITE_SIZE / 2
  const [r, g, b] = hexToRgb(color)
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`)
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.46)`)
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.14)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
  sprite = canvas
  cache.set(color, sprite)
  return sprite
}

/**
 * 以 (x,y) 为中心画一个半径为 radius 的光晕。调用方需自行设置 'lighter' 合成模式。
 *
 * 注意：函数结束时会把 `globalAlpha` 还原成调用前的值。
 * 早期版本只赋值不复位，导致调用方随后的实心填充（蛇头、宝石核心、道具底盘）
 * 全部以半透明绘制，画面发灰。
 */
export function drawGlow(ctx, color, x, y, radius, alpha = 1) {
  const sprite = getGlowSprite(color)
  const prevAlpha = ctx.globalAlpha
  ctx.globalAlpha = alpha
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2)
  ctx.globalAlpha = prevAlpha
}
