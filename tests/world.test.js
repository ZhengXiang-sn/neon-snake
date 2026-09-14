import { test } from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/game/world.js'
import { createGameConfig } from '../src/config.js'

function newWorld(overrides = {}) {
  const cfg = createGameConfig(overrides)
  const world = new World(cfg)
  world.newGame({ seed: 12345 })
  return world
}

function aliveFood(world, from, to) {
  let n = 0
  for (let i = from; i < to; i++) if (world.food[i].alive) n++
  return n
}

/**
 * 清空陨石与 AI，让碰撞类断言只考察被测规则本身，
 * 不受随机生成的地形位置影响（否则测试会随机失败）。
 */
function isolate(world) {
  world.obstacles.length = 0
  for (let i = 1; i < world.snakes.length; i++) world.snakes[i].kill()
}

test('newGame 建立完整且自洽的初始世界', () => {
  const world = newWorld()
  assert.equal(world.state, 'playing')
  assert.equal(world.player.alive, true)
  assert.equal(world.snakes.length, 1 + world.cfg.botCount)
  assert.equal(world.arenaRadius, world.cfg.arenaRadiusStart)
  assert.equal(world.obstacles.length, 22)
  assert.equal(aliveFood(world, world.commonRange[0], world.commonRange[1]), world.cfg.foodCommonCount)
  assert.equal(aliveFood(world, world.goldRange[0], world.goldRange[1]), world.cfg.foodGoldCount)
  assert.equal(aliveFood(world, world.gemRange[0], world.gemRange[1]), 0)
  for (let i = 1; i < world.snakes.length; i++) {
    assert.equal(world.snakes[i].alive, true)
    assert.ok(world.snakes[i].ai, 'AI 蛇必须带 brain')
  }
})

test('障碍物都落在最终竞技场之内，且彼此不重叠', () => {
  const world = newWorld()
  const limit = world.cfg.arenaRadiusMin
  for (const o of world.obstacles) {
    assert.ok(Math.hypot(o.x, o.y) + o.r <= limit, '障碍物必须完全位于最小竞技场内')
    assert.ok(o.verts.length >= 7)
  }
  for (let i = 0; i < world.obstacles.length; i++) {
    for (let k = i + 1; k < world.obstacles.length; k++) {
      const a = world.obstacles[i]
      const b = world.obstacles[k]
      const need = a.r + b.r
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= need * 0.9, '障碍物不应严重重叠')
    }
  }
})

test('step 推进时间并让玩家沿朝向移动', () => {
  const world = newWorld()
  const before = world.player.x
  for (let i = 0; i < 10; i++) world.step(world.cfg.fixedStep)
  assert.ok(world.elapsed > 0)
  assert.notEqual(world.player.x, before)
})

test('竞技场在延迟后开始收缩并最终停在最小半径', () => {
  const world = newWorld()
  world.elapsed = world.cfg.arenaShrinkDelay - 1
  world.step(world.cfg.fixedStep)
  assert.equal(world.arenaRadius, world.cfg.arenaRadiusStart, '收缩延迟前半径不变')

  world.elapsed = world.cfg.arenaShrinkDelay + world.cfg.arenaShrinkDuration
  world.step(world.cfg.fixedStep)
  assert.ok(
    Math.abs(world.arenaRadius - world.cfg.arenaRadiusMin) < 1,
    `收缩结束后应等于最小半径，实际 ${world.arenaRadius}`,
  )
})

test('出圈即死，并判定为撞墙', () => {
  const world = newWorld()
  const player = world.player
  player.x = world.arenaRadius + 400
  player.y = 0
  world._resolveCollisions()
  assert.equal(player.alive, false)
  const death = world.events.find((e) => e.type === 'death' && e.isPlayer)
  assert.ok(death)
  assert.equal(death.cause, 'wall')
})

