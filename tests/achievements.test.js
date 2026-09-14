import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  createRunStats,
  evaluateAchievements,
} from '../src/game/achievements.js'
import { Snake } from '../src/game/snake.js'
import { createGameConfig } from '../src/config.js'

const cfg = createGameConfig({ difficulty: 'normal' })

function makePlayer(mass = 12) {
  const s = new Snake(cfg)
  s.reset({ id: 0, x: 0, y: 0, angle: 0, mass, isPlayer: true, speedMult: 1 })
  return s
}

test('成就定义唯一且字段完整', () => {
  const ids = new Set()
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.id && a.name && a.desc)
    assert.equal(ids.has(a.id), false, `成就 id 重复：${a.id}`)
    ids.add(a.id)
  }
  assert.equal(ACHIEVEMENT_BY_ID.size, ACHIEVEMENTS.length)
})

test('初始状态不触发任何成就', () => {
  const run = createRunStats()
  const player = makePlayer()
  const world = { kills: 0, score: 0 }
  const unlocked = new Set()
  assert.deepEqual(evaluateAchievements(run, world, player, unlocked), [])
})

test('达成条件即解锁，且不会重复解锁', () => {
  const run = createRunStats()
  const player = makePlayer(120)
  const world = { kills: 1, score: 500 }
  const unlocked = new Set()

  const first = evaluateAchievements(run, world, player, unlocked)
  assert.ok(first.includes('first_blood'))
  assert.ok(first.includes('mass100'))
  assert.equal(unlocked.has('first_blood'), true)

  const second = evaluateAchievements(run, world, player, unlocked)
  assert.equal(second.includes('first_blood'), false, '已解锁的成就不应重复上报')
})

test('三杀 / 连击 / 宝石 / 道具 / 存活 各自独立判定', () => {
  const run = createRunStats()
  const player = makePlayer()

  run.maxCombo = 5
  run.gold = 10
  run.gem = 20
  run.powerups = 5
  player.survivalTime = 200
  const world = { kills: 3, score: 9999 }

  const unlocked = new Set()
  const got = evaluateAchievements(run, world, player, unlocked)
  for (const id of ['combo5', 'gold10', 'gem20', 'kills3', 'survive180', 'powerup5', 'first_blood']) {
    assert.ok(got.includes(id), `应解锁 ${id}`)
  }
})

test('边界值：刚好达标即解锁，差一点不解锁', () => {
  const world = { kills: 0, score: 0 }
  const justEnough = makePlayer()
  justEnough.survivalTime = 180
  assert.ok(evaluateAchievements(createRunStats(), world, justEnough, new Set()).includes('survive180'))

  const notEnough = makePlayer()
  notEnough.survivalTime = 179.99
  assert.equal(
    evaluateAchievements(createRunStats(), world, notEnough, new Set()).includes('survive180'),
    false,
  )
})
