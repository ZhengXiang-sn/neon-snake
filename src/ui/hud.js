import { POWERUP_COLORS } from '../render/renderer.js'
import { POWERUP_TYPES, POWERUP_INFO } from '../config.js'
import { clamp, TAU } from '../core/math.js'
import { formatTime } from '../core/format.js'

const MINIMAP_FPS_DIVIDER = 4

/** HUD：分数 / 质量 / 连击 / 道具计时 / 小地图。DOM 文本保证锐利与可读性。 */
export function createHud(root) {
  const $ = (sel) => root.querySelector(sel)
  const el = {
    hud: $('#hud'),
    score: $('#hud-score'),
    mass: $('#hud-mass'),
    time: $('#hud-time'),
    bots: $('#hud-bots'),
    combo: $('#hud-combo'),
    comboMult: $('#hud-combo-mult'),
    comboFill: $('#hud-combo-fill'),
    powerups: $('#hud-powerups'),
    hint: $('#hud-hint'),
    minimap: $('#minimap'),
    boostBtn: $('#btn-boost'),
  }
  const mapCtx = el.minimap.getContext('2d')
  const chips = new Map()
  /** 复用的"当前生效道具"集合，避免逐帧 new Set 产生 GC 抖动 */
  const activeChips = new Set()
  let frame = 0
  let lastScore = -1
  let hintHidden = false

  function ensureChip(type) {
    let chip = chips.get(type)
    if (chip) return chip
    const wrap = document.createElement('div')
    wrap.className = 'chip'
    wrap.style.setProperty('--chip-color', POWERUP_COLORS[type] || '#fff')
    wrap.innerHTML = `<span class="dot"></span><span>${POWERUP_INFO[type]?.name ?? type}</span><span class="bar"><i></i></span>`
    el.powerups.appendChild(wrap)
    chip = { wrap, fill: wrap.querySelector('i') }
    chips.set(type, chip)
    return chip
  }

  function resizeMinimap() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const size = 152
    el.minimap.width = Math.round(size * dpr)
    el.minimap.height = Math.round(size * dpr)
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resizeMinimap()

  function drawMinimap(world, theme) {
    const size = 152
    const c = mapCtx
    c.clearRect(0, 0, size, size)
    const R = world.arenaRadius
    const scale = (size / 2 - 6) / Math.max(1, R)
    const cx = size / 2
    const cy = size / 2

    c.beginPath()
    c.arc(cx, cy, R * scale, 0, TAU)
    c.fillStyle = 'rgba(255,255,255,0.035)'
    c.fill()
    c.strokeStyle = theme.ring
    c.lineWidth = 1.2
    c.globalAlpha = 0.7
    c.stroke()
    c.globalAlpha = 1

    c.fillStyle = 'rgba(255,255,255,0.12)'
    for (const o of world.obstacles) {
      c.beginPath()
      c.arc(cx + o.x * scale, cy + o.y * scale, Math.max(1, o.r * scale), 0, TAU)
      c.fill()
    }

    c.fillStyle = theme.food.common
    c.globalAlpha = 0.42
    const food = world.food
    for (let i = 0; i < food.length; i += 4) {
      const f = food[i]
      if (!f.alive) continue
      c.fillRect(cx + f.x * scale - 0.6, cy + f.y * scale - 0.6, 1.2, 1.2)
    }
    c.globalAlpha = 1

    for (const p of world.powerups) {
      if (!p.alive) continue
      c.fillStyle = POWERUP_COLORS[p.type] || '#fff'
      c.beginPath()
      c.arc(cx + p.x * scale, cy + p.y * scale, 2, 0, TAU)
      c.fill()
    }

    for (let i = 1; i < world.snakes.length; i++) {
      const s = world.snakes[i]
      if (!s.alive) continue
      c.fillStyle = 'rgba(255,255,255,0.5)'
      c.beginPath()
      c.arc(cx + s.x * scale, cy + s.y * scale, 2.2, 0, TAU)
      c.fill()
    }

    const player = world.player
    if (player.alive) {
      c.fillStyle = theme.ui.accent
      c.beginPath()
      c.arc(cx + player.x * scale, cy + player.y * scale, 3.4, 0, TAU)
      c.fill()
      c.globalAlpha = 0.35
      c.beginPath()
      c.arc(cx + player.x * scale, cy + player.y * scale, 6.5, 0, TAU)
      c.fill()
      c.globalAlpha = 1
    }
  }

  return {
    show() {
      el.hud.classList.remove('hidden')
    },
    hide() {
      el.hud.classList.add('hidden')
    },
    setBoostVisible(visible) {
      el.boostBtn.classList.toggle('hidden', !visible)
    },
    notifyInput() {
      if (hintHidden) return
      hintHidden = true
      el.hint.style.opacity = '0'
      el.hint.style.transition = 'opacity .4s ease'
    },
    setTheme(theme) {
      const r = document.documentElement.style
      r.setProperty('--accent', theme.ui.accent)
      r.setProperty('--accent-soft', theme.ui.accentSoft)
      r.setProperty('--danger', theme.ui.danger)
    },
    update(world, theme) {
      const player = world.player
      if (world.score !== lastScore) {
        lastScore = world.score
        el.score.textContent = String(world.score)
      }
      el.mass.textContent = String(Math.floor(player.mass))
      el.time.textContent = formatTime(world.elapsed)
      el.bots.textContent = String(world.aliveBots)

      if (player.combo >= 2) {
        el.combo.hidden = false
        el.comboMult.textContent = `×${player.comboMult}`
        const ratio = clamp(player.comboTimer / world.cfg.comboWindow, 0, 1)
        el.comboFill.style.transform = `scaleX(${ratio})`
      } else if (!el.combo.hidden) {
        el.combo.hidden = true
      }

      const active = activeChips
      active.clear()
      for (const name of POWERUP_TYPES) {
        if (!player.hasEffect(name)) continue
        active.add(name)
        const chip = ensureChip(name)
        chip.wrap.hidden = false
        if (name === 'shield') {
          // 护盾是一次性充能，没有倒计时，条始终填满
          chip.fill.style.transform = 'scaleX(1)'
        } else {
          const total = world.cfg.powerupDurations[name] || 1
          chip.fill.style.transform = `scaleX(${clamp(player.effects[name] / total, 0, 1)})`
        }
      }
      for (const [name, chip] of chips) {
        if (!active.has(name)) chip.wrap.hidden = true
      }

      frame++
      if (frame % MINIMAP_FPS_DIVIDER === 0) drawMinimap(world, theme)
    },
  }
}
