import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrain, updateBrain } from '../src/game/ai.js'
import { Snake } from '../src/game/snake.js'
import { createGameConfig } from '../src/config.js'
import { createRng } from '../src/core/rng.js'
import { angleDelta } from '../src/core/math.js'

const cfg = createGameConfig({ difficulty: 'normal' })

function stubWorld({ arenaRadius = 1000, food = [], obstacles = [], powerups = [], player = null } = {}) {
  return {
    arenaRadius,
    food,
    obstacles,
    powerups,
    player,
    queryBodies: () => false,
  }
}

function makeBot(world, { x = 0, y = 0, angle = 0, mass = 30 } = {}) {
  const s = new Snake(cfg)
  s.reset({ id: 1, x, y, angle, mass, speedMult: 1 })
  s.ai = createBrain(cfg, createRng(7))
  return s
}

test('开阔场地中会朝食物方向前进', () => {
  const world = stubWorld({ food: [{ x: 600, y: 0, value: 1, alive: true }] })
  const bot = makeBot(world, { angle: Math.PI })
  updateBrain(bot, world, 1 / 60)
  const diff = Math.abs(angleDelta(bot.desiredAngle, 0))
  assert.ok(diff < 0.45, `期望大致朝向 0，实际偏差 ${diff}`)
})

test('贴近边界且朝外时，会转向场地内部', () => {
  const world = stubWorld({ arenaRadius: 1000 })
  const bot = makeBot(world, { x: 985, y: 0, angle: 0 })
  updateBrain(bot, world, 1 / 60)
  assert.ok(Math.cos(bot.desiredAngle) < 0, '必须掉头朝场内')
})

test('正前方有障碍物时会绕开', () => {
  const world = stubWorld({ obstacles: [{ x: 120, y: 0, r: 40 }] })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0 })
  updateBrain(bot, world, 1 / 60)
  assert.ok(Math.abs(angleDelta(bot.desiredAngle, 0)) > 0.2, '不应直冲障碍物')
})

test('体型占优时会包夹玩家（瞄准玩家前方拦截点）', () => {
  const player = new Snake(cfg)
  player.reset({ id: 0, x: 300, y: 0, angle: 0, mass: 12, isPlayer: true, speedMult: 1 })
  const world = stubWorld({ player })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0, mass: 200 })
  updateBrain(bot, world, 1 / 60)
  assert.ok(Math.abs(angleDelta(bot.desiredAngle, 0)) < 0.5, '应朝玩家方向推进')
  assert.equal(bot.ai.state, 'hunt')
})

test('体型劣势时不会主动追击玩家', () => {
  const player = new Snake(cfg)
  player.reset({ id: 0, x: 300, y: 0, angle: 0, mass: 200, isPlayer: true, speedMult: 1 })
  const world = stubWorld({ player, food: [{ x: -400, y: 0, value: 1, alive: true }] })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0, mass: 12 })
  updateBrain(bot, world, 1 / 60)
  assert.ok(Math.cos(bot.desiredAngle) < 0, '应远离强敌，转去吃反方向的食物')
})

test('决策按反应间隔限频，间隔内保持同一朝向', () => {
  const world = stubWorld({ food: [{ x: 600, y: 0, value: 1, alive: true }] })
  const bot = makeBot(world, { angle: Math.PI })
  updateBrain(bot, world, 1 / 60)
  const first = bot.ai.targetAngle
  // 反应间隔内，转向目标不应被重新计算
  bot.x = -500
  updateBrain(bot, world, 1 / 600)
  assert.equal(bot.ai.targetAngle, first)
})

test('食物价值与距离共同影响目标选择（近的高价值优先）', () => {
  const world = stubWorld({
    food: [
      { x: 900, y: 0, value: 1, alive: true },
      { x: -300, y: 0, value: 6, alive: true },
    ],
  })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0 })
  updateBrain(bot, world, 1 / 60)
  assert.ok(Math.cos(bot.desiredAngle) < 0, '应选择更划算的左侧金色食物')
})

test('质量过低时不会持续加速（避免把自己烧干）', () => {
  const world = stubWorld({ food: [{ x: 3000, y: 0, value: 1, alive: true }] })
  const bot = makeBot(world, { mass: 10 })
  for (let i = 0; i < 60; i++) updateBrain(bot, world, 1 / 60)
  assert.equal(bot.boosting, false)
})

test('被完全包围时会尝试急转脱困', () => {
  const ring = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    ring.push({ x: Math.cos(a) * 110, y: Math.sin(a) * 110, r: 30 })
  }
  const world = stubWorld({ obstacles: ring })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0 })
  const turn = []
  for (let i = 0; i < 40; i++) {
    updateBrain(bot, world, 0.05)
    turn.push(bot.ai.targetAngle)
  }
  assert.ok(turn.some((a) => Math.abs(angleDelta(0, a)) > 0.5), '应出现明显转向行为')
})

test('被减速力场笼罩（速度减半）时不会被误判为卡住（回归防护）', () => {
  // 判据若写成"位移 < 半径 × 0.5"，大体型 + 减速场会让"正常前进"被判成卡住，
  // 触发毫无意义的原地急转。这里模拟"每个决策周期都恰好走了 speed × 间隔"的理想前进。
  const world = stubWorld({
    arenaRadius: 100000,
    food: [{ x: 50000, y: 0, value: 1, alive: true }],
  })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0, mass: 600 })
  bot.speedMult = 0.5
  bot.refreshDerived()
  for (let i = 0; i < 40; i++) {
    bot.x += bot.speed * bot.ai.lastInterval
    updateBrain(bot, world, 1) // dt 给足，每次都触发一次重新决策
  }
  assert.equal(bot.ai.stuck, 0, '速度变慢不等于卡住')
})

test('真的原地不动时仍会正确识别为卡住', () => {
  const world = stubWorld({ arenaRadius: 100000, food: [{ x: 50000, y: 0, value: 1, alive: true }] })
  const bot = makeBot(world, { x: 0, y: 0, angle: 0, mass: 600 })
  // 每次调用 dt=1 保证触发一次重新决策；位移恒为 0 应被持续累加
  for (let i = 0; i < 5; i++) updateBrain(bot, world, 1)
  assert.ok(bot.ai.stuck >= 4, `位移恒为 0 时必须判定卡住，实际 stuck=${bot.ai.stuck}`)
})
