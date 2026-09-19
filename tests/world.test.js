import { test } from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/game/world.js'
import { analyzeTerrain } from '../src/game/terrain.js'
import { createGameConfig } from '../src/config.js'

function newWorld(overrides = {}) {
  const cfg = createGameConfig(overrides)
  const world = new World(cfg)
  world.newGame({ seed: 12345, biome: cfg.biome })
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
  assert.ok(world.obstacles.length >= 24, `地形数量应足够，实际 ${world.obstacles.length}`)
  assert.equal(world.biome, world.cfg.biome)
  assert.equal(world.terrainEaten, 0)
  assert.equal(aliveFood(world, world.commonRange[0], world.commonRange[1]), world.cfg.foodCommonCount)
  assert.equal(aliveFood(world, world.goldRange[0], world.goldRange[1]), world.cfg.foodGoldCount)
  assert.equal(aliveFood(world, world.gemRange[0], world.gemRange[1]), 0)
  for (let i = 1; i < world.snakes.length; i++) {
    assert.equal(world.snakes[i].alive, true)
    assert.ok(world.snakes[i].ai, 'AI 蛇必须带 brain')
  }
})

test('开局地形：出生点净空、不重叠、径向铺开（不是中心一坨）', () => {
  const world = newWorld()
  const t = {
    innerClear: world.cfg.terrainInnerClear,
    arenaRadiusMin: world.cfg.arenaRadiusMin,
  }
  const stat = analyzeTerrain(world.obstacles, t)
  assert.equal(stat.inInnerDisk, 0, '出生点净空内不得有障碍物')
  assert.equal(stat.overlap, 0, '不同结构之间不得重叠')
  assert.ok(
    stat.meanRadius > world.cfg.arenaRadiusStart * 0.45,
    `地形重心过于靠中心：${stat.meanRadius.toFixed(0)}`,
  )
  assert.ok(stat.maxRadius > world.cfg.arenaRadiusStart * 0.6, '地形必须延伸到远离中心的位置')
})

test('食物不会生成在障碍物内部（看得见却吃不到）', () => {
  const world = newWorld()
  let inside = 0
  for (let i = world.commonRange[0]; i < world.goldRange[1]; i++) {
    const f = world.food[i]
    if (!f.alive) continue
    for (const o of world.obstacles) {
      const dx = o.x - f.x
      const dy = o.y - f.y
      const rr = o.r + f.r
      if (dx * dx + dy * dy < rr * rr) {
        inside++
        break
      }
    }
  }
  // 不允许任何一颗食物被石头埋住：内圈石头终局也不会溶解，
  // 埋在里面就等于整局都吃不到。这是 `_foodSpot` 兜底扫描的存在理由。
  assert.equal(inside, 0, `有 ${inside} 个食物落在障碍物内部`)
})

test('食物落点的兜底扫描：即使随机重试全部失败也不会埋进石头里', () => {
  const world = newWorld()
  // 把重试次数压到 1，强制每次都走"随机点被挡 → 环形扫描兜底"这条路径
  world.cfg.foodPlaceTries = 1
  let blockedSoFar = 0
  for (let i = 0; i < 300; i++) {
    const first = world._randomPointInArena(60)
    if (world._blockedAt(first.x, first.y, 20)) blockedSoFar++
    const p = world._foodSpot(60, 20)
    assert.equal(world._blockedAt(p.x, p.y, 20), false, '兜底落点仍在障碍物内部')
  }
  // 这些种子下必然有相当比例的随机首点落在石头里，否则本测试没有真正覆盖兜底分支
  assert.ok(blockedSoFar >= 20, `兜底分支覆盖不足：仅 ${blockedSoFar}/300 次随机首点被挡`)
})

test('缩圈过程中切换生态，不会在圈外凭空生成障碍物', () => {
  const world = newWorld()
  // 模拟"已经缩过一段圈"的局面
  world.elapsed = world.cfg.arenaShrinkDelay + world.cfg.arenaShrinkDuration * 0.6
  world._updateArena()
  world._dissolveTerrain()
  const R = world.arenaRadius
  assert.ok(R < world.cfg.arenaRadiusStart, '前置条件：竞技场应已缩小')

  world.rebuildTerrain('crystal')

  // 新地形按"开局半径"生成，若不按当前半径清扫，圈外黑暗里会留下一批
  // 障碍物，并在下一帧被缩圈一次性吞掉（视觉上是切换瞬间炸出一团粒子）。
  for (const o of world.obstacles) {
    const reach = o.kind === 'wall' ? o.reach : Math.hypot(o.x, o.y)
    assert.ok(reach + o.r <= R + 1e-6, `切换后仍有障碍物落在当前圈外：${(reach + o.r).toFixed(0)} > ${R.toFixed(0)}`)
  }
  assert.equal(world.terrainEaten, 0, '换生态清场不应计入"被缩圈吞噬"的统计')
})

