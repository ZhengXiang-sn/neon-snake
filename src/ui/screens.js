import { THEME_LIST } from '../render/theme.js'
import { ACHIEVEMENTS } from '../game/achievements.js'
import { POWERUP_TYPES, POWERUP_INFO } from '../config.js'
import { formatTime, formatScore } from '../core/format.js'

/** 玩法说明中的道具条目直接由 POWERUP_INFO 生成，避免说明与实现各写一份文案。 */
function powerupHelpText() {
  return POWERUP_TYPES.map((t) => POWERUP_INFO[t]?.desc).filter(Boolean).join('；') + '。'
}

/** 生态说明同样由主题表生成：布局特征写在 theme.blurb 里，不重复维护。 */
function biomeHelpText() {
  return THEME_LIST.map((t) => `${t.name}（${t.blurb}）`).join('；') + '。在菜单里切换生态会立即重构地形。'
}

/**
 * 覆盖层与设置面板。所有交互元素都是原生 button/input，
 * 天然支持键盘 Tab 导航与读屏。
 */
export function createScreens(root, opts) {
  const settings = opts.settings
  const $ = (sel) => root.querySelector(sel)

  const screens = {
    menu: $('#screen-menu'),
    pause: $('#screen-pause'),
    over: $('#screen-over'),
    help: $('#screen-help'),
    achievements: $('#screen-achievements'),
  }
  const toasts = $('#toasts')
  const achList = $('#ach-list')
  let activeScreen = 'menu'

  function show(name) {
    activeScreen = name
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name)
    }
  }

  function hideAll() {
    activeScreen = null
    for (const key of Object.keys(screens)) screens[key].classList.add('hidden')
  }

  function bindSeg(container, key, onChange) {
    const buttons = Array.from(container.querySelectorAll('button'))
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value
        buttons.forEach((b) => b.classList.toggle('active', b === btn))
        settings[key] = value
        onChange?.(value)
      })
    })
    return (value) => {
      buttons.forEach((b) => b.classList.toggle('active', b.dataset.value === value))
    }
  }

  const difficultySeg = $('#seg-difficulty')
  const qualitySeg = $('#seg-quality')
  const themeSeg = $('#seg-theme')

  THEME_LIST.forEach((t) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.value = t.id
    btn.textContent = t.name
    themeSeg.appendChild(btn)
  })

  const setDifficulty = bindSeg(difficultySeg, 'difficulty', (v) => opts.onSettingsChange?.())
  const setQuality = bindSeg(qualitySeg, 'quality', (v) => opts.onQualityChange?.(v))
  const setTheme = bindSeg(themeSeg, 'theme', (v) => opts.onThemeChange?.(v))
  setDifficulty(settings.difficulty)
  setQuality(settings.quality)
  setTheme(settings.theme)

  /** 生态简介跟着选中项走，让"选了哪一个、它是什么地图"一眼可见。 */
  function syncBlurb() {
    const el = $('#theme-blurb')
    if (el) el.textContent = THEME_LIST.find((t) => t.id === settings.theme)?.blurb ?? ''
  }
  syncBlurb()

  const soundBox = $('#opt-sound')
  const motionBox = $('#opt-motion')
  soundBox.checked = settings.sound
  motionBox.checked = settings.reducedMotion
  soundBox.addEventListener('change', () => {
    settings.sound = soundBox.checked
    opts.onSoundChange?.(settings.sound)
  })
  motionBox.addEventListener('change', () => {
    settings.reducedMotion = motionBox.checked
    opts.onMotionChange?.(settings.reducedMotion)
  })

  function renderAchievements() {
    const unlocked = opts.getUnlocked()
    achList.innerHTML = ''
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement('li')
      if (unlocked.has(a.id)) li.classList.add('unlocked')
      li.innerHTML =
        `<span class="ach-badge"></span><span><span class="ach-name">${a.name}</span><br>` +
        `<span class="ach-desc">${a.desc}</span></span>`
      achList.appendChild(li)
    }
  }

  $('#btn-play').addEventListener('click', () => opts.onStart?.())
  $('#btn-help').addEventListener('click', () => {
    $('#help-powerups').textContent = powerupHelpText()
    show('help')
  })
  $('#btn-help-back').addEventListener('click', () => show('menu'))
  $('#btn-achievements').addEventListener('click', () => {
    renderAchievements()
    show('achievements')
  })
  $('#btn-ach-back').addEventListener('click', () => show('menu'))
  $('#btn-resume').addEventListener('click', () => opts.onResume?.())
  $('#btn-restart').addEventListener('click', () => opts.onRestart?.())
  $('#btn-quit').addEventListener('click', () => opts.onQuit?.())
  $('#btn-again').addEventListener('click', () => opts.onRestart?.())
  $('#btn-back').addEventListener('click', () => opts.onQuit?.())
  $('#btn-pause').addEventListener('click', () => opts.onPauseToggle?.())

  return {
    settings,
    get activeScreen() {
      return activeScreen
    },
    show,
    hideAll,
    toast(text, duration = 1800) {
      const node = document.createElement('div')
      node.className = 'toast'
      node.textContent = text
      toasts.appendChild(node)
      window.setTimeout(() => node.remove(), duration)
    },
    renderAchievements,
    refreshMeta() {
      $('#menu-best').textContent = formatScore(opts.getBest())
      $('#menu-ach').textContent = `${opts.getUnlocked().size}/${ACHIEVEMENTS.length}`
    },
    /** 设置被程序化修改（例如自适应降档）后同步 UI 选中态。 */
    syncSegs() {
      setDifficulty(settings.difficulty)
      setQuality(settings.quality)
      setTheme(settings.theme)
      soundBox.checked = settings.sound
      motionBox.checked = settings.reducedMotion
    },
    showGameOver({ score, best, isRecord, elapsed, kills, mass, combo, cause }) {
      $('#over-title').textContent = isRecord ? '新纪录！' : '本局结束'
      $('#over-score').textContent = formatScore(score)
      $('#over-best').textContent = formatScore(best)
      $('#over-time').textContent = formatTime(elapsed)
      $('#over-kills').textContent = String(kills)
      $('#over-mass').textContent = String(Math.floor(mass))
      $('#over-combo').textContent = `×${combo}`
      $('#over-cause').textContent = cause
      show('over')
    },
  }
}
