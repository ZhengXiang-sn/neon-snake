import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Snake } from '../src/game/snake.js'
import { createGameConfig } from '../src/config.js'
import { angleDelta } from '../src/core/math.js'

const cfg = createGameConfig({ difficulty: 'normal' })

function makeSnake(overrides = {}) {
  const s = new Snake(cfg)
  s.reset({ id: 0, x: 0, y: 0, angle: 0, mass: cfg.startMass, isPlayer: true, ...overrides })
  return s
}

test('reset 生成初始身体，节点数 > 1 且头部与坐标一致', () => {
  const s = makeSnake()
  assert.equal(s.alive, true)
  assert.ok(s.nodeCount > 1, `节点数应大于 1，实际 ${s.nodeCount}`)
  assert.equal(s.nodes[0].x, 0)
  assert.equal(s.nodes[0].y, 0)
  assert.ok(s.selfSkipNodes > 0, '必须存在自碰撞豁免节点')
})

test('step：沿朝向前进，位移与速度×dt 一致', () => {
  const s = makeSnake({ angle: 0 })
  const before = { x: s.x, y: s.y }
  const move = s.step(cfg.fixedStep)
  assert.ok(Math.abs(s.x - before.x - s.speed * cfg.fixedStep) < 1e-9)
  assert.ok(Math.abs(move - s.speed * cfg.fixedStep) < 1e-9)
  assert.ok(Math.abs(s.y - before.y) < 1e-9)
})

test('转向速率受限：远目标不会一帧到位', () => {
  const s = makeSnake({ angle: 0 })
  s.steerTo(Math.PI)
  s.step(cfg.fixedStep)
  const turned = Math.abs(angleDelta(0, s.angle))
  const limit = s.turnRate * cfg.fixedStep
  assert.ok(turned <= limit + 1e-9, `单步转角 ${turned} 应 <= ${limit}`)
  assert.ok(turned > 0, '应该确实转了一点')
})

test('质量提升会同时增加半径与体长，但降低速度与转向率（Slither 式制衡）', () => {
  const light = makeSnake({ mass: 12 })
  const heavy = makeSnake({ mass: 200 })
  assert.ok(heavy.radius > light.radius)
  assert.ok(heavy.bodyLen > light.bodyLen)
  assert.ok(heavy.speed < light.speed)
  assert.ok(heavy.turnRate < light.turnRate)
})

test('registerEat：质量、进食计数与连击倍率同步推进', () => {
  const s = makeSnake()
  const before = s.mass
  s.registerEat(1)
  assert.ok(s.mass > before)
  assert.equal(s.foodEaten, 1)
  assert.equal(s.combo, 1)
  assert.equal(s.comboMult, 1)
  for (let i = 0; i < 2; i++) s.registerEat(1)
  assert.equal(s.combo, 3)
  assert.equal(s.comboMult, 2, '每 3 层连击提升一级倍率')
})

test('连击倍率有上限，且超时后重置', () => {
  const s = makeSnake()
  for (let i = 0; i < 200; i++) s.registerEat(1)
  assert.equal(s.comboMult, cfg.comboMaxMult)
  s.updateCombo(cfg.comboWindow + 0.01)
  assert.equal(s.combo, 0)
  assert.equal(s.comboMult, 1)
})

test('质量存在下限，不会因持续加速归零', () => {
  const s = makeSnake()
  for (let i = 0; i < 100; i++) s.addMass(-5)
  assert.ok(s.mass >= 6)
  assert.ok(s.radius > 0)
})

test('路径裁剪使长度有界（长时间运行不会无限增长）', () => {
  const s = makeSnake({ mass: 400 })
  for (let i = 0; i < 20000; i++) s.step(cfg.fixedStep)
  assert.ok(
    s.path.count <= cfg.pathCapacity,
    `路径点数 ${s.path.count} 不应超过容量 ${cfg.pathCapacity}`,
  )
  assert.ok(
    s.path.length <= s.bodyLen + cfg.segmentSpacing * 4,
    `保留弧长 ${s.path.length} 应贴合体长 ${s.bodyLen}`,
  )
})

