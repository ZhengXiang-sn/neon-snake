import { drawGlow } from './glow.js'
import { TAU } from '../core/math.js'

/**
 * 粒子系统：预分配 + 环形复用，运行期零分配。
 * 调研结论指出 GC 停顿是 Canvas 动画的隐形杀手，因此这里不 new 对象、
 * 不 push/splice，全部复用固定槽位。
 */
export function createParticles(max = 900) {
  const pool = new Array(max)
  for (let i = 0; i < max; i++) {
    pool[i] = {
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      ttl: 1,
      size: 4,
      color: '#ffffff',
      drag: 2.8,
      kind: 0,
      wobble: 0,
    }
  }
  let cursor = 0
  let limit = max
  let enabled = true

  function clearAll() {
    for (let i = 0; i < max; i++) pool[i].active = false
  }

  function spawn(o) {
    if (!enabled || limit <= 0) return null
    const p = pool[cursor]
    cursor = (cursor + 1) % limit
    p.active = true
    p.x = o.x
    p.y = o.y
    p.vx = o.vx || 0
    p.vy = o.vy || 0
    p.ttl = o.ttl || 0.6
    p.life = p.ttl
    p.size = o.size || 6
    p.color = o.color || '#ffffff'
    p.drag = o.drag ?? 2.8
    p.kind = o.kind || 0
    p.wobble = o.wobble || 0
    return p
  }

  return {
    get limit() {
      return limit
    },
    setLimit(n) {
      limit = Math.max(0, Math.min(max, Math.floor(n)))
      for (let i = limit; i < max; i++) pool[i].active = false
      if (cursor >= limit) cursor = 0
    },
    /** 「减弱动效」专用开关：关闭后不再产生新粒子，并清空存量粒子。 */
    setEnabled(value) {
      enabled = !!value
      if (!enabled) clearAll()
    },
    clear() {
      clearAll()
    },
    spawn,
    /** 吃食物的迸射 */
    sparkle(x, y, color, strength = 1) {
      const n = Math.round(5 * strength)
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU
        const s = 40 + Math.random() * 130 * strength
        spawn({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          ttl: 0.35 + Math.random() * 0.35,
          size: 5 + Math.random() * 6 * strength,
          color,
          drag: 3.4,
        })
      }
    },
    /** 加速尾焰 */
    trail(x, y, color, angle) {
      const a = angle + Math.PI + (Math.random() - 0.5) * 0.7
      const s = 40 + Math.random() * 70
      spawn({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        ttl: 0.22 + Math.random() * 0.22,
        size: 7 + Math.random() * 8,
        color,
        drag: 5,
      })
    },
    /** 死亡爆裂：质量越大越壮观 */
    explosion(x, y, color, mass) {
      const n = Math.min(46, 10 + Math.round(mass * 0.5))
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU
        const s = 90 + Math.random() * 320
        spawn({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          ttl: 0.5 + Math.random() * 0.75,
          size: 9 + Math.random() * 16,
          color,
          drag: 1.9,
        })
      }
    },
    /** 扩散光环（道具拾取、成就） */
    ring(x, y, color, radius, ttl = 0.5) {
      spawn({ x, y, ttl, size: radius, color, kind: 2, drag: 0 })
    },
    update(dt) {
      if (!enabled) return
      for (let i = 0; i < limit; i++) {
        const p = pool[i]
        if (!p.active) continue
        p.life -= dt
        if (p.life <= 0) {
          p.active = false
          continue
        }
        if (p.kind === 2) continue
        const damp = Math.exp(-p.drag * dt)
        p.vx *= damp
        p.vy *= damp
        if (p.wobble) {
          p.x += Math.cos(p.life * 22) * p.wobble * dt
          p.y += Math.sin(p.life * 19) * p.wobble * dt
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
    },
    /** 需在已应用相机变换的世界坐标上下文中调用。 */
    draw(ctx) {
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < limit; i++) {
        const p = pool[i]
        if (!p.active) continue
        const t = p.life / p.ttl
        if (p.kind === 2) {
          const r = p.size * (1 + (1 - t) * 2.6)
          ctx.globalAlpha = t * 0.75
          ctx.strokeStyle = p.color
          ctx.lineWidth = 3 + 5 * t
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, TAU)
          ctx.stroke()
          continue
        }
        drawGlow(ctx, p.color, p.x, p.y, p.size * (0.35 + 0.65 * t), t * 0.85)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}
