import { CONFIG, createGameConfig, SNAKE_COLORS, POWERUP_INFO } from './config.js'
import { World } from './game/world.js'
import { createCamera } from './game/camera.js'
import { createBrain } from './game/ai.js'
import { createRunStats, evaluateAchievements, ACHIEVEMENT_BY_ID } from './game/achievements.js'
import { createLoop } from './core/loop.js'
import { createInput } from './core/input.js'
import { createAudio } from './core/audio.js'
import { createStorage } from './core/storage.js'
import { createRenderer, POWERUP_COLORS } from './render/renderer.js'
import { getTheme, THEME_LIST } from './render/theme.js'
import { createHud } from './ui/hud.js'
import { createScreens } from './ui/screens.js'
import { clamp } from './core/math.js'

const KEY_TURN_RATE = 3.6
/** 触屏转向的死区（CSS 像素）：手指几乎按在蛇身上时不改变朝向，避免抖动 */
const TOUCH_STEER_DEAD_ZONE = 46
const CAUSE_TEXT = {
  wall: '撞上了竞技场边界',
  rock: '撞上了陨石',
  self: '缠住了自己的身体',
  snake: '撞上了对手的身体',
}

const root = document.getElementById('app')
const canvas = document.getElementById('game')
const storage = createStorage()
const audio = createAudio()

/** 设置：从本地读取并做一次合法性校验，避免脏数据导致崩溃。 */
const settings = {
  difficulty: 'normal',
  theme: 'neon',
  quality: 'high',
  sound: true,
  reducedMotion: false,
}

function loadSettings() {
  const saved = storage.get(CONFIG.storageKeys.settings, null)
  // 系统级「减少动态效果」作为默认值；用户显式保存过的选择优先。
  const prefersReduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReduced) settings.reducedMotion = true
  if (!saved || typeof saved !== 'object') return
  if (['easy', 'normal', 'hard'].includes(saved.difficulty)) settings.difficulty = saved.difficulty
  if (['high', 'medium', 'low'].includes(saved.quality)) settings.quality = saved.quality
  // 主题必须过白名单，否则非法值会让菜单没有任何高亮项，界面与渲染不一致
  if (THEME_LIST.some((t) => t.id === saved.theme)) settings.theme = saved.theme
  if (typeof saved.sound === 'boolean') settings.sound = saved.sound
  if (typeof saved.reducedMotion === 'boolean') settings.reducedMotion = saved.reducedMotion
}
loadSettings()
audio.setEnabled(settings.sound)

let theme = getTheme(settings.theme)
let best = Number(storage.get(CONFIG.storageKeys.highScore, 0)) || 0
const unlocked = new Set(
  (storage.get(CONFIG.storageKeys.achievements, []) || []).filter((id) => ACHIEVEMENT_BY_ID.has(id)),
)

const renderer = createRenderer(canvas)
const camera = createCamera()
const hud = createHud(root)

renderer.setTheme(theme)
hud.setTheme(theme)
camera.reducedMotion = settings.reducedMotion
renderer.particles.setEnabled(!settings.reducedMotion)
if (settings.reducedMotion) document.documentElement.classList.add('reduced-motion')

let world = new World(createGameConfig({ difficulty: settings.difficulty }))
let run = createRunStats()
let mode = 'menu'
let pendingDeathCause = null
let wasBoosting = false
let attractStarted = false

// ------------------------------------------------------------------ 屏幕

const screens = createScreens(root, {
  settings,
  onStart: () => startRun(),
  onResume: () => resume(),
  onRestart: () => startRun(),
  onQuit: () => quitToMenu(),
  onPauseToggle: () => (mode === 'playing' ? pause() : mode === 'paused' ? resume() : undefined),
  onQualityChange: (value) => {
    renderer.setQuality(value)
    persistSettings()
  },
  onThemeChange: (value) => applyTheme(value),
  onSoundChange: (value) => {
    audio.setEnabled(value)
    if (value) audio.play('ui')
    persistSettings()
  },
  onMotionChange: (value) => {
    camera.reducedMotion = value
    renderer.particles.setEnabled(!value)
    document.documentElement.classList.toggle('reduced-motion', value)
    persistSettings()
  },
  onSettingsChange: () => persistSettings(),
  getBest: () => best,
  getUnlocked: () => unlocked,
})

function persistSettings() {
  storage.set(CONFIG.storageKeys.settings, settings)
}