test('地形随机源与玩法随机源相互独立，且同一 (种子, 生态) 恒产出同一张图', () => {
  // 1) 玩法随机源被消耗掉任意多之后，同种子的地形必须一模一样。
  //    旧版两者共用一支 rng，改地形参数会静默改变 AI / 掉落 / 食物序列。
  const a = newWorld({ seed: 20260919 })
  const b = newWorld({ seed: 20260919 })
  for (let i = 0; i < 500; i++) b.rng.next()
  b._generateObstacles()
  assert.equal(a.obstacles.length, b.obstacles.length)
  for (let i = 0; i < a.obstacles.length; i++) {
    assert.equal(a.obstacles[i].x, b.obstacles[i].x)
    assert.equal(a.obstacles[i].y, b.obstacles[i].y)
  }

  // 2) 来回切换生态必须是可逆的：A→B→A 之后地形要回到和第一次 A 完全相同。
  //    注意比较基准必须也是"重建过的 A" —— rebuildTerrain 会额外清掉蛇周围的
  //    障碍物，而 newGame 不会，两者直接对比是不同前提。
  const c = newWorld()
  const home = c.biome
  c.rebuildTerrain(home)
  const first = c.obstacles.map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`).join('|')
  c.rebuildTerrain('sunset')
  c.rebuildTerrain(home)
  const again = c.obstacles.map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`).join('|')
  assert.equal(again, first, '切回原生态后地形应与首次生成完全一致')
})

test('缩圈会吞噬外圈地形，且墙体整道崩塌', () => {
  const world = newWorld({ biome: 'sunset' })
  const before = world.obstacles.length
  assert.ok(world.obstacles.some((o) => o.kind === 'wall'), '峡谷生态测试需要墙体')

  // 推进到缩圈结束
  world.elapsed = world.cfg.arenaShrinkDelay + world.cfg.arenaShrinkDuration + 1
  world._updateArena()
  world._dissolveTerrain()
  assert.ok(world.arenaRadius < world.cfg.arenaRadiusStart, '竞技场应已收缩')
  assert.ok(world.terrainEaten > 0, '外圈地形应被吞噬')
  assert.ok(world.obstacles.length < before, '剩余地形应变少')

  // 剩下的墙体必须是完整的：step 从 0 连续到最后，不存在"挖掉中间几个"
  const groups = new Map()
  for (const o of world.obstacles) {
    if (o.kind !== 'wall') continue
    const arr = groups.get(o.group) ?? []
    arr.push(o.step)
    groups.set(o.group, arr)
  }
  for (const [, steps] of groups) {
    steps.sort((a, b) => a - b)
    for (let i = 0; i < steps.length; i++) assert.equal(steps[i], i, '墙体必须整体保留或整体移除')
  }

  // 所有幸存地形都必须完整落在当前圈内
  for (const o of world.obstacles) {
    const reach = o.kind === 'wall' ? o.reach : Math.hypot(o.x, o.y)
    assert.ok(reach + o.r <= world.arenaRadius + 1e-6, '幸存地形不得越出竞技场')
  }
})

test('生态热切换会以每条蛇为中心清场，不会把蛇直接埋进新地形', () => {
  const world = newWorld()
  // 把玩家挪到外圈，确保切换后那里本来会有新生成的障碍物
  world.player.x = 700
  world.player.y = 0
  world.rebuildTerrain('crystal')

  assert.equal(world.biome, 'crystal')
  assert.ok(world.obstacles.length > 20, '切换后必须真的重建了地形')
  for (const s of world.snakes) {
    if (!s.alive) continue
    for (const o of world.obstacles) {
      const dx = o.x - s.x
      const dy = o.y - s.y
      const rr = o.r + s.radius + 4
      assert.ok(dx * dx + dy * dy > rr * rr, '蛇身周围必须被清空')
    }
  }
})

test('切换生态后 newGame 仍然使用新生态（不会回退成旧值）', () => {
  const world = newWorld()
  world.cfg.biome = 'abyss'
  world.rebuildTerrain('abyss')
  world.newGame({ seed: 999 })
  assert.equal(world.biome, 'abyss')
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