test('玩家撞上 AI 身体 → 玩家死亡；AI 撞上玩家身体 → AI 死亡并给玩家计分', () => {
  const world = newWorld()
  isolate(world)
  const player = world.player
  const bot = world.snakes[1]

  player.reset({ id: 0, x: 300, y: 0, angle: 0, mass: world.cfg.startMass, isPlayer: true, speedMult: 1 })
  bot.reset({ id: 1, x: 400, y: 0, angle: 0, mass: world.cfg.startMass * 1.6, speedMult: 1 })
  world._resolveCollisions()
  assert.equal(player.alive, false, '玩家头撞到对手身体应死亡')
  assert.equal(bot.alive, true)

  const world2 = newWorld()
  isolate(world2)
  const p2 = world2.player
  const b2 = world2.snakes[1]
  p2.reset({ id: 0, x: 200, y: 0, angle: 0, mass: world2.cfg.startMass, isPlayer: true, speedMult: 1 })
  b2.reset({ id: 1, x: 100, y: 0, angle: 0, mass: world2.cfg.startMass, speedMult: 1 })
  const scoreBefore = world2.score
  world2._resolveCollisions()
  assert.equal(b2.alive, false, 'AI 头撞到玩家身体应死亡')
  assert.equal(p2.alive, true)
  assert.equal(world2.kills, 1)
  assert.ok(world2.score > scoreBefore, '击杀应给玩家加分')
  assert.ok(aliveFood(world2, world2.gemRange[0], world2.gemRange[1]) > 0, '死亡应爆出宝石')
})

test('自碰撞：头部重叠自身躯干即死；开启幽灵效果后可穿过', () => {
  const world = newWorld()
  isolate(world)
  const player = world.player
  player.reset({ id: 0, x: 0, y: 0, angle: 0, mass: 60, isPlayer: true, speedMult: 1 })
  player.x = -120
  world._resolveCollisions()
  assert.equal(player.alive, false)

  const world2 = newWorld()
  isolate(world2)
  const p2 = world2.player
  p2.reset({ id: 0, x: 0, y: 0, angle: 0, mass: 60, isPlayer: true, speedMult: 1 })
  p2.grantEffect('ghost', 5)
  p2.x = -120
  world2._resolveCollisions()
  assert.equal(p2.alive, true, '幽灵形态下不应被自身身体判定死亡')
})

test('头部附近存在自碰撞豁免区，避免贴颈误杀', () => {
  const world = newWorld()
  isolate(world)
  const player = world.player
  player.reset({ id: 0, x: 0, y: 0, angle: 0, mass: 60, isPlayer: true, speedMult: 1 })
  assert.ok(player.selfSkipNodes >= 4)
  // 只轻微后移，位移仍在豁免区内
  player.x = -player.selfSkipNodes * world.cfg.segmentSpacing * 0.5
  world._resolveCollisions()
  assert.equal(player.alive, true)
})

test('吃到食物会加分、增重并写入事件', () => {
  const world = newWorld()
  const player = world.player
  const scoreBefore = world.score
  const massBefore = player.mass
  const f = world.food[0]
  f.x = player.x
  f.y = player.y
  f.alive = true
  world.events.length = 0
  world._consumeFood()
  assert.equal(f.alive, false)
  assert.ok(player.mass > massBefore)
  assert.ok(world.score > scoreBefore)
  const ev = world.events.find((e) => e.type === 'eat')
  assert.ok(ev)
  assert.equal(ev.isPlayer, true)
})

test('宝石食物有时限，到期后回收', () => {
  const world = newWorld()
  const bot = world.snakes[1]
  world._killSnake(bot, null, 'self')
  const gemStart = world.gemRange[0]
  assert.ok(world.food[gemStart].alive)
  world.elapsed += 1000
  world._updateFood(world.cfg.fixedStep)
  assert.equal(world.food[gemStart].alive, false)
})

test('普通食物被吃掉后会在别处重生，总量守恒', () => {
  const world = newWorld()
  const [cs, ce] = world.commonRange
  const f = world.food[cs]
  world._eatFood(world.player, f)
  assert.equal(f.alive, false)
  assert.equal(aliveFood(world, cs, ce), world.cfg.foodCommonCount - 1)
  world.elapsed += 5
  world._updateFood(world.cfg.fixedStep)
  assert.equal(aliveFood(world, cs, ce), world.cfg.foodCommonCount, '普通食物应被重新投放')
})

test('道具拾取生效并进入冷却', () => {
  const world = newWorld()
  const p = world.powerups[0]
  p.alive = true
  p.type = 'magnet'
  p.x = world.player.x
  p.y = world.player.y
  p.ttl = 10
  world._updatePowerups(world.cfg.fixedStep)
  assert.equal(p.alive, false)
  assert.ok(world.player.effects.magnet > 0)
  assert.ok(world.events.some((e) => e.type === 'powerup'))
})