function applyTheme(id) {
  settings.theme = id
  theme = getTheme(id)
  renderer.setTheme(theme)
  hud.setTheme(theme)
  persistSettings()
}

// ------------------------------------------------------------------ 输入

const input = createInput(canvas, { onAction: handleAction })

function handleAction(action) {
  audio.unlock()
  // 「玩法说明」「成就」是主菜单之上的覆盖层，mode 仍是 menu。
  // 此时 Esc / Enter 应当是"关掉这层"，而不是穿透到主菜单去开一局。
  const overlay = screens.activeScreen
  if (overlay === 'help' || overlay === 'achievements') {
    if (action === 'pause' || action === 'confirm') screens.show('menu')
    return
  }
  if (action === 'mute') {
    settings.sound = !settings.sound
    audio.setEnabled(settings.sound)
    screens.syncSegs()
    persistSettings()
    screens.toast(settings.sound ? '音效已开启' : '音效已关闭', 1200)
    return
  }
  if (action === 'pause') {
    if (mode === 'playing') pause()
    else if (mode === 'paused') resume()
    return
  }
  if (action === 'restart') {
    if (mode !== 'menu') startRun()
    return
  }
  if (action === 'confirm') {
    if (mode === 'menu' || mode === 'over') startRun()
    else if (mode === 'paused') resume()
  }
}

const boostButton = document.getElementById('btn-boost')
function setTouchBoost(value) {
  input.setTouchBoostButton(value)
}
boostButton.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  setTouchBoost(true)
  if (boostButton.setPointerCapture) boostButton.setPointerCapture(e.pointerId)
})
boostButton.addEventListener('pointerup', () => setTouchBoost(false))
boostButton.addEventListener('pointercancel', () => setTouchBoost(false))
boostButton.addEventListener('pointerleave', () => setTouchBoost(false))

window.addEventListener(
  'pointerdown',
  () => audio.unlock(),
  { once: true, passive: true },
)
window.addEventListener('keydown', () => audio.unlock(), { once: true })

// ------------------------------------------------------------------ 局流程

function startRun() {
  audio.unlock()
  world = new World(createGameConfig({ difficulty: settings.difficulty }))
  world.newGame()
  run = createRunStats()
  pendingDeathCause = null
  wasBoosting = false
  attractStarted = false
  audio.stopBoost()
  camera.reset(world.player.x, world.player.y)
  camera.reducedMotion = settings.reducedMotion
  renderer.particles.clear()
  mode = 'playing'
  screens.hideAll()
  hud.show()
  hud.setBoostVisible(!!input.state.isTouch)
  input.setEnabled(true)
  input.reset()
  loop.setPaused(false)
  loop.start()
  screens.toast('开始！吃掉食物，撞死对手', 2000)
}

function pause() {
  if (mode !== 'playing') return
  mode = 'paused'
  input.setEnabled(false)
  audio.stopBoost()
  wasBoosting = false
  loop.setPaused(true)
  screens.show('pause')
}

function resume() {
  if (mode !== 'paused') return
  mode = 'playing'
  screens.hideAll()
  input.setEnabled(true)
  loop.setPaused(false)
}

function quitToMenu() {
  mode = 'menu'
  input.setEnabled(false)
  audio.stopBoost()
  wasBoosting = false
  loop.setPaused(false)
  hud.hide()
  screens.show('menu')
  screens.refreshMeta()
  startAttract()
}

function endRun(cause) {
  if (mode === 'over') return
  mode = 'over'
  input.setEnabled(false)
  audio.stopBoost()
  wasBoosting = false
  camera.shake(22, 0.6)
  camera.pulse('255,80,110', 0.8)

  const score = world.score
  const isRecord = score > best
  if (isRecord) {
    best = score
    storage.set(CONFIG.storageKeys.highScore, best)
    audio.play('record')
  }

  hud.hide()
  screens.showGameOver({
    score,
    best,
    isRecord,
    elapsed: world.elapsed,
    kills: world.kills,
    mass: world.player.mass,
    combo: world.player.comboMult,
    cause: CAUSE_TEXT[cause] || '游戏结束',
  })
  screens.refreshMeta()
}

/**
 * 主菜单背景使用"吸引模式"：真正开一局，然后把玩家蛇交给 AI 接管。
 * 早期版本只挂了 AI 却没有 newGame，世界仍处于 idle 状态、场上没有食物与陨石，
 * 于是"吸引模式"实际上什么都没发生。
 */
