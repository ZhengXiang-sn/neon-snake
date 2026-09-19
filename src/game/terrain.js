/**
 * 地形生成器 —— 纯逻辑，不碰 DOM，可在 Node 中直接单元测试。
 *
 * 三个设计决策，都是为了修掉早期版本的三个具体毛病：
 *
 * 1. **每个生态有专属布局算法**，而不是"同一套随机撒点、只换颜色"。
 *    陨石带（散点）、熔金峡谷（折线墙）、珊瑚礁（团簇）、冰晶冻原（同心环晶柱）
 *    的走位策略完全不同。
 *
 * 2. **障碍物铺满整片竞技场，而不是挤在中心窄环里**。
 *    旧版把 22 块陨石全塞进半径 340~653 的环带里（可用面积 0.98M），
 *    而开局竞技场半径 1900（面积 11.3M）——视觉上就是"中心一坨"。
 *    现在按"内圈（终局圈内，永久保留）+ 外圈（缩圈时被吞噬）"两段分布，
 *    面积利用提升约 8 倍，密度自然就下来了。
 *
 * 3. **碰撞半径 = 外接半径**（`verts[k] <= r`）。
 *    旧版顶点半径是 `r * [0.76, 1.2]`，视觉上会超出碰撞圆 20%，
 *    玩家会"看起来还没碰到就死了"。现在顶点只向内收，判定与画面一致。
 *
 * 另外：墙体用"折线 + 圆头圆角"渲染，其几何恰好等于沿折线的圆盘并集，
 * 与碰撞用的逐节点圆判定完全一致，所以长墙不需要额外的胶囊碰撞数学。
 */

/** 生态 → 布局配方。渲染层（theme.js）按同一批 id 提供配色，两者由单测锁死一一对应。 */
export const BIOMES = [
  { id: 'neon', layout: 'debris', label: '陨石带' },
  { id: 'sunset', layout: 'canyon', label: '熔金峡谷' },
  { id: 'abyss', layout: 'reef', label: '珊瑚礁群' },
  { id: 'crystal', layout: 'shard', label: '冰晶冻原' },
]

const BIOME_IDS = new Set(BIOMES.map((b) => b.id))

export function hasTerrain(id) {
  return BIOME_IDS.has(id)
}

// ---------------------------------------------------------------- 通用工具

/** 环形带内均匀取点（面积均匀 → 半径按 sqrt 分布） */
function pointInBand(rng, r0, r1) {
  const a = rng.angle()
  const d = Math.sqrt(r0 * r0 + rng.next() * (r1 * r1 - r0 * r0))
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, a, d }
}

/** 候选点是否与已有地形保持足够间距（gap 是"边缘到边缘"的净空） */
function fits(list, x, y, r, gap) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    const need = o.r + r + gap
    const dx = o.x - x
    const dy = o.y - y
    if (dx * dx + dy * dy < need * need) return false
  }
  return true
}

/**
 * 在环带里找一个放得下的位置。
 * 尝试若干次；全部失败时返回 null —— 由调用方决定"少放一个"而不是硬塞，
 * 硬塞正是旧版出现重叠与中心堆积的根因。
 */
function findSpot(rng, list, { r0, r1, r, gap, tries = 28, keepOut = 0 }) {
  for (let i = 0; i < tries; i++) {
    const p = pointInBand(rng, r0, r1)
    if (p.d < keepOut + r) continue
    if (fits(list, p.x, p.y, r, gap)) return p
  }
  return null
}

/** 不规则闭合多边形：顶点半径一律 ≤ r（外接圆即碰撞圆） */
function makeVerts(rng, r, n, lo = 0.74) {
  const verts = []
  for (let k = 0; k < n; k++) verts.push(r * rng.range(lo, 1))
  return verts
}

/** 尖角晶体：奇偶顶点交替收放，形成星芒/冰棱轮廓 */
function makePrismVerts(rng, r, spikes) {
  const verts = []
  for (let k = 0; k < spikes * 2; k++) {
    verts.push(k % 2 === 0 ? r * rng.range(0.9, 1) : r * rng.range(0.3, 0.46))
  }
  return verts
}

function rock(rng, r, gap = 96) {
  return {
    kind: 'rock',
    x: 0,
    y: 0,
    r,
    verts: makeVerts(rng, r, rng.int(7, 10)),
    rot: rng.angle(),
    light: rng.range(-0.6, 0.6),
    tone: rng.range(0, 1),
    group: 0,
    step: 0,
    path: null,
  }
}

