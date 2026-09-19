import { drawGlow } from './glow.js'
import { CONFIG } from '../config.js'
import { TAU } from '../core/math.js'

/**
 * 场景层：天空视差 / 世界地面纹理 / 装饰道具 / 空气粒子 / 暗角。
 *
 * 全部内容都是**运行时程序化生成**的，没有一个外部图片文件。这是刻意的选择：
 *  - 零依赖、零构建、零加载等待（首屏没有一张图要下）；
 *  - 任意 DPR 与任意缩放下都保持锐利，不像位图素材那样放大发虚；
 *  - 与生态配色同源，换主题时天空/地面/装饰一起换，不会出现"素材风格打架"。
 *
 * 所有静态内容（视差瓦片、地面瓦片、装饰精灵）都在 setTheme 时预渲染一次，
 * 逐帧只做 drawImage；热路径上不出现 createRadialGradient / shadowBlur / filter。
 */

const SKY_TILE = 512
const FLOOR_TILE = 512

function createCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function rgba(hex, a) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * 无缝瓦片：先铺一次底色，再把前景内容在 3×3 个偏移上各画一遍。
 *
 * 底色只画一次很关键 —— 早期的写法让底色跟着一起画 9 遍，
 * 半透明底色叠加 9 次后 alpha 从 0.26 涨到 0.93，地面直接变成一块死黑。
 */
function seamlessTile(size, paint, bg) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)
  }
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      ctx.save()
      ctx.translate(ox * size, oy * size)
      paint(ctx, size)
      ctx.restore()
    }
  }
  return canvas
}

// ---------------------------------------------------------------- 天空层

/** 柔和云团/星云：四个生态共用这套形状语言，靠配色拉开差异。 */
function paintNebula(ctx, size, colors) {
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 90 + Math.random() * 190
    const c = colors[Math.floor(Math.random() * colors.length)]
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rgba(c, 0.16))
    g.addColorStop(0.45, rgba(c, 0.06))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }
}

/** 星点 / 浮游微粒。 */
function paintSpecks(ctx, size, color, count, maxR, alpha) {
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 0.35 + Math.random() * maxR
    ctx.globalAlpha = alpha * (0.35 + Math.random() * 0.65)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** 光柱（深海）：倾斜短光带，瓦片重复后形成焦散/耶稣光。 */
function paintShafts(ctx, size, colors) {
  ctx.lineCap = 'round'
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const len = 120 + Math.random() * 200
    const a = Math.PI * 0.32 + (Math.random() - 0.5) * 0.3
    ctx.strokeStyle = rgba(colors[Math.floor(Math.random() * colors.length)], 0.1)
    ctx.lineWidth = 12 + Math.random() * 34
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
}

/** 极光 / 冰雾：横向飘逸的丝带。 */
function paintRibbons(ctx, size, colors) {
  ctx.lineCap = 'round'
  for (let i = 0; i < 8; i++) {
    const y = Math.random() * size
    const amp = 10 + Math.random() * 34
    ctx.strokeStyle = rgba(colors[Math.floor(Math.random() * colors.length)], 0.13)
    ctx.lineWidth = 8 + Math.random() * 30
    ctx.beginPath()
    for (let x = 0; x <= size; x += 16) {
      const yy = y + Math.sin((x / size) * TAU * 2 + i) * amp
      if (x === 0) ctx.moveTo(x, yy)
      else ctx.lineTo(x, yy)
    }
    ctx.stroke()
  }
}

/** 暖色热浪（熔金）：斜向拉长的暖色光斑。 */
function paintHeat(ctx, size, colors) {
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 120 + Math.random() * 200
    const c = colors[Math.floor(Math.random() * colors.length)]
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.4 + Math.random() * 0.2)
    ctx.scale(1.7, 0.7)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, rgba(c, 0.15))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.fill()
    ctx.restore()
  }
}