test('身体节点间距贴近设定值，且节点数受 maxNodes 约束', () => {
  const s = makeSnake({ mass: 400 })
  for (let i = 0; i < 600; i++) s.step(cfg.fixedStep)
  const spacing = Math.max(cfg.segmentSpacing, s.bodyLen / cfg.maxNodes)
  for (let i = 1; i < Math.min(s.nodeCount, 40); i++) {
    const d = Math.hypot(s.nodes[i].x - s.nodes[i - 1].x, s.nodes[i].y - s.nodes[i - 1].y)
    assert.ok(Math.abs(d - spacing) < spacing * 0.35, `第 ${i} 段间距 ${d}，期望约 ${spacing}`)
  }
  assert.ok(s.nodeCount <= cfg.maxNodes + 1)
})

test('加速：速度提升、质量可加速时开启', () => {
  const s = makeSnake({ mass: 60 })
  const base = s.speed
  s.boosting = true
  s.refreshDerived()
  assert.ok(Math.abs(s.speed - base * cfg.boostMult) < 1e-9)
  assert.equal(s.canBoost, true)
  s.mass = cfg.minMassToBoost
  assert.equal(s.canBoost, false, '质量不足时不可加速')
})

test('护盾与限时效果的授予语义', () => {
  const s = makeSnake()
  s.grantEffect('shield')
  assert.equal(s.hasEffect('shield'), true)
  assert.equal(s.effects.shield, 1, '护盾是"一次性充能"，用 1 表示就绪')
  s.grantEffect('ghost', 5)
  assert.equal(s.hasEffect('ghost'), true)
  s.updateEffects(6)
  assert.equal(s.hasEffect('ghost'), false)
  assert.equal(s.hasEffect('shield'), true, '护盾不随时间衰减，只有被撞击才会消耗')
})

test('护盾：消耗后进入无敌帧，且不会重复消耗', () => {
  const s = makeSnake()
  s.grantEffect('shield')
  assert.equal(s.consumeShield(), true, '第一次撞击应被护盾挡下')
  assert.equal(s.hasEffect('shield'), false)
  assert.ok(
    Math.abs(s.effects.grace - cfg.powerupShieldGrace) < 1e-9,
    '挡下撞击后必须有一段无敌帧，否则下一帧就会被同一堵墙再撞死一次',
  )
  assert.equal(s.consumeShield(), false, '没有护盾时不应谎报挡下')
  s.updateEffects(cfg.powerupShieldGrace + 0.01)
  assert.equal(s.hasEffect('grace'), false, '无敌帧必须会结束')
})

test('加速消耗质量，且质量触底时自动松开加速（回归防护）', () => {
  const s = makeSnake({ mass: 60 })
  s.boosting = true
  const start = s.mass
  const dt = cfg.fixedStep
  s.step(dt)
  assert.ok(
    Math.abs(s.mass - (start - cfg.boostMassCost * dt)) < 1e-9,
    `加速一步应扣掉 ${cfg.boostMassCost * dt} 质量，实际扣了 ${start - s.mass}`,
  )

  // 一直按住加速，质量必须单调下降并最终停在 minMassToBoost，同时自动松开
  let last = s.mass
  for (let i = 0; i < 60 * 60; i++) {
    if (!s.canBoost) {
      s.boosting = false
      break
    }
    s.step(dt)
    assert.ok(s.mass <= last + 1e-9, '加速期间质量不允许上升')
    last = s.mass
  }
  assert.ok(s.mass >= cfg.minMassToBoost - 1e-9 && s.mass <= cfg.minMassToBoost + 1e-9)
  assert.equal(s.boosting, false, '质量见底后必须自动松开加速')
  assert.ok(s.speed > 0 && Number.isFinite(s.speed))
})

test('不加速时不消耗质量', () => {
  const s = makeSnake({ mass: 60 })
  const before = s.mass
  for (let i = 0; i < 120; i++) s.step(cfg.fixedStep)
  assert.equal(s.mass, before, '只有 boost 才烧质量')
})

test('dropValue 按比例返回掉落质量', () => {
  const s = makeSnake({ mass: 100 })
  assert.ok(Math.abs(s.dropValue() - 65) < 1e-9)
})

test('自碰撞豁免区随体型增长，始终大于两倍判定半径（回归防护）', () => {
  for (const mass of [12, 60, 200, 400]) {
    const s = makeSnake({ mass })
    const spacing = Math.max(cfg.segmentSpacing, s.bodyLen / cfg.maxNodes)
    const exemptArc = s.selfSkipNodes * spacing
    assert.ok(
      exemptArc > s.collideRadius() * 2 + 8,
      `质量 ${mass}：豁免弧长 ${exemptArc} 必须显著大于判定直径 ${s.collideRadius() * 2}`,
    )
  }
})