test('护盾：挡下一次致命撞击后碎裂，并给出无敌帧避免连环死亡', () => {
  const world = newWorld()
  isolate(world)
  const player = world.player
  // 撞墙场景：直接把头放到圈外
  player.reset({ id: 0, x: 0, y: 0, angle: 0, mass: 60, isPlayer: true, speedMult: 1 })
  world._applyPowerup(player, 'shield')
  assert.equal(player.effects.shield, 1)
  player.x = world.arenaRadius + 400
  world._resolveCollisions()
  assert.equal(player.alive, true, '有护盾时不应死亡')
  assert.equal(player.effects.shield, 0, '护盾应被消耗')
  assert.ok(player.effects.grace > 0, '必须进入无敌帧')
  assert.ok(
    world.events.some((e) => e.type === 'shieldBreak'),
    '护盾碎裂必须发出事件，供特效与音效消费',
  )

  // 无敌帧内即使还在圈外也不该死
  world._resolveCollisions()
  assert.equal(player.alive, true)

  // 无敌帧耗尽后，同样的位置就会真的死
  player.effects.grace = 0
  world._resolveCollisions()
  assert.equal(player.alive, false, '没有护盾时撞墙必须死')
})

test('护盾无法抵挡"死亡帧"之外的重复判定：玩家死亡后不会被二次结算', () => {
  const world = newWorld()
  isolate(world)
  const player = world.player
  player.reset({ id: 0, x: 0, y: 0, angle: 0, mass: 60, isPlayer: true, speedMult: 1 })
  world.events.length = 0
  player.x = world.arenaRadius + 400
  world._resolveCollisions()
  assert.equal(player.alive, false)
  const firstCount = world.events.filter((e) => e.type === 'death').length
  assert.equal(firstCount, 1)
  world._resolveCollisions()
  assert.equal(
    world.events.filter((e) => e.type === 'death').length,
    firstCount,
    '已死亡的蛇不应在同一帧或下一帧被重复计入死亡事件',
  )
})

test('磁铁把附近食物吸向蛇头', () => {
  const world = newWorld()
  const player = world.player
  const f = world.food[0]
  f.alive = true
  f.x = player.x + 200
  f.y = player.y
  const before = f.x
  player.effects.magnet = 5
  world._applyMagnet(1 / 60)
  assert.ok(f.x < before, '食物应被吸向蛇头（横坐标减小）')
})

test('AI 蛇死亡后会重生，且重生点安全', () => {
  const world = newWorld()
  const bot = world.snakes[1]
  world._killSnake(bot, null, 'self')
  assert.equal(bot.alive, false)
  world.elapsed = bot.respawnAt + 0.01
  world._respawnDeadBots()
  assert.equal(bot.alive, true)
  assert.ok(Math.hypot(bot.x, bot.y) <= world.arenaRadius)
})

test('同一局面下相同种子产生完全一致的世界（可复现）', () => {
  const a = newWorld()
  const b = new World(createGameConfig({ difficulty: 'normal' }))
  b.newGame({ seed: 12345 })
  assert.equal(a.obstacles.length, b.obstacles.length)
  for (let i = 0; i < a.obstacles.length; i++) {
    assert.ok(Math.abs(a.obstacles[i].x - b.obstacles[i].x) < 1e-9)
    assert.ok(Math.abs(a.obstacles[i].y - b.obstacles[i].y) < 1e-9)
  }
  assert.ok(Math.abs(a.food[0].x - b.food[0].x) < 1e-9)
})

test('长时间空跑不会抛异常，且状态保持有界', () => {
  const world = newWorld()
  for (let i = 0; i < 1500; i++) world.step(world.cfg.fixedStep)
  assert.ok(Number.isFinite(world.player.x))
  assert.ok(Number.isFinite(world.arenaRadius))
  assert.ok(world.arenaRadius >= world.cfg.arenaRadiusMin - 1e-6)
  assert.ok(world.events.length <= 64)
  assert.ok(Number.isFinite(world.score))
})

test('edgePressure 在接近边界时升高', () => {
  const world = newWorld()
  assert.equal(world.edgePressure, 0)
  world.player.x = world.arenaRadius - world.cfg.arenaWarnBand / 2
  world.player.y = 0
  const mid = world.edgePressure
  assert.ok(mid > 0.4 && mid < 0.6, `警戒带中点压力应约为 0.5，实际 ${mid}`)
  world.player.x = world.arenaRadius
  assert.equal(world.edgePressure, 1)
  world.player.x = world.arenaRadius - world.cfg.arenaWarnBand - 200
  assert.equal(world.edgePressure, 0)
})
