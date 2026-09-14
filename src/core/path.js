/**
 * 头部轨迹环形缓冲（PathBuf）。
 *
 * 设计动机：蛇的身体是"沿头部走过的路径按固定弧长取样"得到的（Slither 一脉做法），
 * 因此需要一条可无限延伸、可从前端裁剪、零分配的历史轨迹。
 *
 * - 索引 0 = 最旧（尾端），索引 count-1 = 最新（头部）
 * - push / dropFront 均为 O(1)，无数组搬迁、无对象分配
 */
export class PathBuf {
  constructor(capacity) {
    this.capacity = capacity
    this.buf = new Float64Array(capacity * 2)
    this.start = 0
    this.count = 0
    /** 已存储轨迹的总弧长 */
    this.length = 0
  }

  clear() {
    this.start = 0
    this.count = 0
    this.length = 0
  }

  x(i) {
    return this.buf[((this.start + i) % this.capacity) * 2]
  }

  y(i) {
    return this.buf[((this.start + i) % this.capacity) * 2 + 1]
  }

  /** 最旧点与次旧点之间的距离（丢弃最旧点时损失的弧长）。 */
  _frontSegment() {
    if (this.count < 2) return 0
    return Math.hypot(this.x(1) - this.x(0), this.y(1) - this.y(0))
  }

  /** 在头部追加一个轨迹点，返回与前一端的距离。 */
  push(x, y) {
    if (this.count === 0) {
      this.buf[0] = x
      this.buf[1] = y
      this.count = 1
      this.length = 0
      return 0
    }
    const headIdx = this.count - 1
    const px = this.x(headIdx)
    const py = this.y(headIdx)
    const full = this.count >= this.capacity
    const lost = full ? this._frontSegment() : 0

    const idx = (this.start + this.count) % this.capacity
    this.buf[idx * 2] = x
    this.buf[idx * 2 + 1] = y

    const d = Math.hypot(x - px, y - py)
    if (full) {
      this.length = Math.max(0, this.length - lost) + d
      this.start = (this.start + 1) % this.capacity
    } else {
      this.length += d
      this.count++
    }
    return d
  }

  /** 从尾端（最旧一端）丢弃一个点，同步维护弧长。至少保留 2 个点。 */
  dropFrontOne() {
    if (this.count <= 2) return false
    this.length -= this._frontSegment()
    if (this.length < 0) this.length = 0
    this.start = (this.start + 1) % this.capacity
    this.count--
    return true
  }

  /** 丢弃 k 个最旧点。 */
  dropFront(k) {
    let n = Math.max(0, Math.floor(k))
    while (n-- > 0 && this.dropFrontOne()) {
      /* 逐点维护弧长 */
    }
  }

  /** 裁剪到总弧长不超过 keepLen（至少保留 2 个点）。 */
  trimTo(keepLen) {
    let guard = this.count
    while (guard-- > 0 && this.count > 2) {
      const lost = this._frontSegment()
      if (this.length - lost < keepLen) break
      if (!this.dropFrontOne()) break
    }
  }
}
