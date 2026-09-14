/**
 * 输入层：把键盘 / 鼠标 / 触屏三种设备统一成一组"意图"。
 *
 * 仲裁规则（最后输入优先 + 键盘优先窗）：
 * - 按下转向键 → 立即进入键盘模式，并在 1.8s 内忽略指针接管；
 * - 指针移动/触摸且已过优先窗 → 进入指针模式（鼠标是"跟随光标"，触屏是"拖向手指"）；
 * - 只有鼠标按住才触发加速；触屏用屏幕按钮或"双击并按住"，避免拖动转向时误加速。
 */

const STEER_LEFT = ['ArrowLeft', 'KeyA']
const STEER_RIGHT = ['ArrowRight', 'KeyD']
const BOOST_KEYS = ['ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight', 'Space']
const PREVENT_DEFAULT = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
])

const POINTER_TAKEOVER_MS = 1800
const DOUBLE_TAP_MS = 320

export function createInput(canvas, { onAction } = {}) {
  const keys = new Set()
  const state = {
    enabled: false,
    mode: 'keyboard',
    steerAxis: 0,
    boost: false,
    pointerX: 0,
    pointerY: 0,
    pointerDown: false,
    pointerSeen: false,
    /** 最近一次按下指针的类型（mouse / touch / pen），决定"按住加速"是否生效 */
    pointerType: 'mouse',
    touchBoostHold: false,
    touchBoostButton: false,
    usedAnyInput: false,
    isTouch: false,
  }

  let keyStamp = -1e9
  let lastTouchDown = -1e9
  const now = () => performance.now()

  function refreshSteer() {
    let axis = 0
    if (STEER_LEFT.some((c) => keys.has(c))) axis -= 1
    if (STEER_RIGHT.some((c) => keys.has(c))) axis += 1
    state.steerAxis = axis
  }

  function refreshBoost() {
    const keyBoost = BOOST_KEYS.some((c) => keys.has(c))
    // 按当前指针类型判断，而不是"这台机器是不是触屏设备"：
    // 触屏笔记本上摸一下屏幕之后，鼠标按住左键加速必须依然可用。
    const mouseBoost = state.pointerDown && state.pointerType === 'mouse'
    state.boost =
      state.enabled &&
      (keyBoost || mouseBoost || state.touchBoostHold || state.touchBoostButton)
  }

  function onKeyDown(e) {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault()
    if (e.repeat) return
    const isSteer = STEER_LEFT.includes(e.code) || STEER_RIGHT.includes(e.code)
    if (isSteer) {
      keys.add(e.code)
      keyStamp = now()
      state.mode = 'keyboard'
      state.usedAnyInput = true
      refreshSteer()
      refreshBoost()
      return
    }
    if (BOOST_KEYS.includes(e.code)) {
      keys.add(e.code)
      state.usedAnyInput = true
      refreshBoost()
      return
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      onAction?.('pause')
      return
    }
    if (e.code === 'KeyM') {
      onAction?.('mute')
      return
    }
    if (e.code === 'KeyR') {
      onAction?.('restart')
      return
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      onAction?.('confirm')
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code)
    refreshSteer()
    refreshBoost()
  }

  function updatePointer(e) {
    const rect = canvas.getBoundingClientRect()
    state.pointerX = e.clientX - rect.left
    state.pointerY = e.clientY - rect.top
  }

  function onPointerMove(e) {
    updatePointer(e)
    state.pointerSeen = true
    state.usedAnyInput = true
    if (e.pointerType !== 'mouse') {
      // 触摸没有"悬停"，能收到 move 就说明手指已经在屏幕上拖动 → 直接进入指针模式
      state.mode = 'pointer'
      return
    }
    if (now() - keyStamp > POINTER_TAKEOVER_MS) state.mode = 'pointer'
  }

  function onPointerDown(e) {
    const isTouchPointer = e.pointerType !== 'mouse'
    state.pointerType = e.pointerType
    if (isTouchPointer) state.isTouch = true
    updatePointer(e)
    state.pointerSeen = true
    state.pointerDown = true
    state.usedAnyInput = true
    if (isTouchPointer) {
      // 触屏：按下即接管转向，这样手机端才有可用的 360° 操作方式
      state.mode = 'pointer'
      const t = now()
      if (t - lastTouchDown < DOUBLE_TAP_MS) state.touchBoostHold = true
      lastTouchDown = t
    } else if (now() - keyStamp > POINTER_TAKEOVER_MS) {
      state.mode = 'pointer'
    }
    refreshBoost()
  }

  function onPointerUp() {
    state.pointerDown = false
    state.touchBoostHold = false
    refreshBoost()
  }

  const onBlur = () => {
    keys.clear()
    state.pointerDown = false
    state.touchBoostHold = false
    refreshSteer()
    refreshBoost()
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  state.isTouch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches

  return {
    state,
    setEnabled(value) {
      if (value === state.enabled) return
      state.enabled = value
      refreshBoost()
    },
    /** 屏幕按钮按住时调用 */
    setTouchBoostButton(value) {
      state.touchBoostButton = value
      refreshBoost()
    },
    reset() {
      keys.clear()
      state.pointerDown = false
      state.touchBoostHold = false
      refreshSteer()
      refreshBoost()
    },
    dispose() {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}
