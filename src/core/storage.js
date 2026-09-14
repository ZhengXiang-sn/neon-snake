/**
 * localStorage 安全封装。
 * 目标：在隐私模式 / 存储被禁用 / 配额耗尽等情况下静默降级，绝不抛异常打断游戏。
 */
export function createStorage(prefix = 'neon-snake:') {
  let available = true
  try {
    const probe = `${prefix}__probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
  } catch {
    available = false
  }

  return {
    get available() {
      return available
    },
    get(key, fallback = null) {
      if (!available) return fallback
      try {
        const raw = window.localStorage.getItem(prefix + key)
        if (raw === null) return fallback
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    },
    set(key, value) {
      if (!available) return false
      try {
        window.localStorage.setItem(prefix + key, JSON.stringify(value))
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      if (!available) return
      try {
        window.localStorage.removeItem(prefix + key)
      } catch {
        /* 忽略 */
      }
    },
  }
}
