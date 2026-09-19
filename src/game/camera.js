import { CONFIG } from '../config.js'
import { clamp, approach } from '../core/math.js'

/**
 * 跟随相机：位置指数平滑 + 朝向前瞻 + 质量驱动的自动拉远 + 事件驱动震屏。
 * 渲染层通过 applyTransform 把世界坐标映射到画布像素。
 */
export function createCamera() {
  const c = CONFIG.camera
  const boundScratch = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const zeroOffset = { x: 0, y: 0 }
  const shakeScratch = { x: 0, y: 0 }
  return {
    x: 0,
    y: 0,
    zoom: 1,
    flash: 0,
    /**
     * 已是可直接赋给 `fillStyle` 的 CSS 颜色。
     * 早期版本这里存的是裸三元组 `'255,255,255'`，渲染层每帧拼一次 `rgba(...)` 字符串，
     * 与"热路径零分配"冲突。现在合成只发生在 `pulse()` 被调用的那一瞬（每次触发一次）。
     */
    flashColor: 'rgb(255,255,255)',
    shakeTime: 0,
    shakeDuration: 1,
    shakeMag: 0,
    reducedMotion: false,

    reset(x = 0, y = 0) {
      this.x = x
      this.y = y
      this.zoom = 1
      this.flash = 0
      this.shakeTime = 0
      this.shakeMag = 0
    },

    update(dt, snake, viewport) {
      if (snake) {
        const speedRatio = clamp(snake.speed / CONFIG.snake.baseSpeed, 0.5, 1.7)
        const look = c.lookAhead * speedRatio * (snake.boosting ? 1.25 : 1)
        const tx = snake.x + Math.cos(snake.angle) * look
        const ty = snake.y + Math.sin(snake.angle) * look
        this.x = approach(this.x, tx, c.follow, dt)
        this.y = approach(this.y, ty, c.follow, dt)
        const span = Math.min(c.spanMax, c.spanBase + snake.mass * c.spanPerMass)
        const fit = Math.min(viewport.w, viewport.h) / span
        this.zoom = approach(this.zoom, clamp(fit, c.zoomMin, c.zoomMax), c.zoomFollow, dt)
      }
      if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt)
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6)
    },

    shake(magnitude, duration = 0.35) {
      if (this.reducedMotion) return
      if (magnitude >= this.shakeMag || this.shakeTime <= 0) {
        this.shakeMag = magnitude
        this.shakeDuration = duration
        this.shakeTime = duration
      }
    },

    /**
     * 触发一次全屏闪光。
     * @param {string} color 逗号分隔的 RGB 三元组，如 `'255,80,110'`
     */
    pulse(color, amount = 0.35) {
      this.flashColor = `rgb(${color})`
      this.flash = Math.min(1, this.flash + amount)
    },

    /** 当前帧的震屏位移（世界单位）。返回复用对象，调用方不得长期持有。 */
    shakeOffset() {
      if (this.shakeTime <= 0) return zeroOffset
      const k = (this.shakeTime / this.shakeDuration) * this.shakeMag
      shakeScratch.x = Math.cos(this.shakeTime * 97) * k
      shakeScratch.y = Math.sin(this.shakeTime * 113) * k
      return shakeScratch
    },

    /** 把渲染上下文变换到世界坐标系（dpr 已折算进基础变换）。 */
    applyTransform(ctx, viewport) {
      const off = this.shakeOffset()
      const dpr = viewport.dpr || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.translate(viewport.w / 2, viewport.h / 2)
      ctx.scale(this.zoom, this.zoom)
      ctx.translate(-(this.x + off.x), -(this.y + off.y))
    },

    /** 世界坐标 → 屏幕像素（CSS 像素，与 dpr 无关） */
    toScreen(wx, wy, viewport) {
      return {
        x: (wx - this.x) * this.zoom + viewport.w / 2,
        y: (wy - this.y) * this.zoom + viewport.h / 2,
      }
    },

    /**
     * 可见世界范围（用于剔除）。默认写入复用的 `out` 对象以实现逐帧零分配；
     * 同一帧内需要两份边界时，请显式传入不同的 out，避免互相覆盖。
     */
    visibleBounds(viewport, pad = 120, out = boundScratch) {
      const hw = viewport.w / 2 / this.zoom + pad
      const hh = viewport.h / 2 / this.zoom + pad
      out.minX = this.x - hw
      out.maxX = this.x + hw
      out.minY = this.y - hh
      out.maxY = this.y + hh
      return out
    },
  }
}