function startAttract() {
  world.newGame()
  if (!world.player.ai) world.player.ai = createBrain(world.cfg, world.rng)
  attractStarted = true
}

// ------------------------------------------------------------------ 循环

function applyPlayerInput(dt) {
  const player = world.player
  if (!player.alive) return
  const s = input.state
  if (s.usedAnyInput) hud.notifyInput()
  if (s.mode === 'pointer' && s.pointerSeen) {
    // 直接在屏幕空间比较：相机变换只有平移与等比缩放、没有旋转，
    // 所以屏幕位移的方向与世界的方向完全一致，不必先把指针换算成世界坐标。
    const vp = renderer.viewport
    const sx = (player.x - camera.x) * camera.zoom + vp.w / 2
    const sy = (player.y - camera.y) * camera.zoom + vp.h / 2
    const dx = s.pointerX - sx
    const dy = s.pointerY - sy
    // 死区也必须是屏幕像素：鼠标用"蛇的屏幕半径"，触屏用固定的手指宽度
    const dead = s.pointerType === 'mouse' ? player.radius * 1.26 * camera.zoom : TOUCH_STEER_DEAD_ZONE
    if (dx * dx + dy * dy > dead * dead) {
      player.steerTo(Math.atan2(dy, dx))
    }
  } else {
    player.steerBy(s.steerAxis * KEY_TURN_RATE * dt)
  }
  player.boosting = s.boost && player.canBoost
}

/**
 * 消费世界事件。`silent = true` 用于主菜单的吸引模式：
 * 只保留视觉反馈，不播声音、不弹提示、不计入本局统计。
 */
function handleWorldEvents(silent = false) {
  const events = world.events
  if (events.length === 0) return
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    switch (ev.type) {
      case 'eat': {
        const color =
          ev.tier === 'gem' ? theme.food.gem : ev.tier === 'gold' ? theme.food.gold : theme.food.common
        const strength = ev.tier === 'gem' ? 1.9 : ev.tier === 'gold' ? 1.35 : 1
        renderer.particles.sparkle(ev.x, ev.y, color, strength)
        if (silent) break
        if (ev.tier === 'gold') audio.play('gold')
        else if (ev.tier === 'gem') audio.play('gem')
        else audio.play('eat', { step: ev.combo })
        if (ev.isPlayer) {
          if (ev.tier === 'gold') run.gold += 1
          if (ev.tier === 'gem') run.gem += 1
          run.maxCombo = Math.max(run.maxCombo, ev.combo)
          if (ev.combo > 1 && ev.combo % world.cfg.comboPerStack === 0) {
            audio.play('combo', { level: ev.comboMult })
            camera.pulse('120,255,220', 0.05)
          }
        }
        break
      }
      case 'death': {
        renderer.particles.explosion(ev.x, ev.y, ev.color, ev.mass)
        renderer.particles.ring(ev.x, ev.y, ev.color, 26, 0.55)
        const power = clamp(ev.mass * 0.16, 4, 26)
        camera.shake(power, 0.45)
        if (silent) break
        audio.play('death')
        if (ev.isPlayer) pendingDeathCause = ev.cause
        break
      }
      case 'shieldBreak': {
        renderer.particles.ring(ev.x, ev.y, '#8ff4ff', 30, 0.5)
        renderer.particles.sparkle(ev.x, ev.y, '#8ff4ff', 1.6)
        if (silent) break
        audio.play('powerup')
        if (ev.isPlayer) screens.toast('护盾挡下了一次撞击', 1400)
        break
      }
      case 'kill': {
        if (silent) break
        audio.play('kill')
        if (ev.byPlayer) screens.toast('击杀！+60 分', 1400)
        break
      }
      case 'powerup': {
        renderer.particles.ring(ev.x, ev.y, POWERUP_COLORS[ev.powerup] || '#fff', 22, 0.6)
        renderer.particles.sparkle(ev.x, ev.y, POWERUP_COLORS[ev.powerup] || '#fff', 1.4)
        if (silent) break
        audio.play('powerup')
        if (ev.isPlayer) {
          run.powerups += 1
          screens.toast(POWERUP_INFO[ev.powerup]?.toast ?? '道具已激活', 1500)
        }
        break
      }
      default:
        break
    }
  }
  events.length = 0
}

function checkAchievements() {
  const fresh = evaluateAchievements(run, world, world.player, unlocked)
  if (fresh.length === 0) return
  storage.set(CONFIG.storageKeys.achievements, Array.from(unlocked))
  for (const id of fresh) {
    const def = ACHIEVEMENT_BY_ID.get(id)
    if (def) screens.toast(`成就解锁 · ${def.name}`, 2200)
  }
  audio.play('record')
  screens.refreshMeta()
}

