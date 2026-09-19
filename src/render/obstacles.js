import { drawGlow } from './glow.js'
import { TAU } from '../core/math.js'

/**
 * 障碍物渲染。
 *
 * 早期版本只是"填一个深色多边形 + 描一条细边"，在深色地面上几乎看不出体积。
 * 现在按生态的材质配方分层绘制：
 *
 *   接触阴影 → 受光面 → 本体 → 轮廓 → 高光 → 细节斑点 → 边缘辉光
 *
 * 分两趟（先全部阴影、再全部本体）是必要的：逐块画的话，
 * 后一块岩石的阴影会盖到前一块的受光面上，整片地形会显得脏。
 *
 * 墙体走"折线 + 圆头圆角"描边。这不是为了偷懒 —— 圆头圆角折线的几何
 * 恰好等于沿折线的圆盘并集，与碰撞用的逐节点圆判定完全一致，
 * 因此长墙不需要额外的胶囊碰撞数学，也不会有"看起来没碰到却死了"的偏差。
 */

const LIGHT_X = -0.42
const LIGHT_Y = -0.62

function tracePolygon(ctx, o, scale, ox, oy) {
  const n = o.verts.length
  ctx.beginPath()
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + o.rot
    const rr = o.verts[k] * scale
    const px = o.x + ox + Math.cos(a) * rr
    const py = o.y + oy + Math.sin(a) * rr
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

function traceWall(ctx, path) {
  ctx.beginPath()
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
}

/** 墙体的包围盒懒计算并缓存（墙体是静态的，一局只算一次）。 */
function wallBounds(o) {
  if (o.wb) return o.wb
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of o.path) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  o.wb = { minX, maxX, minY, maxY }
  return o.wb
}

function visible(bounds, minX, maxX, minY, maxY) {
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY)
}

/** 由障碍自身的 tone 派生出的确定性斑点位置（不用随机，避免逐帧闪烁）。 */
function drawSpots(ctx, o, mat) {
  if (o.r < 30) return
  ctx.fillStyle = mat.spot
  const base = o.tone * 6.2831853
  for (let s = 0; s < 2; s++) {
    const a = base + s * 2.399
    const d = o.r * (0.2 + 0.42 * ((o.tone * (s + 3)) % 1))
    const rr = Math.max(1.6, o.r * 0.13)
    ctx.beginPath()
    ctx.arc(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, rr, 0, TAU)
    ctx.fill()
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx 已应用相机变换（世界坐标）
 * @param {object} world
 * @param {object} theme 生态视觉配方
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} bounds 可见世界范围
 */
export function drawObstacles(ctx, world, theme, bounds) {
  const list = world.obstacles
  if (list.length === 0) return
  const mat = theme.obstacle
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // ---- 1. 接触阴影 ----
  ctx.fillStyle = mat.shadow
  ctx.strokeStyle = mat.shadow
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o.kind === 'wall') {
      if (o.step !== 0) continue
      const wb = wallBounds(o)
      if (!visible(bounds, wb.minX - o.r, wb.maxX + o.r, wb.minY - o.r, wb.maxY + o.r)) continue
      ctx.save()
      ctx.translate(o.r * 0.2, o.r * 0.34)
      traceWall(ctx, o.path)
      ctx.lineWidth = o.r * 2
      ctx.stroke()
      ctx.restore()
      continue
    }
    if (!visible(bounds, o.x - o.r, o.x + o.r, o.y - o.r, o.y + o.r)) continue
    tracePolygon(ctx, o, 0.97, o.r * 0.2, o.r * 0.32)
    ctx.fill()
  }

  // ---- 2. 墙体：受光面 → 本体 → 轮廓 → 顶面高光 ----
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o.kind !== 'wall' || o.step !== 0) continue
    const wb = wallBounds(o)
    if (!visible(bounds, wb.minX - o.r, wb.maxX + o.r, wb.minY - o.r, wb.maxY + o.r)) continue
    ctx.save()
    ctx.translate(LIGHT_X * o.r * 0.34, LIGHT_Y * o.r * 0.34)
    traceWall(ctx, o.path)
    ctx.strokeStyle = mat.lit
    ctx.lineWidth = o.r * 1.94
    ctx.stroke()
    ctx.restore()

    traceWall(ctx, o.path)
    ctx.strokeStyle = mat.body
    ctx.lineWidth = o.r * 2
    ctx.stroke()

    ctx.globalAlpha = 0.4
    ctx.strokeStyle = mat.edge
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.save()
    ctx.translate(LIGHT_X * o.r * 0.3, LIGHT_Y * o.r * 0.3)
    traceWall(ctx, o.path)
    ctx.strokeStyle = mat.rim
    ctx.lineWidth = o.r * 0.46
    ctx.globalAlpha = 0.5
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.restore()
  }

  // ---- 3. 岩石/珊瑚/晶体：受光面 → 本体 → 轮廓 → 斑点 ----
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o.kind === 'wall') continue
    if (!visible(bounds, o.x - o.r, o.x + o.r, o.y - o.r, o.y + o.r)) continue

    tracePolygon(ctx, o, 0.66, LIGHT_X * o.r * 0.3, LIGHT_Y * o.r * 0.3)
    ctx.fillStyle = mat.lit
    ctx.fill()

    tracePolygon(ctx, o, 1, 0, 0)
    ctx.fillStyle = mat.body
    ctx.fill()

    if (o.kind === 'prism') {
      // 冰棱：把每个长顶点连到中心，形成清晰的多面体切面
      const n = o.verts.length
      ctx.strokeStyle = mat.edge
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let k = 0; k < n; k += 2) {
        const a = (k / n) * TAU + o.rot
        ctx.moveTo(o.x, o.y)
        ctx.lineTo(o.x + Math.cos(a) * o.verts[k], o.y + Math.sin(a) * o.verts[k])
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    tracePolygon(ctx, o, 1, 0, 0)
    ctx.strokeStyle = mat.edge
    ctx.globalAlpha = 0.78
    ctx.lineWidth = 2.4
    ctx.stroke()
    ctx.globalAlpha = 1

    drawSpots(ctx, o, mat)
  }

  // ---- 4. 边缘辉光（加性），只有配方里开了辉光的生态才走这一步 ----
  if (mat.glowAlpha > 0.01) {
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      if (o.kind === 'wall' && o.step !== 0) continue
      if (!visible(bounds, o.x - o.r * 2, o.x + o.r * 2, o.y - o.r * 2, o.y + o.r * 2)) continue
      drawGlow(ctx, mat.glow, o.x, o.y, o.r * 1.9, mat.glowAlpha)
    }
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** 小地图上的地形：折线墙体画成线段，多边形障碍画成实心块。 */
export function drawTerrainMini(ctx, world, theme, cx, cy, scale) {
  const list = world.obstacles
  ctx.fillStyle = theme.obstacle.edge
  ctx.strokeStyle = theme.obstacle.edge
  ctx.globalAlpha = 0.5
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o.kind === 'wall') {
      if (o.step !== 0) continue
      ctx.beginPath()
      for (let k = 0; k < o.path.length; k++) {
        const p = o.path[k]
        if (k === 0) ctx.moveTo(cx + p.x * scale, cy + p.y * scale)
        else ctx.lineTo(cx + p.x * scale, cy + p.y * scale)
      }
      ctx.lineWidth = Math.max(1.4, o.r * 2 * scale)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      continue
    }
    ctx.beginPath()
    ctx.arc(cx + o.x * scale, cy + o.y * scale, Math.max(1, o.r * scale), 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