const SKY_BUILDERS = {
  nebula: (t) => [
    { depth: 0.04, alpha: 0.9, tile: seamlessTile(SKY_TILE, (c, s) => paintNebula(c, s, t.layerColors)) },
    { depth: 0.11, alpha: 0.85, tile: seamlessTile(SKY_TILE, (c, s) => paintSpecks(c, s, t.layerColors[3], 90, 1.4, 0.85)) },
    { depth: 0.22, alpha: 0.6, tile: seamlessTile(SKY_TILE, (c, s) => paintSpecks(c, s, '#ffffff', 46, 0.9, 0.7)) },
  ],
  dunes: (t) => [
    { depth: 0.04, alpha: 0.95, tile: seamlessTile(SKY_TILE, (c, s) => paintHeat(c, s, t.layerColors)) },
    { depth: 0.12, alpha: 0.7, tile: seamlessTile(SKY_TILE, (c, s) => paintSpecks(c, s, t.layerColors[3], 70, 1.6, 0.75)) },
  ],
  deep: (t) => [
    { depth: 0.04, alpha: 0.9, tile: seamlessTile(SKY_TILE, (c, s) => paintNebula(c, s, t.layerColors)) },
    { depth: 0.1, alpha: 0.85, tile: seamlessTile(SKY_TILE, (c, s) => paintShafts(c, s, t.layerColors)) },
    { depth: 0.2, alpha: 0.55, tile: seamlessTile(SKY_TILE, (c, s) => paintSpecks(c, s, t.layerColors[3], 60, 1.2, 0.7)) },
  ],
  aurora: (t) => [
    { depth: 0.04, alpha: 0.9, tile: seamlessTile(SKY_TILE, (c, s) => paintNebula(c, s, t.layerColors)) },
    { depth: 0.1, alpha: 0.8, tile: seamlessTile(SKY_TILE, (c, s) => paintRibbons(c, s, t.layerColors)) },
    { depth: 0.2, alpha: 0.6, tile: seamlessTile(SKY_TILE, (c, s) => paintSpecks(c, s, '#ffffff', 80, 1.3, 0.8)) },
  ],
}

// ---------------------------------------------------------------- 地面纹理

