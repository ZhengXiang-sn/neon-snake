/**
 * 可播种伪随机数（mulberry32）。
 * 显式播种使 AI 与生成逻辑在测试中完全可复现。
 */
export function createRng(seed = 1) {
  let a = seed >>> 0
  if (a === 0) a = 0x9e3779b9

  function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    /** [min, max) 浮点 */
    range(min, max) {
      return min + next() * (max - min)
    },
    /** [min, max] 整数 */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1))
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)]
    },
    /** [0, TAU) 弧度 */
    angle() {
      return next() * Math.PI * 2
    },
    /** 以概率 p 返回 true */
    chance(p) {
      return next() < p
    },
    /** 近似高斯（Irwin–Hall），用于让爆散更自然 */
    gauss() {
      return (next() + next() + next() - 1.5) / 1.5
    },
  }
}

export function randomSeed() {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
}
