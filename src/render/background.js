import { TAU } from '../core/math.js'

const TILE = 512

/**
 * 背景层：深空底色 + 可平铺的星点层（视差）+ 暗角。
 * 星点预渲染到离屏 canvas，每帧只做若干次 drawImage，
 * 避免逐帧绘制上千个点（调研结论 §3.7：静态背景层应被缓存）。
 */
export function createBackground() {
  let tile = null
  let tileCtx = null
  let themeId = ''
  /** 渐变对象按 (主题, 视口尺寸) 缓存：createLinearGradient/createRadialGradient 每帧新建是移动端掉帧主因之一。 */
  let gradThemeId = ''
  let gradW = 0
  let gradH = 0
  let bgGrad = null
  let vigGrad = null
  let gradCtx = null

  function buildGradients(ctx, viewport, theme) {
    gradCtx = ctx
    bgGrad = ctx.createLinearGradient(0, 0, 0, viewport.h)
    bgGrad.addColorStop(0, theme.bg)
    bgGrad.addColorStop(1, theme.bgTint)
    vigGrad = ctx.createRadialGradient(
      viewport.w / 2,
      viewport.h / 2,
      Math.min(viewport.w, viewport.h) * 0.28,
      viewport.w / 2,
      viewport.h / 2,
      Math.max(viewport.w, viewport.h) * 0.78,
    )
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)')
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.62)')
    gradThemeId = theme.id
    gradW = viewport.w
    gradH = viewport.h
  }

  function buildTile(theme) {
    tile = document.createElement('canvas')
    tile.width = TILE
    tile.height = TILE
    tileCtx = tile.getContext('2d')
    tileCtx.clearRect(0, 0, TILE, TILE)
    const count = 78
    for (let i = 0; i < count; i++) {
      const x = Math.random() * TILE
      const y = Math.random() * TILE
      const r = Math.random() * 1.35 + 0.35
      const a = 0.25 + Math.random() * 0.75
      tileCtx.globalAlpha = a
      tileCtx.fillStyle = theme.star
      tileCtx.beginPath()
      tileCtx.arc(x, y, r, 0, TAU)
      tileCtx.fill()
    }
    tileCtx.globalAlpha = 0.5
    tileCtx.strokeStyle = theme.grid
    tileCtx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const p = (i * TILE) / 4
      tileCtx.beginPath()
      tileCtx.moveTo(p, 0)
      tileCtx.lineTo(p, TILE)
      tileCtx.moveTo(0, p)
      tileCtx.lineTo(TILE, p)
      tileCtx.stroke()
    }
    tileCtx.globalAlpha = 1
    themeId = theme.id
  }

  return {
    setTheme(theme) {
      if (themeId !== theme.id || !tile) buildTile(theme)
      gradThemeId = ''
    },
    draw(ctx, camera, viewport, theme) {
      if (!tile || themeId !== theme.id) {
        buildTile(theme)
        gradThemeId = ''
      }
      const dpr = viewport.dpr || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // 同尺寸 / 同主题下复用渐变对象；resize 或旋屏时才重建（逐帧新建渐变是移动端掉帧主因）
      if (
        !bgGrad ||
        gradCtx !== ctx ||
        gradThemeId !== theme.id ||
        gradW !== viewport.w ||
        gradH !== viewport.h
      ) {
        buildGradients(ctx, viewport, theme)
      }
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, viewport.w, viewport.h)

      // 星点层：视差 0.22，不随缩放变化，制造"远景"感
      const ox = -((camera.x * 0.22) % TILE)
      const oy = -((camera.y * 0.22) % TILE)
      const cols = Math.ceil(viewport.w / TILE) + 2
      const rows = Math.ceil(viewport.h / TILE) + 2
      const startX = ox - TILE
      const startY = oy - TILE
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.drawImage(tile, startX + c * TILE, startY + r * TILE)
        }
      }

      ctx.fillStyle = vigGrad
      ctx.fillRect(0, 0, viewport.w, viewport.h)
    },
  }
}