const FLOOR_PAINTERS = {
  /** 六边形网格（霓虹深渊） */
  hex: {
    paint(ctx, size, t) {
      const r = 44
      const w = Math.sqrt(3) * r
      const vStep = 1.5 * r
      const rows = Math.ceil(size / vStep) + 2
      const cols = Math.ceil(size / w) + 2
      ctx.strokeStyle = t.floor.line
      ctx.lineWidth = 1.2
      for (let row = -1; row < rows; row++) {
        for (let col = -1; col < cols; col++) {
          const cx = col * w + (row % 2 ? w / 2 : 0)
          const cy = row * vStep
          ctx.beginPath()
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU - Math.PI / 2
            const px = cx + Math.cos(a) * r
            const py = cy + Math.sin(a) * r
            if (k === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
          ctx.stroke()
        }
      }
    },
  },
  /** 沙纹（熔金峡谷） */
  ripple: {
    paint(ctx, size, t) {
      ctx.strokeStyle = t.floor.line
      ctx.lineWidth = 2
      for (let i = 0; i < 20; i++) {
        const y = (i / 20) * size
        ctx.beginPath()
        for (let x = 0; x <= size; x += 12) {
          const yy = y + Math.sin((x / size) * TAU * 2 + i * 1.7) * 5
          if (x === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
      }
    },
  },
  /** 珊瑚砂（珊瑚礁群） */
  sand: {
    bg: (t) => t.floor.base,
    paint(ctx, size, t) {
      for (let i = 0; i < 130; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const r = 1 + Math.random() * 3.4
        ctx.globalAlpha = 0.08 + Math.random() * 0.3
        ctx.fillStyle = t.floor.line
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    },
  },
  /** 冰裂（冰晶冻原） */
  crack: {
    bg: (t) => t.floor.base,
    paint(ctx, size, t) {
      ctx.strokeStyle = t.floor.line
      ctx.lineWidth = 1.6
      for (let i = 0; i < 14; i++) {
        let x = Math.random() * size
        let y = Math.random() * size
        let a = Math.random() * TAU
        ctx.beginPath()
        ctx.moveTo(x, y)
        for (let k = 0; k < 4; k++) {
          a += (Math.random() - 0.5) * 1.5
          x += Math.cos(a) * (26 + Math.random() * 54)
          y += Math.sin(a) * (26 + Math.random() * 54)
          ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    },
  },
}

function buildFloor(theme) {
  const p = FLOOR_PAINTERS[theme.floorKind] ?? FLOOR_PAINTERS.hex
  return seamlessTile(FLOOR_TILE, (ctx, size) => p.paint(ctx, size, theme), p.bg ? p.bg(theme) : null)
}

// ---------------------------------------------------------------- 装饰道具

/**
 * 装饰精灵：锚点在「底部中心」。
 * 道具是"长在地上"的，以根部为轴摇摆/旋转才不会出现整棵草平移的塑料感。
 */
function buildSprite(kind, colors, variant) {
  const W = 128
  const H = 176
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const bx = W / 2
  const by = H - 6
  const main = colors[variant % colors.length]
  const alt = colors[(variant + 1) % colors.length]

  // 贴地光晕：让道具像"从地里长出来"，而不是贴图浮在空中
  const halo = ctx.createRadialGradient(bx, by, 0, bx, by, 46)
  halo.addColorStop(0, rgba(main, 0.3))
  halo.addColorStop(1, rgba(main, 0))
  ctx.fillStyle = halo
  ctx.fillRect(bx - 48, by - 48, 96, 96)

  if (kind === 'crystal') {
    const h = 74 + variant * 12
    ctx.beginPath()
    ctx.moveTo(bx, by - h)
    ctx.lineTo(bx + 17, by - h * 0.42)
    ctx.lineTo(bx + 11, by)
    ctx.lineTo(bx - 11, by)
    ctx.lineTo(bx - 17, by - h * 0.42)
    ctx.closePath()
    ctx.fillStyle = rgba(main, 0.42)
    ctx.fill()
    ctx.strokeStyle = rgba(main, 0.95)
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx, by - h)
    ctx.lineTo(bx - 17, by - h * 0.42)
    ctx.lineTo(bx - 11, by)
    ctx.lineTo(bx - 3, by)
    ctx.lineTo(bx - 3, by - h * 0.9)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fill()
  } else if (kind === 'pillar') {
    const h = 66 + variant * 16
    const tip = variant % 2 ? 8 : -6
    ctx.beginPath()
    ctx.moveTo(bx - 14, by)
    ctx.lineTo(bx - 11, by - h)
    ctx.lineTo(bx + 9, by - h + tip)
    ctx.lineTo(bx + 15, by)
    ctx.closePath()
    ctx.fillStyle = rgba(main, 0.32)
    ctx.fill()
    ctx.strokeStyle = rgba(alt, 0.8)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx - 11, by - h)
    ctx.lineTo(bx + 9, by - h + tip)
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.stroke()
  } else if (kind === 'kelp') {
    const strands = 2 + (variant % 2)
    ctx.lineCap = 'round'
    ctx.lineWidth = 4.4
    for (let s = 0; s < strands; s++) {
      const h = 70 + variant * 10 + s * 14
      const lean = (s - (strands - 1) / 2) * 20
      ctx.strokeStyle = rgba(s % 2 ? alt : main, 0.72)
      ctx.beginPath()
      for (let k = 0; k <= 10; k++) {
        const t = k / 10
        const x = bx + lean * t + Math.sin(t * 3.4 + s) * 9
        const y = by - h * t
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  } else {
    const spikes = 2 + (variant % 3)
    for (let s = 0; s < spikes; s++) {
      const h = 54 + variant * 13 + s * 16
      const off = (s - (spikes - 1) / 2) * 20
      ctx.beginPath()
      ctx.moveTo(bx + off, by - h)
      ctx.lineTo(bx + off + 12, by)
      ctx.lineTo(bx + off - 12, by)
      ctx.closePath()
      ctx.fillStyle = rgba(s % 2 ? alt : main, 0.3)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
  }
  return { canvas, w: W, h: H, ax: W / 2, ay: H - 6 }
}

// ---------------------------------------------------------------- 主体

export function createScenery() {
  let themeId = ''
  let theme = null
  let skyLayers = []
  let floorTile = null
  let propSprites = []
  const decor = []
  let ambient = []
  let quality = 'high'
  let reducedMotion = false
  /** 实际绘制的装饰条数（≤ decor.length）。装饰按最高画质一次性散布，画质只裁剪绘制量。 */
  let decorLimit = 0
  let skyGrad = null
  let skyGradTheme = ''
  let skyGradW = 0
  let skyGradH = 0
  let vigGrad = null
  let vigW = 0
  let vigH = 0

  function ambientTarget() {
    const key = `ambient${quality[0].toUpperCase()}${quality.slice(1)}`
    return CONFIG.scenery[key] ?? CONFIG.scenery.ambientHigh
  }

  function decorTarget() {
    const key = `decor${quality[0].toUpperCase()}${quality.slice(1)}`
    return CONFIG.scenery[key] ?? CONFIG.scenery.decorHigh
  }

  function seedAmbient() {
    ambient = []
    const n = ambientTarget()
    // 减少动效时干脆不生成：不画的东西不留内存，也让"开关是否真的生效"可被断言
    if (!theme || reducedMotion || n <= 0) return
    for (let i = 0; i < n; i++) {
      ambient.push({
        x: Math.random(),
        y: Math.random(),
        r: 1 + Math.random() * theme.ambient.size,
        vx: (Math.random() - 0.5) * theme.ambient.speed * 0.4,
        vy: theme.ambient.speed * (0.4 + Math.random() * 0.9),
        phase: Math.random() * TAU,
        color: theme.ambient.colors[Math.floor(Math.random() * theme.ambient.colors.length)],
      })
    }
  }

  function build(next) {
    theme = next
    themeId = next.id
    skyLayers = (SKY_BUILDERS[next.scene] ?? SKY_BUILDERS.nebula)(next)
    floorTile = buildFloor(next)
    propSprites = []
    for (let v = 0; v < 4; v++) propSprites.push(buildSprite(next.propKind, next.prop.colors, v))
    skyGrad = null
    vigGrad = null
    decor.length = 0
    decorLimit = 0
    seedAmbient()
  }

  /**
   * 装饰物散布：只做视觉填充、不参与碰撞，因此允许与食物重叠，
   * 但必须避开障碍物（穿模的道具一眼假）与出生点净空。
   *
   * 始终按**最高画质**的数量散布，再由 `decorLimit` 按当前画质裁剪绘制量。
   * 早期版本直接按 `decorTarget()` 散布，导致"画质调低后再调高"时装饰永久变少。
   */
  function scatterDecor(world, rng) {
    decor.length = 0
    const count = CONFIG.scenery.decorHigh
    decorLimit = count
    if (count <= 0 || propSprites.length === 0) return
    const obstacles = world.obstacles
    const R = world.cfg.arenaRadiusStart
    const inner = world.cfg.terrainInnerClear * 0.42
    const inner2 = inner * inner
    const outer2 = R * R * 0.92
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const a = rng.angle()
        const d2 = inner2 + rng.next() * (outer2 - inner2)
        const x = Math.cos(a) * Math.sqrt(d2)
        const y = Math.sin(a) * Math.sqrt(d2)
        let clash = false
        for (let k = 0; k < obstacles.length; k++) {
          const o = obstacles[k]
          const pad = o.r + 15
          const dx = o.x - x
          const dy = o.y - y
          if (dx * dx + dy * dy < pad * pad) {
            clash = true
            break
          }
        }
        if (clash) continue
        decor.push({
          x,
          y,
          sprite: propSprites[rng.int(0, propSprites.length - 1)],
          scale: rng.range(0.42, 0.92),
          sway: rng.range(0.5, 1.4),
          phase: rng.range(0, Math.PI * 2),
          alpha: rng.range(0.6, 1),
        })
        break
      }
    }
    decorLimit = Math.min(decor.length, decorTarget())
  }

  function drawSky(ctx, camera, viewport, time) {
    if (!theme) return
    const dpr = viewport.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 用数值比较代替逐帧拼 key 字符串：热路径零分配
    if (!skyGrad || skyGradTheme !== themeId || skyGradW !== viewport.w || skyGradH !== viewport.h) {
      const g = ctx.createLinearGradient(0, 0, 0, viewport.h)
      g.addColorStop(0, theme.sky[0])
      g.addColorStop(0.5, theme.sky[1])
      g.addColorStop(1, theme.sky[2])
      skyGrad = g
      skyGradTheme = themeId
      skyGradW = viewport.w
      skyGradH = viewport.h
    }
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, viewport.w, viewport.h)

    const twinkle = 0.86 + 0.14 * Math.sin(time * 0.9)
    const cols = Math.ceil(viewport.w / SKY_TILE) + 2
    const rows = Math.ceil(viewport.h / SKY_TILE) + 2
    for (let i = 0; i < skyLayers.length; i++) {
      const L = skyLayers[i]
      const ox = -((((camera.x * L.depth * camera.zoom) % SKY_TILE) + SKY_TILE) % SKY_TILE)
      const oy = -((((camera.y * L.depth * camera.zoom) % SKY_TILE) + SKY_TILE) % SKY_TILE)
      ctx.globalAlpha = L.alpha * twinkle
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.drawImage(L.tile, ox + (c - 1) * SKY_TILE, oy + (r - 1) * SKY_TILE)
        }
      }
    }
    // 层间雾：统一各视差层的色调，避免多层图案互相"打架"
    ctx.fillStyle = theme.haze
    ctx.fillRect(0, 0, viewport.w, viewport.h)
    ctx.globalAlpha = 1
  }

  /** 地面纹理：世界坐标锁定（视差 = 1），跟随相机缩放与平移。 */
  function drawFloor(ctx, bounds) {
    if (!floorTile) return
    const size = FLOOR_TILE
    const x0 = Math.floor(bounds.minX / size) * size
    const y0 = Math.floor(bounds.minY / size) * size
    const cols = Math.ceil((bounds.maxX - x0) / size)
    const rows = Math.ceil((bounds.maxY - y0) / size)
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        ctx.drawImage(floorTile, x0 + c * size, y0 + r * size, size, size)
      }
    }
  }

  /**
   * 装饰道具：按可见范围剔除，以根部为轴轻微摇摆。
   * 摇摆是"动效"，`prefers-reduced-motion` 下保留景物但去掉旋转。
   */
  function drawDecor(ctx, bounds, time) {
    if (decorLimit === 0) return
    const pad = 150
    for (let i = 0; i < decorLimit; i++) {
      const d = decor[i]
      if (d.x < bounds.minX - pad || d.x > bounds.maxX + pad) continue
      if (d.y < bounds.minY - pad || d.y > bounds.maxY + pad) continue
      const sp = d.sprite
      ctx.globalAlpha = d.alpha
      ctx.save()
      ctx.translate(d.x, d.y)
      if (!reducedMotion) ctx.rotate(Math.sin(time * d.sway + d.phase) * 0.055)
      ctx.drawImage(sp.canvas, -sp.ax * d.scale, -sp.ay * d.scale, sp.w * d.scale, sp.h * d.scale)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  /** 空气粒子：屏幕空间飘移，给画面补上"空气感"与纵深。减少动效时整层关闭。 */
  function drawAmbient(ctx, viewport, time, dt) {
    if (reducedMotion || ambient.length === 0) return
    const dpr = viewport.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const A = theme.ambient
    const invW = 1 / Math.max(1, viewport.w)
    const invH = 1 / Math.max(1, viewport.h)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < ambient.length; i++) {
      const p = ambient[i]
      p.y += p.vy * dt * invH
      p.x += (p.vx * dt + Math.sin(time * 0.7 + p.phase) * 0.4) * invW
      if (p.y > 1.04) p.y -= 1.08
      else if (p.y < -0.04) p.y += 1.08
      if (p.x > 1.04) p.x -= 1.08
      else if (p.x < -0.04) p.x += 1.08
      const flicker = 0.55 + 0.45 * Math.sin(time * 1.6 + p.phase)
      drawGlow(ctx, p.color, p.x * viewport.w, p.y * viewport.h, p.r * 3.2, A.alpha * flicker * 0.5)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 暗角：放在最后，让压暗作用在包含蛇与粒子的整幅画面上（早期版本放在第一层，等于没压）。 */
  function drawVignette(ctx, viewport) {
    if (!theme) return
    const dpr = viewport.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!vigGrad || vigW !== viewport.w || vigH !== viewport.h) {
      const g = ctx.createRadialGradient(
        viewport.w / 2,
        viewport.h / 2,
        Math.min(viewport.w, viewport.h) * 0.3,
        viewport.w / 2,
        viewport.h / 2,
        Math.max(viewport.w, viewport.h) * 0.78,
      )
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,0.66)')
      vigGrad = g
      vigW = viewport.w
      vigH = viewport.h
    }
    ctx.fillStyle = vigGrad
    ctx.fillRect(0, 0, viewport.w, viewport.h)
  }

  return {
    get themeId() {
      return themeId
    },
    get decorCount() {
      return decor.length
    },
    /** 实际参与绘制的装饰条数（画质裁剪之后） */
    get decorDrawn() {
      return decorLimit
    },
    /** 空气粒子数量（减少动效时为 0） */
    get ambientCount() {
      return ambient.length
    },
    setTheme(next) {
      if (themeId === next.id && floorTile) return
      build(next)
    },
    /**
     * 画质切换：只影响"画多少"，不影响"画什么"。
     * 装饰与空气粒子都必须在这里跟着变 —— 否则自动降级（正为低端机设计的路径）
     * 对这些层完全无效。
     */
    setQuality(level) {
      quality = level
      decorLimit = Math.min(decor.length, decorTarget())
      seedAmbient()
    },
    setReducedMotion(value) {
      const next = !!value
      if (next === reducedMotion) return
      reducedMotion = next
      // 空气粒子是"动效"，直接撤掉；装饰是"景物"，只去掉摇摆、必须保留
      seedAmbient()
    },
    scatterDecor,
    drawSky,
    drawFloor,
    drawDecor,
    drawAmbient,
    drawVignette,
  }
}
