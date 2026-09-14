import { drawGlow } from './glow.js'
import { createBackground } from './background.js'
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

/**
 * 世界渲染器。
 * 分层顺序：背景 → 竞技场 → 障碍 → 食物 → 道具 → 蛇 → 粒子 → 屏幕特效。
 * 发光一律走"预渲染精灵 + 加性混合"，热路径上不出现 shadowBlur / filter / 新建渐变。
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false })
  const background = createBackground()
  const particles = createParticles(CONFIG.particles.high)
  const viewport = { w: 1, h: 1, dpr: 1 }
  let theme = null
  let dprCap = 2
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

    // 1) 加性发光层
    ctx.globalCompositeOperation = 'lighter'
    traceSnakeBody(snake, time, true)
    ctx.globalAlpha = (snake.boosting ? 0.3 : 0.17) * bodyAlpha
    ctx.strokeStyle = palette.glow
    ctx.lineWidth = r * 3.1
    ctx.stroke()
    ctx.globalAlpha = (snake.boosting ? 0.36 : 0.24) * bodyAlpha
    ctx.lineWidth = r * 2.1
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = bodyAlpha

    // 2) 主体
    traceSnakeBody(snake, time, true)
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
    ctx.globalCompositeOperation = 'source-over'

    ctx.fillStyle = palette.main
    ctx.beginPath()
    ctx.arc(snake.x, snake.y, r * 1.06, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    ctx.arc(snake.x - cos * r * 0.2, snake.y - sin * r * 0.2, r * 0.5, 0, TAU)
    ctx.fill()

    const eyeFwd = r * 0.48
    const eyeSide = r * 0.52
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

  function drawArena(ctx, world, camera, time) {
    const R = world.arenaRadius
    const themeUi = theme

    // 内部微光（按主题 + 半径整十位缓存；收缩期间也不会逐帧新建渐变）
    const radiusKey = Math.round(R / 10)
    if (innerThemeId !== themeUi.id || innerRadiusKey !== radiusKey) {
      const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R)
      g.addColorStop(0, 'rgba(255,255,255,0.028)')
      g.addColorStop(0.72, themeUi.ringInner)
      g.addColorStop(1, 'rgba(255,0,0,0)')
      innerGrad = g
      innerThemeId = themeUi.id
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
    ctx.fillStyle = themeUi.void
    ctx.fill('evenodd')

    // 边界环 + 光晕
    ctx.globalCompositeOperation = 'lighter'
    drawGlow(ctx, themeUi.ring, 0, 0, R * 1.03, 0.1)
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = themeUi.ring
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, TAU)
    ctx.stroke()

    // 收缩时的高频闪烁警示
    const shrinking = world.elapsed > world.cfg.arenaShrinkDelay
    if (shrinking) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 6)
      ctx.strokeStyle = themeUi.ringWarn
      ctx.lineWidth = 2
      ctx.setLineDash([26, 22])
      ctx.lineDashOffset = -time * 60
      ctx.beginPath()
      ctx.arc(0, 0, R - 14, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
  }

  function drawObstacles(ctx, world, bounds) {
    const list = world.obstacles
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      if (o.x + o.r < bounds.minX || o.x - o.r > bounds.maxX) continue
      if (o.y + o.r < bounds.minY || o.y - o.r > bounds.maxY) continue
      const n = o.verts.length
      ctx.beginPath()
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU
        const rr = o.verts[k]
        ctx[k === 0 ? 'moveTo' : 'lineTo'](o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fillStyle = theme.obstacle
      ctx.fill()
      ctx.strokeStyle = theme.obstacleEdge
      ctx.lineWidth = 2.5
      ctx.globalAlpha = 0.75
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

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
      drawGlow(ctx, color, f.x, f.y, f.r * (isGem ? 4.6 : 3.8) * pulse, 0.55)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = color
      if (isGem) {
        const s = f.r * pulse
        const rot = f.phase * 1.4
        ctx.save()
        ctx.translate(f.x, f.y)
        ctx.rotate(rot)
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.lineTo(s * 0.78, 0)
        ctx.lineTo(0, s)
        ctx.lineTo(-s * 0.78, 0)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r * pulse, 0, TAU)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.beginPath()
        ctx.arc(f.x - f.r * 0.28, f.y - f.r * 0.28, f.r * 0.34, 0, TAU)
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

  return {
    particles,
    viewport,
    resize,
    setTheme(next) {
      theme = next
      innerThemeId = ''
      background.setTheme(next)
    },
    setQuality(level) {
      dprCap = level === 'low' ? 1 : level === 'medium' ? 1.5 : 2
      particles.setLimit(CONFIG.particles[level] ?? CONFIG.particles.high)
      resize()
    },
    render(world, camera, time) {
      if (!theme) return
      background.draw(ctx, camera, viewport, theme)
      camera.applyTransform(ctx, viewport)
      const bounds = camera.visibleBounds(viewport)

      drawArena(ctx, world, camera, time)
      drawObstacles(ctx, world, bounds)
      drawFood(ctx, world, bounds)
      drawPowerups(ctx, world, bounds)

      for (let i = 1; i < world.snakes.length; i++) drawSnake(world.snakes[i], time, false)
      drawSnake(world.player, time, true)

      particles.draw(ctx)

      // 屏幕空间特效
      ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
      if (camera.flash > 0.001) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = `rgba(${camera.flashColor},${camera.flash * 0.22})`
        ctx.fillRect(0, 0, viewport.w, viewport.h)
        ctx.globalCompositeOperation = 'source-over'
      }
      const edge = world.edgePressure
      if (edge > 0.02) {
        const pulse = 0.25 + 0.2 * Math.sin(time * 8)
        ctx.strokeStyle = `rgba(255,70,100,${edge * pulse})`
        ctx.lineWidth = 26 * edge
        ctx.strokeRect(0, 0, viewport.w, viewport.h)
      }
    },
  }
}