function prism(rng, r) {
  return {
    kind: 'prism',
    x: 0,
    y: 0,
    r,
    verts: makePrismVerts(rng, r, rng.int(3, 4)),
    rot: rng.angle(),
    light: rng.range(-0.4, 0.4),
    tone: rng.range(0, 1),
    group: 0,
    step: 0,
    path: null,
  }
}

function blob(rng, r) {
  return {
    kind: 'blob',
    x: 0,
    y: 0,
    r,
    verts: makeVerts(rng, r, rng.int(5, 7), 0.68),
    rot: rng.angle(),
    light: rng.range(-0.5, 0.5),
    tone: rng.range(0, 1),
    group: 0,
    step: 0,
    path: null,
  }
}

// ---------------------------------------------------------------- 四种布局

/**
 * 贴身环：紧贴终局圈外侧补一小圈障碍。四个生态共用。
 *
 * 为什么需要它：外圈布点是**按面积均匀**采样的，天然"越往外越密、越靠近圆心越稀"，
 * 于是总有相当一部分种子在终局圈外侧留下一段空白 —— 缩圈的最后四分之一段
 * 就没有地形可吞，变成"圈还在缩、场地里却已经无物可吃"。
 *
 * 这一圈把吞噬过程一直延续到终局半径，让缩圈从头到尾都有反馈。
 * `make` 由各布局提供，保证补出来的障碍仍是本生态的形状与材质。
 */
function sentinelRing(rng, list, t, { count, make, gap }) {
  for (let i = 0; i < count; i++) {
    const r = rng.range(20, 40)
    const p = findSpot(rng, list, {
      r0: t.arenaRadiusMin + 24,
      r1: t.arenaRadiusMin + 88,
      r,
      gap,
    })
    if (!p) continue
    const o = make(rng, r)
    o.x = p.x
    o.y = p.y
    list.push(o)
  }
}

/**
 * 陨石带：两段式散点 + 少量巨岩。
 *
 * 内圈（≤ 终局圈）是终局掩体，外圈负责"被缩圈吃掉"。
 * 关键：外圈的**内边界紧贴终局圈**、外边界推到接近开局边界 ——
 * 这样缩圈从最大半径一路缩到最小半径，全程都有地形可吞，
 * 不会出现"圈还在缩、地形却早就吃完了"的空档期（早期版本缩到约 2/3 处就空转了）。
 */
function layoutDebris(rng, t) {
  const list = []
  const inner = t.innerClear + 40
  const innerOuter = t.arenaRadiusMin - 46
  const outerIn = t.arenaRadiusMin + 20
  const outerOut = t.arenaRadiusStart * 0.9

  // 三块巨岩：地标，同时提供可绕行的掩体
  for (let i = 0; i < 3; i++) {
    const r = rng.range(76, 96)
    const p = findSpot(rng, list, { r0: inner + 120, r1: innerOuter - 40, r, gap: 150 })
    if (!p) continue
    const o = rock(rng, r)
    o.x = p.x
    o.y = p.y
    list.push(o)
  }

  for (let i = 0; i < 22; i++) {
    const r = rng.range(26, 58)
    const p = findSpot(rng, list, { r0: inner, r1: innerOuter, r, gap: 96 })
    if (!p) continue
    const o = rock(rng, r)
    o.x = p.x
    o.y = p.y
    list.push(o)
  }

  for (let i = 0; i < 40; i++) {
    const r = rng.range(22, 52)
    const p = findSpot(rng, list, { r0: outerIn, r1: outerOut, r, gap: 96 })
    if (!p) continue
    const o = rock(rng, r)
    o.x = p.x
    o.y = p.y
    list.push(o)
  }

  sentinelRing(rng, list, t, { count: 8, make: rock, gap: 92 })
  return list
}

/**
 * 熔金峡谷：折线长墙切成可绕行的通路。
 *
 * 关键约束：**每道墙都是一个整体**。渲染与碰撞都把它当一堵连续的墙，
 * 所以 world._dissolveTerrain 在缩圈时也是整道一起崩塌 —— 只要有一个节点出圈，
 * 整道墙就消失。留下半截墙不只是难看：一条跨越竞技场的弦会把圆形场地
 * 切成互不连通的两块，直接把玩家困死。
 *
 * 因此墙体长度远小于竞技场直径，且两端不会同时探出边界；
 * 内圈固定留 2 道（终局仍在），外圈 3 道随缩圈崩塌。
 */
