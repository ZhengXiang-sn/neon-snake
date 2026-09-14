/**
 * 程序化音效（Web Audio API）。
 * 全部实时合成，不引入任何音频素材：零体积、零版权风险、离线可用。
 * AudioContext 在首次用户交互后才创建，符合浏览器自动播放策略。
 */
export function createAudio() {
  let ctx = null
  let master = null
  let enabled = true
  let noiseBuffer = null
  let boostNodes = null

  function ensure() {
    if (!enabled) return null
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      try {
        ctx = new AC()
        master = ctx.createGain()
        master.gain.value = 0.55
        master.connect(ctx.destination)
      } catch {
        // 构造失败（上下文数超限 / 被策略拒绝）时静默降级为无声，绝不冒泡成未捕获异常
        ctx = null
        master = null
        return null
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  }

  function getNoise() {
    if (noiseBuffer) return noiseBuffer
    const len = Math.floor(ctx.sampleRate * 1.2)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    noiseBuffer = buf
    return buf
  }

  function tone(freq, opts = {}) {
    const c = ensure()
    if (!c) return
    const {
      type = 'sine',
      dur = 0.12,
      gain = 0.18,
      at = 0,
      slideTo = null,
      attack = 0.006,
      detune = 0,
    } = opts
    const t = c.currentTime + at
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = type
    osc.detune.value = detune
    osc.frequency.setValueAtTime(Math.max(20, freq), t)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  function noise(opts = {}) {
    const c = ensure()
    if (!c) return
    const {
      dur = 0.3,
      gain = 0.16,
      at = 0,
      filter = 'bandpass',
      f0 = 400,
      f1 = 120,
      q = 0.8,
    } = opts
    const t = c.currentTime + at
    const src = c.createBufferSource()
    src.buffer = getNoise()
    const bq = c.createBiquadFilter()
    bq.type = filter
    bq.Q.value = q
    bq.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bq)
    bq.connect(g)
    g.connect(master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  const api = {
    get enabled() {
      return enabled
    },
    setEnabled(value) {
      enabled = !!value
      if (!enabled) {
        api.stopBoost()
        if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {})
      } else if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      return enabled
    },
    /** 首次用户手势时调用，满足自动播放策略。 */
    unlock() {
      ensure()
    },
    play(name, data = {}) {
      if (!enabled) return
      switch (name) {
        case 'eat': {
          const step = Math.min(data.step ?? 0, 18)
          const f = 520 * Math.pow(2, step / 14)
          tone(f, { type: 'triangle', dur: 0.085, gain: 0.14, slideTo: f * 1.45 })
          break
        }
        case 'gold':
          tone(760, { type: 'triangle', dur: 0.1, gain: 0.16, slideTo: 1180 })
          tone(1140, { type: 'sine', dur: 0.16, gain: 0.1, at: 0.06, slideTo: 1520 })
          break
        case 'gem':
          ;[0, 0.055, 0.11].forEach((at, i) => {
            tone(880 * Math.pow(2, i / 6), {
              type: 'square',
              dur: 0.13,
              gain: 0.1,
              at,
            })
          })
          break
        case 'powerup':
          ;[0, 0.07, 0.14, 0.21].forEach((at, i) => {
            tone(520 * Math.pow(2, i / 4), { type: 'triangle', dur: 0.16, gain: 0.11, at })
          })
          break
        case 'combo':
          tone(700 + Math.min(data.level ?? 0, 8) * 90, {
            type: 'sine',
            dur: 0.14,
            gain: 0.13,
            slideTo: 900 + Math.min(data.level ?? 0, 8) * 120,
          })
          break
        case 'boost':
          noise({ dur: 0.28, gain: 0.09, filter: 'highpass', f0: 900, f1: 1500, q: 0.6 })
          break
        case 'kill':
          tone(180, { type: 'sawtooth', dur: 0.24, gain: 0.14, slideTo: 90 })
          noise({ dur: 0.32, gain: 0.14, filter: 'lowpass', f0: 1800, f1: 220 })
          break
        case 'death':
          tone(320, { type: 'sawtooth', dur: 0.7, gain: 0.2, slideTo: 48 })
          tone(160, { type: 'square', dur: 0.55, gain: 0.12, slideTo: 40, at: 0.03 })
          noise({ dur: 0.85, gain: 0.2, filter: 'lowpass', f0: 2200, f1: 120 })
          break
        case 'warn':
          tone(220, { type: 'sine', dur: 0.16, gain: 0.09 })
          break
        case 'ui':
          tone(660, { type: 'sine', dur: 0.06, gain: 0.1, slideTo: 880 })
          break
        case 'record':
          ;[0, 0.11, 0.22, 0.36].forEach((at, i) => {
            tone([523, 659, 784, 1046][i], { type: 'triangle', dur: 0.3, gain: 0.13, at })
          })
          break
        default:
          break
      }
    },
    startBoost() {
      if (!enabled || !ensure() || boostNodes) return
      const src = ctx.createBufferSource()
      src.buffer = getNoise()
      src.loop = true
      const bq = ctx.createBiquadFilter()
      bq.type = 'bandpass'
      bq.frequency.value = 1100
      bq.Q.value = 1.1
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.08)
      src.connect(bq)
      bq.connect(g)
      g.connect(master)
      src.start()
      boostNodes = { src, g }
    },
    stopBoost() {
      if (!boostNodes) return
      const { src, g } = boostNodes
      boostNodes = null
      try {
        g.gain.cancelScheduledValues(ctx.currentTime)
        g.gain.setValueAtTime(g.gain.value, ctx.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1)
        src.stop(ctx.currentTime + 0.2)
      } catch {
        /* 节点可能已被销毁 */
      }
    },
  }

  return api
}
