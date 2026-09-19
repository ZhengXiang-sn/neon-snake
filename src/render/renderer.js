import { drawGlow } from './glow.js'
import { createScenery } from './scenery.js'
import { drawObstacles } from './obstacles.js'
import { createParticles } from './particles.js'
import { CONFIG, SNAKE_COLORS } from '../config.js'
import { clamp, TAU } from '../core/math.js'

export const POWERUP_COLORS = {
  shield: '#6be8ff',
  magnet: '#ffb03d',
  slow: '#9d8bff',
  ghost: '#c3cbe0',
  double: '#5eff9d',
}

/** drawArena 专用的剔除边界缓存，与 render 内的 bounds 分离，避免互相覆盖。 */
const ARENA_BOUNDS = { minX: 0, maxX: 0, minY: 0, maxY: 0 }

/** 边界刻度数量：偶数根长刻度，形成"竞技场仪表盘"的读数节奏。 */
const RING_TICKS = 96
/** 加速时屏幕空间的放射状速度线数量 */
const STREAKS = 30
/** 出圈压力警示色（预先定死，避免逐帧拼 rgba 字符串） */
const EDGE_PRESSURE_COLOR = 'rgb(255,70,100)'

/**
 * 世界渲染器。
 *
 * 分层顺序（从远到近）：
 *   天空视差 → 地面纹理 → 装饰道具 → 竞技场（内辉光/圈外压暗/边界环）
 *   → 障碍物 → 食物 → 道具 → 蛇 → 粒子 → 空气粒子 → 屏幕特效 → 暗角
 *
 * 发光一律走"预渲染精灵 + 加性混合"，热路径上不出现 shadowBlur / filter / 新建渐变。
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false })
  const scenery = createScenery()
  const particles = createParticles(CONFIG.particles.high)
  const viewport = { w: 1, h: 1, dpr: 1 }
  let theme = null
  let dprCap = 2
  let reducedMotion = false
  /** 竞技场内圈渐变按 (主题, 半径整十位) 缓存，收缩期间约每 10 世界单位才重建一次。 */
  let innerThemeId = ''
  let innerRadiusKey = -Infinity
  let innerGrad = null

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    viewport.w = w
    viewport.h = h
    viewport.dpr = dpr
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
  }

  // ---------------------------------------------------------------- 蛇

  function traceSnakeBody(snake, time, wobble) {
    const n = snake.nodeCount
    const nodes = snake.nodes
    const amp = wobble ? Math.min(snake.radius * 0.34, 8.5) : 0
    ctx.beginPath()
    for (let i = n - 1; i >= 0; i--) {
      const nd = nodes[i]
      let x = nd.x
      let y = nd.y
      if (amp > 0.05) {
        const tailT = i / Math.max(1, n - 1)
        const a = Math.sin(time * 7.5 - i * 0.44) * amp * tailT
        const prev = nodes[Math.min(i + 1, n - 1)]
        const next = nodes[Math.max(i - 1, 0)]
        let dx = next.x - prev.x
        let dy = next.y - prev.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        dx /= len
        dy /= len
        x += -dy * a
        y += dx * a
      }
      if (i === n - 1) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }

  function drawSnake(snake, time, isPlayer) {
    if (!snake.alive || snake.nodeCount < 2) return
    const palette = SNAKE_COLORS[snake.colorIndex % SNAKE_COLORS.length]
    const r = snake.radius
    const ghost = snake.effects.ghost > 0
    const bodyAlpha = ghost ? 0.62 : 1

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 只 trace 一次，随后的所有描边复用同一条路径 ——
    // 早期版本每换一次颜色就重新 trace，等于把整条身体算 5 遍。
    traceSnakeBody(snake, time, true)

    // 1) 加性发光层
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = (snake.boosting ? 0.3 : 0.17) * bodyAlpha
    ctx.strokeStyle = palette.glow
    ctx.lineWidth = r * 3.1
    ctx.stroke()
    ctx.globalAlpha = (snake.boosting ? 0.36 : 0.24) * bodyAlpha
    ctx.lineWidth = r * 2.1
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'

    // 2) 主体
    ctx.globalAlpha = bodyAlpha
    ctx.strokeStyle = palette.dark
    ctx.lineWidth = r * 2
    ctx.stroke()
    ctx.strokeStyle = palette.main
    ctx.lineWidth = r * 1.62
    ctx.stroke()

    // 3) 内芯高光
    ctx.globalAlpha = 0.55 * bodyAlpha
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = r * 0.5
    ctx.stroke()

    // 4) 流动刻度：沿身体滑动的短亮线。同一条路径换虚线再描一次，
    //    成本几乎为零，但蛇立刻从"一根渐变管"变成"在动的生物"。
    if (!reducedMotion) {
      ctx.setLineDash([r * 0.5, r * 1.15])
      ctx.lineDashOffset = -time * 190
      ctx.globalAlpha = 0.3 * bodyAlpha
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = r * 0.86
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1

    drawSnakeHead(snake, palette, time, isPlayer)

    // 护盾光环：护盾就绪时是青色脉冲环，破碎后的无敌帧内改为高频白色闪烁，
    // 让玩家一眼看出"这次撞击被吃掉了"。
    const shielded = snake.effects.shield > 0
    const gracing = snake.effects.grace > 0
    if (shielded || gracing) {
      ctx.globalCompositeOperation = 'lighter'
      const pulse = 1 + Math.sin(time * (gracing ? 26 : 5)) * (gracing ? 0.14 : 0.06)
      ctx.strokeStyle = gracing ? '#ffffff' : '#8ff4ff'
      ctx.lineWidth = gracing ? 2 : 3
      ctx.globalAlpha = gracing ? 0.9 : 0.85
      ctx.beginPath()
      ctx.arc(snake.x, snake.y, (r * 2.4 + 6) * pulse, 0, TAU)
      ctx.stroke()
      drawGlow(ctx, '#6be8ff', snake.x, snake.y, r * 4.2, gracing ? 0.34 : 0.24)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    if (snake.effects.magnet > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = '#ffb03d'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.2 + 0.12 * Math.sin(time * 3)
      ctx.beginPath()
      ctx.arc(snake.x, snake.y, snake.cfg.foodMagnetRadius * (0.97 + 0.02 * Math.sin(time * 2)), 0, TAU)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  function drawSnakeHead(snake, palette, time, isPlayer) {
    const r = snake.radius
    const cos = Math.cos(snake.angle)
    const sin = Math.sin(snake.angle)
    ctx.globalCompositeOperation = 'lighter'
    drawGlow(ctx, palette.glow, snake.x, snake.y, r * 3.4, snake.boosting ? 0.5 : 0.34)
    if (snake.boosting) {
      // 冲刺尾焰：头后方的锥形加性光，方向与朝向对齐
      drawGlow(ctx, palette.glow, snake.x - cos * r * 2.1, snake.y - sin * r * 2.1, r * 2.6, 0.34)
    }
    ctx.globalCompositeOperation = 'source-over'

    // 沿朝向拉长的头部，比纯圆形有方向感
    ctx.save()
    ctx.translate(snake.x, snake.y)
    ctx.rotate(snake.angle)
    ctx.fillStyle = palette.main
    ctx.beginPath()
    ctx.ellipse(r * 0.12, 0, r * 1.2, r * 1.02, 0, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.ellipse(-r * 0.2, -r * 0.16, r * 0.52, r * 0.42, 0, 0, TAU)
    ctx.fill()
    ctx.restore()

    const eyeFwd = r * 0.5
    const eyeSide = r * 0.54
    const eyeR = Math.max(1.7, r * 0.29)
    for (const s of [-1, 1]) {
      const ex = snake.x + cos * eyeFwd - sin * eyeSide * s
      const ey = snake.y + sin * eyeFwd + cos * eyeSide * s
      ctx.fillStyle = '#f7feff'
      ctx.beginPath()
      ctx.arc(ex, ey, eyeR, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#08131f'
      ctx.beginPath()
      ctx.arc(ex + cos * eyeR * 0.36, ey + sin * eyeR * 0.36, eyeR * 0.52, 0, TAU)
      ctx.fill()
    }

    // 吐信
    const flick = (time * 1.6) % 1
    if (flick < 0.16) {
      const ext = r * (0.9 + 1.1 * Math.sin((flick / 0.16) * Math.PI))
      const tx = snake.x + cos * (r + ext)
      const ty = snake.y + sin * (r + ext)
      ctx.strokeStyle = isPlayer ? '#ff7ad0' : '#ff9d7a'
      ctx.lineWidth = Math.max(1.2, r * 0.14)
      ctx.beginPath()
      ctx.moveTo(snake.x + cos * r * 0.9, snake.y + sin * r * 0.9)
      ctx.lineTo(tx, ty)
      ctx.stroke()
    }

    if (!isPlayer) {
      const fontSize = clamp(11 + r * 0.45, 11, 18)
      ctx.save()
      ctx.font = `500 ${fontSize}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(230,245,255,0.72)'
      ctx.fillText(snake.name, snake.x, snake.y - r * 2.2)
      ctx.restore()
    }
  }

  // ---------------------------------------------------------------- 竞技场

  function drawArena(ctx, world, camera, time) {
    const R = world.arenaRadius
    const t = theme
    const shrinking = world.elapsed > world.cfg.arenaShrinkDelay

    // 内部微光（按主题 + 半径整十位缓存；收缩期间也不会逐帧新建渐变）
    const radiusKey = Math.round(R / 10)
    if (innerThemeId !== t.id || innerRadiusKey !== radiusKey) {
      const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R)
      g.addColorStop(0, 'rgba(255,255,255,0.03)')
      g.addColorStop(0.72, t.ringInner)
      g.addColorStop(1, 'rgba(255,0,0,0)')
      innerGrad = g
      innerThemeId = t.id
      innerRadiusKey = radiusKey
    }
    ctx.fillStyle = innerGrad
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, TAU)
    ctx.fill()

    // 圈外压暗（evenodd：矩形减去圆）
    const b = camera.visibleBounds(viewport, 0, ARENA_BOUNDS)
    ctx.beginPath()
    ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
    ctx.arc(0, 0, R, 0, TAU, true)
    ctx.fillStyle = t.void
    ctx.fill('evenodd')

    // 边界环 + 光晕
    ctx.globalCompositeOperation = 'lighter'
    drawGlow(ctx, t.ring, 0, 0, R * 1.04, shrinking ? 0.16 : 0.1)
    ctx.globalCompositeOperation = 'source-over'

    // 刻度环：一圈"仪表盘"刻度，缓慢自转，收缩时加速 —— 让边界看起来是活的
    // 减少动效时冻结相位：环仍然在（边界必须可见），但不再转。
    const spin = reducedMotion ? 0.6 : time * (shrinking ? 0.24 : 0.07)
    ctx.strokeStyle = t.ring
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 2.4
    ctx.beginPath()
    for (let i = 0; i < RING_TICKS; i++) {
      const a = (i / RING_TICKS) * TAU + spin
      const len = i % 8 === 0 ? 20 : 10
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      ctx.moveTo(ca * (R - len), sa * (R - len))
      ctx.lineTo(ca * (R - 2), sa * (R - 2))
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.strokeStyle = t.ring
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, TAU)
    ctx.stroke()

    // 收缩时的高频闪烁警示 + 向内的一圈"吞噬辉光"
    if (shrinking) {
      // 减少动效：警示必须保留（信息性），但去掉高频闪烁与跑马灯虚线
      const pulse = reducedMotion ? 0.55 : 0.35 + 0.35 * Math.sin(time * 6)
      ctx.globalAlpha = pulse
      ctx.strokeStyle = t.ringWarn
      ctx.lineWidth = 2
      ctx.setLineDash([26, 22])
      ctx.lineDashOffset = reducedMotion ? 0 : -time * 60
      ctx.beginPath()
      ctx.arc(0, 0, R - 14, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = pulse * 0.5
      ctx.strokeStyle = t.ringWarn
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(0, 0, R - 6, 0, TAU)
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalAlpha = 1
  }

  // ---------------------------------------------------------------- 食物与道具

  function drawFood(ctx, world, bounds) {
    const food = world.food
    const colors = theme.food

    // 普通食物：合并为一次填充，避免数百次独立绘制调用
    ctx.beginPath()
    for (let i = world.commonRange[0]; i < world.commonRange[1]; i++) {
      const f = food[i]
      if (!f.alive) continue
      if (f.x < bounds.minX || f.x > bounds.maxX || f.y < bounds.minY || f.y > bounds.maxY) continue
      const pulse = 1 + Math.sin(f.phase) * 0.14
      ctx.moveTo(f.x + f.r * pulse, f.y)
      ctx.arc(f.x, f.y, f.r * pulse, 0, TAU)
    }
    ctx.fillStyle = colors.common
    ctx.fill()

    ctx.globalCompositeOperation = 'lighter'
    ctx.beginPath()
    for (let i = world.commonRange[0]; i < world.commonRange[1]; i++) {
      const f = food[i]
      if (!f.alive) continue
      if (f.x < bounds.minX || f.x > bounds.maxX || f.y < bounds.minY || f.y > bounds.maxY) continue
      const pulse = 1 + Math.sin(f.phase) * 0.14
      ctx.moveTo(f.x + f.r * 2.6 * pulse, f.y)
      ctx.arc(f.x, f.y, f.r * 2.6 * pulse, 0, TAU)
    }
    ctx.globalAlpha = 0.16
    ctx.fillStyle = colors.common
    ctx.fill()
    ctx.globalAlpha = 1

    for (let i = world.goldRange[0]; i < world.gemRange[1]; i++) {
      const f = food[i]
      if (!f.alive) continue
      if (f.x < bounds.minX || f.x > bounds.maxX || f.y < bounds.minY || f.y > bounds.maxY) continue
      const isGem = f.tier === 'gem'
      const color = isGem ? colors.gem : colors.gold
      const pulse = 1 + Math.sin(f.phase * (isGem ? 1.6 : 1.1)) * 0.18
      const bob = Math.sin(f.phase * 0.8) * f.r * 0.35
      drawGlow(ctx, color, f.x, f.y + bob, f.r * (isGem ? 4.6 : 3.8) * pulse, 0.55)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = color
      if (isGem) {
        const s = f.r * pulse
        ctx.save()
        ctx.translate(f.x, f.y + bob)
        ctx.rotate(f.phase * 1.4)
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.lineTo(s * 0.78, 0)
        ctx.lineTo(0, s)
        ctx.lineTo(-s * 0.78, 0)
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 0.5
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.lineTo(s * 0.34, -s * 0.18)
        ctx.lineTo(0, -s * 0.1)
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(f.x, f.y + bob, f.r * pulse, 0, TAU)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.beginPath()
        ctx.arc(f.x - f.r * 0.28, f.y + bob - f.r * 0.28, f.r * 0.34, 0, TAU)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'lighter'
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  function drawPowerups(ctx, world, bounds) {
    for (const p of world.powerups) {
      if (!p.alive) continue
      if (p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY) continue
      const color = POWERUP_COLORS[p.type] || '#ffffff'
      const bob = Math.sin(p.phase) * 4
      const y = p.y + bob
      ctx.globalCompositeOperation = 'lighter'
      drawGlow(ctx, color, p.x, y, p.radius * 2.9, 0.5 + 0.12 * Math.sin(p.phase * 2))
      ctx.globalCompositeOperation = 'source-over'
      ctx.save()
      ctx.translate(p.x, y)
      ctx.rotate(Math.sin(p.phase * 0.8) * 0.25)
      ctx.strokeStyle = color
      ctx.fillStyle = 'rgba(4,10,20,0.72)'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.arc(0, 0, p.radius, 0, TAU)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = color
      ctx.strokeStyle = color
      ctx.lineWidth = 2.2
      const s = p.radius * 0.52
      switch (p.type) {
        case 'shield':
          ctx.beginPath()
          ctx.moveTo(0, -s)
          ctx.lineTo(s, -s * 0.42)
          ctx.lineTo(s * 0.72, s * 0.72)
          ctx.lineTo(0, s)
          ctx.lineTo(-s * 0.72, s * 0.72)
          ctx.lineTo(-s, -s * 0.42)
          ctx.closePath()
          ctx.stroke()
          break
        case 'magnet':
          ctx.beginPath()
          ctx.arc(0, -s * 0.15, s * 0.78, Math.PI, 0)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(-s * 0.78, -s * 0.15)
          ctx.lineTo(-s * 0.78, s * 0.72)
          ctx.moveTo(s * 0.78, -s * 0.15)
          ctx.lineTo(s * 0.78, s * 0.72)
          ctx.stroke()
          break
        case 'slow':
          ctx.beginPath()
          ctx.arc(0, 0, s * 0.9, 0, TAU)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(0, -s * 0.55)
          ctx.moveTo(0, 0)
          ctx.lineTo(s * 0.42, s * 0.18)
          ctx.stroke()
          break
        case 'ghost':
          ctx.beginPath()
          ctx.arc(0, -s * 0.1, s * 0.82, 0, TAU)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(-s * 0.82, -s * 0.1)
          ctx.lineTo(-s * 0.82, s * 0.8)
          ctx.lineTo(-s * 0.27, s * 0.35)
          ctx.lineTo(s * 0.27, s * 0.8)
          ctx.lineTo(s * 0.82, s * 0.35)
          ctx.lineTo(s * 0.82, -s * 0.1)
          ctx.stroke()
          break
        default:
          ctx.font = `500 ${Math.round(s * 1.5)}px system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('×2', 0, 0)
          break
      }
      ctx.restore()
    }
  }

  // ---------------------------------------------------------------- 屏幕特效

  /** 加速时的放射状速度线：从画面中心向外抽，越靠边越亮。 */
  function drawBoostStreaks(ctx, time, intensity) {
    const min = Math.min(viewport.w, viewport.h)
    const cx = viewport.w / 2
    const cy = viewport.h / 2
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#cdf0ff'
    for (let i = 0; i < STREAKS; i++) {
      const seed = (i * 0.618033988749895) % 1
      const a = (i / STREAKS) * TAU + seed * 1.7
      const phase = (time * 1.7 + seed) % 1
      const r0 = min * (0.2 + phase * 0.8)
      const len = min * (0.05 + 0.17 * seed)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.42 * intensity
      ctx.lineWidth = 1 + 1.8 * seed
      ctx.beginPath()
      ctx.moveTo(cx + ca * r0, cy + sa * r0)
      ctx.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  return {
    particles,
    scenery,
    viewport,
    resize,
    setTheme(next) {
      theme = next
      innerThemeId = ''
      scenery.setTheme(next)
    },
    setQuality(level) {
      dprCap = level === 'low' ? 1 : level === 'medium' ? 1.5 : 2
      particles.setLimit(CONFIG.particles[level] ?? CONFIG.particles.high)
      scenery.setQuality(level)
      resize()
    },
    setReducedMotion(value) {
      reducedMotion = !!value
      // 必须一起下发给场景层：环境粒子与装饰摇摆都是"动效"，
      // 只写渲染器自身会漏掉这两层（早期版本的实际缺陷）。
      scenery.setReducedMotion(reducedMotion)
    },
    render(world, camera, time, dt) {
      if (!theme) return
      const bounds = camera.visibleBounds(viewport)

      scenery.drawSky(ctx, camera, viewport, time)
      camera.applyTransform(ctx, viewport)
      scenery.drawFloor(ctx, bounds)
      scenery.drawDecor(ctx, bounds, time)

      drawArena(ctx, world, camera, time)
      drawObstacles(ctx, world, theme, bounds)
      drawFood(ctx, world, bounds)
      drawPowerups(ctx, world, bounds)

      for (let i = 1; i < world.snakes.length; i++) drawSnake(world.snakes[i], time, false)
      drawSnake(world.player, time, true)

      particles.draw(ctx)

      // ---- 屏幕空间 ----
      scenery.drawAmbient(ctx, viewport, time, dt)

      const player = world.player
      if (!reducedMotion && player.alive && player.boosting) {
        ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
        drawBoostStreaks(ctx, time, 1)
      }

      ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
      // 透明度一律走 globalAlpha，颜色字符串在事件发生时就已经合成好，避免逐帧拼接
      if (camera.flash > 0.001) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = camera.flash * 0.22
        ctx.fillStyle = camera.flashColor
        ctx.fillRect(0, 0, viewport.w, viewport.h)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
      const edge = world.edgePressure
      if (edge > 0.02) {
        const pulse = 0.25 + 0.2 * Math.sin(time * 8)
        ctx.globalAlpha = Math.min(1, edge * pulse)
        ctx.strokeStyle = EDGE_PRESSURE_COLOR
        ctx.lineWidth = 26 * edge
        ctx.strokeRect(0, 0, viewport.w, viewport.h)
        ctx.globalAlpha = 1
      }
      scenery.drawVignette(ctx, viewport)
    },
  }
}