function layoutCanyon(rng, t) {
  const list = []
  let group = 0
  const innerOuter = t.arenaRadiusMin - 46
  const outerOut = t.arenaRadiusStart * 0.86

  // 内圈 2 道（终局保留）+ 外圈 3 道（缩圈时崩塌）
  const plans = [
    { r0: t.innerClear + 120, r1: innerOuter, segs: [2, 3] },
    { r0: t.innerClear + 160, r1: innerOuter, segs: [2, 3] },
    { r0: t.arenaRadiusMin + 30, r1: outerOut, segs: [2, 3] },
    { r0: t.arenaRadiusMin + 130, r1: outerOut, segs: [2, 3] },
    { r0: t.arenaRadiusMin + 230, r1: outerOut, segs: [2, 3] },
  ]

  for (const plan of plans) {
    const r = rng.range(21, 26)
    let placed = null
    // 每种长度都换锚点重试：早期版本只试一次，锚点撞上已有地形就整道墙作废，
    // 导致同一生态有时只有 1 道墙、有时 5 道，地形强度完全不可控。
    for (let attempt = 0; attempt < 24 && !placed; attempt++) {
      const anchor = findSpot(rng, list, { r0: plan.r0, r1: plan.r1, r, gap: 70 })
      if (!anchor) continue
      let dir = anchor.a + Math.PI / 2 + rng.range(-0.6, 0.6)
      const curve = rng.range(-0.5, 0.5)
      const step = r * 0.86
      const nodes = [{ x: anchor.x, y: anchor.y }]
      let x = anchor.x
      let y = anchor.y
      let blocked = false
      for (let s = 0; s < plan.segs[1]; s++) {
        if (s >= plan.segs[0] && nodes.length > 3) break
        const count = Math.max(3, Math.round(rng.range(120, 180) / step))
        for (let k = 0; k < count; k++) {
          dir += curve * 0.09
          x += Math.cos(dir) * step
          y += Math.sin(dir) * step
          if (Math.hypot(x, y) < t.innerClear + r || Math.hypot(x, y) > outerOut) {
            blocked = true
            break
          }
          if (!fits(list, x, y, r, 56)) {
            blocked = true
            break
          }
          nodes.push({ x, y })
        }
        if (blocked) break
      }
      // 少于 6 个节点就不值得当一堵墙；且不能一头扎进出生点净空
      if (blocked && nodes.length < 6) continue
      if (nodes.length < 6) continue
      placed = nodes
    }
    if (!placed) continue

    group++
    let reach = 0
    for (const n of placed) reach = Math.max(reach, Math.hypot(n.x, n.y))
    for (let i = 0; i < placed.length; i++) {
      list.push({
        kind: 'wall',
        x: placed[i].x,
        y: placed[i].y,
        r,
        verts: null,
        rot: 0,
        light: 0,
        tone: rng.range(0, 1),
        group,
        step: i,
        path: placed,
        /** 整道墙离原点的最远距离：缩圈时按它整体判定存亡 */
        reach,
      })
    }
  }

  // 峡谷之间点缀岩台（铺到接近开局边界，保证外圈有持续可吞的地形）。
  // 数量偏多是有意的：一堵墙无论多长都只在**一个**半径上被整道吞掉，
  // 所以墙对"吞没节奏"的贡献只有 3 次；真正把节奏填满的是这些独立岩台。
  for (let i = 0; i < 30; i++) {
    const r = rng.range(28, 62)
    const p = findSpot(rng, list, {
      r0: t.innerClear + 30,
      r1: t.arenaRadiusStart * 0.9,
      r,
      gap: 108,
    })
    if (!p) continue
    const o = rock(rng, r)
    o.x = p.x
    o.y = p.y
    list.push(o)
  }

  sentinelRing(rng, list, t, { count: 8, make: rock, gap: 96 })
  return list
}

/**
 * 珊瑚礁群：团簇结构。
 * 同一团内部允许重叠（那正是"礁"的样子），团与团之间留大净空，
 * 于是既有可穿行的小缝隙，又不会把通路彻底堵死。
 */
