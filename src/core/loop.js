/**
 * 固定时间步游戏循环。
 *
 * 物理以固定 fixedStep 推进（与刷新率无关，60Hz / 144Hz 行为一致），
 * 渲染每帧一次并接收插值系数 alpha。单帧追帧次数有上限，避免切回前台时"死亡螺旋"。
 */
export function createLoop({ step = 1 / 60, maxSubSteps = 5, onStep, onRender }) {
  let rafId = 0
  let running = false
  let paused = false
  let lastTs = 0
  let acc = 0
  let windowSum = 0
  let windowCount = 0

  function frame(ts) {
    if (!running) return
    rafId = requestAnimationFrame(frame)
    if (lastTs === 0) {
      lastTs = ts
      return
    }
    let delta = (ts - lastTs) / 1000
    lastTs = ts
    // 单帧超过 0.25s 视为卡顿，直接截断，防止追帧雪崩
    if (delta > 0.25) delta = 0.25

    const frameMs = delta * 1000

    if (!paused) {
      acc += delta
      let steps = 0
      while (acc >= step && steps < maxSubSteps) {
        onStep(step)
        acc -= step
        steps++
      }
      if (steps >= maxSubSteps) acc = 0
      windowSum += frameMs
      windowCount++
    }
    onRender(acc / step, delta)
  }

  return {
    start() {
      if (running) return
      running = true
      paused = false
      lastTs = 0
      acc = 0
      rafId = requestAnimationFrame(frame)
    },
    /**
     * 暂停时 onStep 不再被调用，但 onRender 仍会执行 ——
     * 这样暂停面板背后仍能看到冻结的世界，而不是一片空白。
     */
    setPaused(value) {
      if (paused === value) return
      paused = value
      lastTs = 0
      acc = 0
    },
    /** 取走累积的帧时均值并清零窗口，供自适应画质使用。 */
    consumeWindowAvg() {
      if (windowCount === 0) return null
      const avg = windowSum / windowCount
      const n = windowCount
      windowSum = 0
      windowCount = 0
      return { avg, frames: n }
    },
  }
}
