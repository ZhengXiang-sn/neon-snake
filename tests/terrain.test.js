import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BIOMES, hasTerrain, generateTerrain, analyzeTerrain } from '../src/game/terrain.js'
import { THEMES, THEME_LIST } from '../src/render/theme.js'
import { createGameConfig } from '../src/config.js'
import { createRng } from '../src/core/rng.js'

const cfg = createGameConfig({ difficulty: 'normal' })
const T = {
  innerClear: cfg.terrainInnerClear,
  arenaRadiusStart: cfg.arenaRadiusStart,
  arenaRadiusMin: cfg.arenaRadiusMin,
}

function samples(biome, n = 30) {
  const out = []
  for (let s = 1; s <= n; s++) out.push(analyzeTerrain(generateTerrain(biome, createRng(s * 7919), T), T))
  return out
}

// ---------------------------------------------------------------- 生态配对

test('每个生态都有配色配方，每个配色配方都有地形布局（一一对应）', () => {
  for (const t of THEME_LIST) {
    assert.ok(hasTerrain(t.id), `主题 ${t.id} 缺少地形布局 —— 会出现"换了配色但地形没换"`)
  }
  for (const b of BIOMES) {
    assert.ok(THEMES[b.id], `地形 ${b.id} 缺少配色配方`)
  }
  assert.equal(BIOMES.length, THEME_LIST.length, '生态数量与主题数量必须一致')
})

test('每个生态都有独立的场景语言（天空/地面/装饰/空气粒子）', () => {
  const scenes = new Set()
  const floors = new Set()
  const props = new Set()
  const ambient = new Set()
  for (const t of THEME_LIST) {
    scenes.add(t.scene)
    floors.add(t.floorKind)
    props.add(t.propKind)
    ambient.add(t.ambientKind)
  }
  assert.equal(scenes.size, THEME_LIST.length, '天空场景类型不应重复（否则就退化成换滤镜）')
  assert.equal(floors.size, THEME_LIST.length, '地面纹理类型不应重复')
  assert.equal(props.size, THEME_LIST.length, '装饰物类型不应重复')
  assert.equal(ambient.size, THEME_LIST.length, '空气粒子类型不应重复')
})

// ---------------------------------------------------------------- 布局不变量

for (const biome of BIOMES) {
  test(`[${biome.id}] 地形铺满整片竞技场，不挤在中心`, () => {
    const rows = samples(biome.id)
    for (const r of rows) {
      // 出生点净空：没有任何障碍物压在出生位置
      assert.equal(r.inInnerDisk, 0, '障碍物不得侵入出生点净空')
      // 障碍物的最外缘必须落在开局竞技场之内。
      // 判定用 reach + r 而不是圆心距离：圆心在圈内、本体探出圈外的障碍
      // 会在缩圈第一帧就被吞掉，表现为开局瞬间爆一圈溶解粒子。
      assert.ok(
        r.outerReach <= T.arenaRadiusStart,
        `障碍物探出了开局竞技场：outerReach=${r.outerReach.toFixed(0)}`,
      )
      // 重心不能偏在中心：旧版 22 块陨石全在半径 340~653，
      // 平均半径只有竞技场的 26%，看上去就是"中心一坨"。
      assert.ok(
        r.meanRadius > T.arenaRadiusStart * 0.45,
        `地形重心过于靠中心：meanRadius=${r.meanRadius.toFixed(0)}`,
      )
      // 径向必须铺开，而不是集中在一个窄环里
      assert.ok(
        r.maxRadius - r.minRadius > T.arenaRadiusStart * 0.35,
        `地形径向分布太窄：跨度=${(r.maxRadius - r.minRadius).toFixed(0)}`,
      )
      // 数量要够，否则场地空得像没做地形
      assert.ok(r.count >= 24, `障碍物太少：${r.count}`)
    }
  })

  test(`[${biome.id}] 缩圈的吞没节奏贯穿全程（不会缩到一半就没东西可吃）`, () => {
    // 旧版的毛病：外圈按面积均匀采样，天然"越靠外越密、越靠内越稀"，
    // 于是有相当一部分种子在终局圈外侧留出空白 —— 缩圈的最后一段
    // 变成"圈还在缩、场地里却已经无物可吃"。贴身环机制就是为它加的。
    const span = T.arenaRadiusStart - T.arenaRadiusMin
    for (const r of samples(biome.id, 40)) {
      assert.ok(r.outsideFinal >= 6, `可被吞没的地形太少：${r.outsideFinal}`)
      // 末端：最后一次吞没必须贴近终局圈
      assert.ok(
        r.dissolveTail <= 110,
        `缩圈末端没有地形可吞：最后 ${r.dissolveTail.toFixed(0)} 的半径区间是空的`,
      )
      // 中段：相邻两次吞没之间不得留下过长的空档
      assert.ok(
        r.dissolveGap <= 170,
        `缩圈中段存在吞没空档：gap=${r.dissolveGap.toFixed(0)}`,
      )
      // 引程：开局到第一次吞没之间，外圈地形仍在画面内、环正在向它推进，
      // 因此允许更长，但不能离谱到"整段缩圈都不吞东西"。
      assert.ok(
        r.dissolveLead <= span * 0.4,
        `吞没开始得太晚：lead=${r.dissolveLead.toFixed(0)}`,
      )
    }
  })

  test(`[${biome.id}] 障碍物互不重叠，且碰撞半径就是外接半径`, () => {
    for (const r of samples(biome.id, 24)) {
      assert.equal(r.overlap, 0, '不同结构之间不得重叠')
      assert.equal(r.unspaced, 0, '不同结构之间必须留出可通行净空')
    }
    // 顶点半径必须 ≤ r，否则会出现"看起来还没碰到就死了"
    for (let s = 1; s <= 12; s++) {
      for (const o of generateTerrain(biome.id, createRng(s * 104729), T)) {
        if (o.kind === 'wall') continue
        assert.ok(o.verts.length >= 5)
        for (const v of o.verts) assert.ok(v <= o.r + 1e-9, '顶点半径超出碰撞半径')
      }
    }
  })

  test(`[${biome.id}] 内外两段都有地形：终局不空场，缩圈有东西可吞`, () => {
    for (const r of samples(biome.id, 20)) {
      assert.ok(r.outsideFinal > 0, '外圈必须有地形，否则缩圈吞噬机制形同虚设')
      assert.ok(r.outsideFinal < r.count, '终局圈内必须留下足够地形，否则缩圈后场地会是空的')
    }
  })

  test(`[${biome.id}] 相同种子完全可复现`, () => {
    const a = generateTerrain(biome.id, createRng(4242), T)
    const b = generateTerrain(biome.id, createRng(4242), T)
    assert.equal(a.length, b.length)
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].x, b[i].x)
      assert.equal(a[i].y, b[i].y)
      assert.equal(a[i].r, b[i].r)
    }
  })
}