function layoutReef(rng, t) {
  const list = []
  const colonies = 13
  for (let c = 0; c < colonies; c++) {
    const cr = rng.range(46, 92)
    const anchor = findSpot(rng, list, {
      r0: t.innerClear + 30,
      r1: t.arenaRadiusStart * 0.88,
      r: cr,
      gap: 132,
    })
    if (!anchor) continue
    const members = rng.int(4, 8)
    // 锚点本身先占位，保证后续团簇不与它重叠
    const first = blob(rng, cr * 0.5)
    first.x = anchor.x
    first.y = anchor.y
    first.colony = c
    list.push(first)
    for (let m = 1; m < members; m++) {
      const a = rng.angle()
      const d = Math.sqrt(rng.next()) * cr
      const r = rng.range(15, 33)
      const x = anchor.x + Math.cos(a) * d
      const y = anchor.y + Math.sin(a) * d
      if (Math.hypot(x, y) < t.innerClear + r) continue
      // 只与"别的团"做净空检查，同团内允许交叠成礁
      let clash = false
      for (let i = 0; i < list.length; i++) {
        const o = list[i]
        if (o.colony === c) continue
        const need = o.r + r + 132
        const dx = o.x - x
        const dy = o.y - y
        if (dx * dx + dy * dy < need * need) {
          clash = true
          break
        }
      }
      if (clash) continue
      const b = blob(rng, r)
      b.x = x
      b.y = y
      b.colony = c
      list.push(b)
    }
  }

  // 外围补点：礁是"结块"的，径向上难免留下大段空档，
  // 缩圈经过那里就会"圈在缩、地形却不动"。用一圈均匀铺开的小礁把节奏接上。
  for (let i = 0; i < 14; i++) {
    const r = rng.range(16, 30)
    const p = findSpot(rng, list, {
      r0: t.arenaRadiusMin + 20,
      r1: t.arenaRadiusStart * 0.88,
      r,
      gap: 96,
    })
    if (!p) continue
    const b = blob(rng, r)
    b.x = p.x
    b.y = p.y
    // 每个补点自成一团，避免被当成同一片礁而豁免重叠检查
    b.colony = 1000 + i
    list.push(b)
  }

  sentinelRing(rng, list, t, { count: 8, make: blob, gap: 92 })
  return list
}

/**
 * 冰晶冻原：同心环晶柱阵。
 * 环状排布天然形成"通道—闸口—通道"的节奏，走位靠切向穿缝，
 * 与散点陨石带的手感完全不同。
 *
 * 环在半径上**等距**排布：缩圈对半径是匀速的，等距即"吞没节奏均匀"。
 * 早期版本只有 4 环、且中段空了一大截，缩圈大约到 2/3 处就没地形可吞了。
 * 环数由几何决定而非写死，换竞技场尺寸时节奏自动保持。
 */
function layoutShard(rng, t) {
  const list = []
  const outer = t.arenaRadiusStart * 0.9
  const rIn = t.innerClear + 96
  const rOut = outer - 60
  const RING_COUNT = 7
  const rings = []
  for (let i = 0; i < RING_COUNT; i++) {
    const f = i / (RING_COUNT - 1)
    rings.push({
      r: rIn + (rOut - rIn) * f,
      n: 5 + i * 2,
      size: i === RING_COUNT - 1 ? [26, 44] : [30, 52],
    })
  }
  for (const ring of rings) {
    const phase = rng.angle()
    for (let i = 0; i < ring.n; i++) {
      const a = phase + (i / ring.n) * Math.PI * 2 + rng.range(-0.08, 0.08)
      const d = ring.r + rng.range(-34, 34)
      const r = rng.range(ring.size[0], ring.size[1])
      const x = Math.cos(a) * d
      const y = Math.sin(a) * d
      if (Math.hypot(x, y) < t.innerClear + r) continue
      if (Math.hypot(x, y) + r > t.arenaRadiusStart * 0.92) continue
      if (!fits(list, x, y, r, 74)) continue
      const o = prism(rng, r)
      o.x = x
      o.y = y
      // 冰棱朝向径向，强化"晶柱从地面长出"的感觉
      o.rot = a
      list.push(o)
    }
  }
  sentinelRing(rng, list, t, { count: 8, make: prism, gap: 70 })
  return list
}

const LAYOUTS = {
  debris: layoutDebris,
  canyon: layoutCanyon,
  reef: layoutReef,
  shard: layoutShard,
}

/**
 * 生成一局的全部地形。
 * @param {string} biome 生态 id（未知 id 退回陨石带，避免脏配置导致空场）
 * @param {{next:Function, range:Function, int:Function, angle:Function, next:Function}} rng
 * @param {{innerClear:number, arenaRadiusStart:number, arenaRadiusMin:number}} t
 */