let qualityChecked = 0

function onStep(dt) {
  if (mode === 'menu') {
    if (!attractStarted) startAttract()
    world.step(dt)
    handleWorldEvents(true)
    // 吸引模式里玩家蛇也是 AI，会死；死了就悄悄重开一局继续演
    if (!world.player.alive) startAttract()
    return
  }
  if (mode !== 'playing') return

  applyPlayerInput(dt)
  world.step(dt)

  const player = world.player
  if (player.boosting && player.alive && player.nodeCount > 0) {
    const tail = player.nodes[player.nodeCount - 1]
    renderer.particles.trail(tail.x, tail.y, SNAKE_COLORS[0].glow, player.angle)
  }
  if (player.boosting !== wasBoosting) {
    if (player.boosting) audio.startBoost()
    else audio.stopBoost()
    wasBoosting = player.boosting
  }

  handleWorldEvents()
  checkAchievements()
  renderer.particles.update(dt)

  if (!player.alive) endRun(pendingDeathCause)
}

function onRender(_alpha, delta) {
  // 暂停时把 delta 归零：世界与相机一起冻结，而不是相机继续偷偷追上蛇头
  const live = mode === 'playing' ? delta : 0
  camera.update(live, world.player, renderer.viewport)
  renderer.render(world, camera, performance.now() / 1000)
  if (mode === 'playing' || mode === 'paused') hud.update(world, theme)

  qualityChecked++
  if (qualityChecked % 45 === 0) maybeDowngrade()
}

function maybeDowngrade() {
  const win = loop.consumeWindowAvg()
  if (!win || win.frames < CONFIG.quality.windowFrames) return
  if (mode === 'menu') return
  if (win.avg <= CONFIG.quality.downshiftFrameMs) return
  if (settings.quality === 'low') return
  const next = settings.quality === 'high' ? 'medium' : 'low'
  settings.quality = next
  renderer.setQuality(next)
  screens.syncSegs()
  persistSettings()
  screens.toast(`帧率偏低，画质已自动降级为「${next === 'medium' ? '中' : '低'}」`, 2600)
}

const loop = createLoop({
  step: CONFIG.fixedStep,
  maxSubSteps: CONFIG.maxSubSteps,
  onStep,
  onRender,
})

// ------------------------------------------------------------------ 诊断接口

/**
 * 只读诊断快照，供端到端冒烟测试与线上问题排查使用。
 * 刻意不暴露任何可写入口，避免被当作作弊通道。
 */
window.__neonSnake = {
  version: '1.1.0',
  snapshot() {
    return {
      mode,
      screen: screens.activeScreen,
      difficulty: settings.difficulty,
      theme: settings.theme,
      quality: settings.quality,
      sound: settings.sound,
      reducedMotion: settings.reducedMotion,
      score: world.score,
      best,
      elapsed: world.elapsed,
      arenaRadius: world.arenaRadius,
      playerAlive: world.player.alive,
      playerMass: world.player.mass,
      playerNodes: world.player.nodeCount,
      playerAngle: world.player.angle,
      playerBoosting: world.player.boosting,
      playerShield: world.player.effects.shield,
      minMassToBoost: world.cfg.minMassToBoost,
      inputMode: input.state.mode,
      isTouch: input.state.isTouch,
      pathPoints: world.player.path.count,
      aliveBots: world.aliveBots,
      particleLimit: renderer.particles.limit,
      unlocked: Array.from(unlocked),
    }
  },
}

// ------------------------------------------------------------------ 生命周期

if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(() => renderer.resize())
  ro.observe(canvas)
}
// 始终监听窗口 resize：拖到不同 DPR 的外接屏而窗口尺寸不变时，
// ResizeObserver 不会触发，但画布缓冲区必须按新的 devicePixelRatio 重建。
window.addEventListener('resize', () => renderer.resize())
window.addEventListener('orientationchange', () => window.setTimeout(() => renderer.resize(), 120))

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'playing') pause()
})

window.addEventListener('blur', () => {
  if (mode === 'playing') pause()
})

renderer.resize()
renderer.setQuality(settings.quality)
screens.refreshMeta()
screens.show('menu')
hud.hide()
hud.setBoostVisible(!!input.state.isTouch)
startAttract()
loop.start()