test('未知生态 id 会退回默认布局，而不是生成空场', () => {
  const list = generateTerrain('does-not-exist', createRng(7), T)
  assert.ok(list.length > 20)
})

test('四种生态的布局互不相同（不是同一套点换个颜色）', () => {
  const sig = new Map()
  for (const b of BIOMES) {
    const list = generateTerrain(b.id, createRng(20260919), T)
    sig.set(b.id, `${list.length}|${list.filter((o) => o.kind === 'wall').length}`)
  }
  assert.equal(new Set(sig.values()).size, BIOMES.length, `布局签名重复：${[...sig].join(' ')}`)
})

test('峡谷的墙是一整道：节点共享同一条折线且共享 reach', () => {
  const list = generateTerrain('sunset', createRng(31337), T)
  const groups = new Map()
  for (const o of list) {
    if (o.kind !== 'wall') continue
    const g = groups.get(o.group) ?? []
    g.push(o)
    groups.set(o.group, g)
  }
  assert.ok(groups.size >= 3, `峡谷应至少有 3 道墙，实际 ${groups.size}`)
  for (const [, nodes] of groups) {
    assert.ok(nodes.length >= 6, '一道墙至少要有 6 个节点才成其为墙')
    const path = nodes[0].path
    let reach = 0
    for (const n of nodes) {
      assert.equal(n.path, path, '同一道墙的节点必须共享同一条折线')
      assert.equal(n.reach, nodes[0].reach, '同一道墙必须共享同一个 reach（缩圈整道崩塌的依据）')
      reach = Math.max(reach, Math.hypot(n.x, n.y))
    }
    assert.ok(Math.abs(reach - nodes[0].reach) < 1e-9)
  }
})

test('墙体节点顺序连续（渲染的折线不能是锯齿状乱序）', () => {
  const list = generateTerrain('sunset', createRng(2718), T)
  const groups = new Map()
  for (const o of list) {
    if (o.kind !== 'wall') continue
    const g = groups.get(o.group) ?? []
    g.push(o)
    groups.set(o.group, g)
  }
  assert.ok(groups.size > 0)
  for (const [, nodes] of groups) {
    for (let i = 0; i < nodes.length; i++) assert.equal(nodes[i].step, i)
    // 相邻节点必须首尾相接：间距大于 2r 就会在渲染出的墙上撕出缺口，
    // 而碰撞仍按"圆盘并集"判定，于是出现"看得见缝、走不过去"。
    for (let i = 1; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y)
      assert.ok(d > 0, `节点 ${i} 与前一个重合`)
      assert.ok(d <= nodes[i].r * 2, `节点间距 ${d.toFixed(1)} 超过直径 ${(nodes[i].r * 2).toFixed(1)}，墙上会有缺口`)
    }
  }
})