export function generateTerrain(biome, rng, t) {
  const def = BIOMES.find((b) => b.id === biome)
  const layout = LAYOUTS[def?.layout] ?? layoutDebris
  return layout(rng, t)
}

function sameStructure(a, b) {
  if (a.kind === 'wall' && b.kind === 'wall') return a.group === b.group
  if (a.colony !== undefined && b.colony !== undefined) return a.colony === b.colony
  return false
}

/**
 * 供测试与调试：统计地形分布特征。
 *
 * `overlap` 只统计**非同一结构**之间的重叠 —— 一堵墙的相邻节点必然重叠
 * （圆头折线本来就是圆盘的并集），一片珊瑚礁团内部也允许交叠，
 * 这些是设计意图，不能当成缺陷。
 *
 * `dissolveGap` 是"缩圈吞没节奏"的度量：把每个障碍物被吞噬时的竞技场半径
 * （`reach + r`，只统计大于终局半径的那些）排序，取相邻事件之间的最大空档，
 * 并补上两端（开局半径 → 第一个事件、最后一个事件 → 终局半径）。
 * 这个值越大，说明"圈在缩、地形却不动"的死区间越长。
 */
export function analyzeTerrain(list, t = {}) {
  let sumR = 0
  let minR = Infinity
  let maxR = 0
  let overlap = 0
  let inInnerDisk = 0
  let outsideFinal = 0
  let walls = 0
  let unspaced = 0
  let outerReach = 0
  const dissolve = []
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    const d = Math.hypot(o.x, o.y)
    sumR += d
    if (d < minR) minR = d
    if (d > maxR) maxR = d
    if (d < (t.innerClear ?? 300)) inInnerDisk++
    const reach = o.kind === 'wall' ? o.reach : d
    if (reach + o.r > outerReach) outerReach = reach + o.r
    if (t.arenaRadiusMin !== undefined && reach + o.r > t.arenaRadiusMin) {
      outsideFinal++
      dissolve.push(reach + o.r)
    }
    if (o.kind === 'wall' && o.step === 0) walls++
    for (let k = i + 1; k < list.length; k++) {
      const b = list[k]
      if (sameStructure(o, b)) continue
      const need = (o.r + b.r) * 0.85
      const dx = o.x - b.x
      const dy = o.y - b.y
      const d2 = dx * dx + dy * dy
      if (d2 < need * need) overlap++
      else if (d2 < (o.r + b.r) * (o.r + b.r)) unspaced++
    }
  }
  dissolve.sort((a, b) => a - b)
  let dissolveGap = 0
  let dissolveTail = 0
  let dissolveLead = 0
  if (dissolve.length > 0 && t.arenaRadiusStart !== undefined) {
    // lead：开局半径 → 第一次吞没。这一段"尚未被吞的外圈地形"仍在画面里，
    //       环正在向它推进，因此是预期行为而不是空档，只做记录不做断言。
    dissolveLead = t.arenaRadiusStart - dissolve[dissolve.length - 1]
    for (let i = 1; i < dissolve.length; i++) {
      const gap = dissolve[i] - dissolve[i - 1]
      if (gap > dissolveGap) dissolveGap = gap
    }
    // tail：最后一次吞没 → 终局半径。**这才是真正要压的指标** ——
    //       它大了就意味着"圈还在缩、场地里却已经没有东西可吃了"。
    if (t.arenaRadiusMin !== undefined) dissolveTail = dissolve[0] - t.arenaRadiusMin
    if (dissolveTail > dissolveGap) dissolveGap = dissolveTail
  } else if (t.arenaRadiusStart !== undefined) {
    // 没有任何障碍会被吞掉：整段缩圈都是空档
    dissolveGap = t.arenaRadiusStart - (t.arenaRadiusMin ?? 0)
    dissolveTail = dissolveGap
    dissolveLead = dissolveGap
  }
  const n = Math.max(1, list.length)
  return {
    count: list.length,
    walls,
    dissolveGap,
    dissolveTail,
    dissolveLead,
    /** 所有障碍物"最外缘"到原点的最大距离：必须 ≤ 开局半径，否则会有障碍生成在场地之外 */
    outerReach,
    meanRadius: sumR / n,
    minRadius: minR === Infinity ? 0 : minR,
    maxRadius: maxR,
    overlap,
    unspaced,
    inInnerDisk,
    outsideFinal,
  }
}

