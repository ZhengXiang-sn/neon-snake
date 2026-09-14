/**
 * 碰撞宽相：均匀空间网格。
 *
 * 关键约束是"每帧零分配"——桶内用扁平数组按 5 元组 [x, y, r, ref, idx] 存储，
 * 跨帧复用数组（只把 length 置 0），避免每帧产生数千个小对象导致的 GC 抖动。
 */
const CELL_OFFSET = 4096
const STRIDE = 5

export function createGrid(cellSize = 96) {
  const buckets = new Map()
  const usedKeys = []
  let activeKeys = 0

  function cellKey(cx, cy) {
    return (cx + CELL_OFFSET) * 16384 + (cy + CELL_OFFSET)
  }

  return {
    cellSize,
    /** 每帧开始时调用：清空计数但保留桶数组，实现零分配复用。 */
    begin() {
      for (let i = 0; i < activeKeys; i++) {
        const b = buckets.get(usedKeys[i])
        if (b) b.length = 0
      }
      activeKeys = 0
    },
    insert(x, y, r, ref, idx) {
      const cx = Math.floor(x / cellSize)
      const cy = Math.floor(y / cellSize)
      const key = cellKey(cx, cy)
      let b = buckets.get(key)
      if (!b) {
        b = []
        buckets.set(key, b)
      }
      if (b.length === 0) usedKeys[activeKeys++] = key
      b.push(x, y, r, ref, idx)
    },
    /**
     * 查询与圆 (x,y,r) 相交的所有条目。
     * visit(entryX, entryY, entryR, ref, idx) 返回 false 可提前终止遍历。
     * @returns {boolean} 是否被提前终止
     */
    query(x, y, r, visit) {
      const minCx = Math.floor((x - r) / cellSize)
      const maxCx = Math.floor((x + r) / cellSize)
      const minCy = Math.floor((y - r) / cellSize)
      const maxCy = Math.floor((y + r) / cellSize)
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const b = buckets.get(cellKey(cx, cy))
          if (!b || b.length === 0) continue
          for (let i = 0; i < b.length; i += STRIDE) {
            const dx = b[i] - x
            const dy = b[i + 1] - y
            const rr = b[i + 2] + r
            if (dx * dx + dy * dy <= rr * rr) {
              if (visit(b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4]) === false) return true
            }
          }
        }
      }
      return false
    },
    get bucketCount() {
      return buckets.size
    },
  }
}

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const dx = bx - ax
  const dy = by - ay
  const rr = ar + br
  return dx * dx + dy * dy <= rr * rr
}
