import { PathBuf } from '../core/path.js'
import { rotateTowards } from '../core/math.js'

const MIN_MASS = 6
const MAX_RADIUS = 46
const SPAWN_PATH_MAX_POINTS = 400
/** 自碰撞豁免区在"两倍判定半径"之外的额外余量（世界单位） */
const SELF_HIT_SLACK = 28

/**
 * 蛇（玩家与 AI 共用）。
 *
 * 身体不是"格子数组"，而是沿头部走过的路径按固定弧长重采样得到的节点序列，
 * 因此天然支持任意方向、任意曲率的连续运动，并且与帧率无关。
 */
export class Snake {
  constructor(cfg) {
    this.cfg = cfg
    this.path = new PathBuf(cfg.pathCapacity)
    this.nodes = []
    this.nodeCount = 0
    this.selfSkipNodes = 0
    this._count = 0
    this._writeNode = (x, y) => {
      let o = this.nodes[this._count]
      if (!o) {
        o = { x: 0, y: 0 }
        this.nodes[this._count] = o
      }
      o.x = x
      o.y = y
      this._count++
    }

    this.id = 0
    this.isPlayer = false
    this.name = ''
    this.colorIndex = 0

    this.x = 0
    this.y = 0
    this.angle = 0
    this.desiredAngle = 0
    this.mass = cfg.startMass
    this.alive = false
    this.boosting = false
    this.speedMult = 1
    /** 世界施加环境减速前的基准速度倍率 */
    this.rootSpeedMult = 1
    /** 死亡后由世界安排的重生时间（Infinity 表示不重生） */
    this.respawnAt = Infinity

    this.radius = 0
    this.bodyLen = 0
    this.speed = 0
    this.turnRate = 0

    /**
     * 道具状态。
     * - `shield`：可用的护盾次数（0/1），命中即消耗；
     * - `grace`：护盾破碎后的无敌帧，避免"救下一帧又被同一堵墙撞死"；
     * - 其余为剩余秒数。
     */
    this.effects = { shield: 0, grace: 0, magnet: 0, slow: 0, ghost: 0, double: 0 }
    this.combo = 0
    this.comboTimer = 0
    this.comboMult = 1
    this.foodEaten = 0
    this.kills = 0
    this.survivalTime = 0
    this.ai = null
  }

  reset({ id, x, y, angle, mass, colorIndex, name, isPlayer, speedMult }) {
    this.id = id
    this.x = x
    this.y = y
    this.angle = angle
    this.desiredAngle = angle
    this.mass = mass
    this.alive = true
    this.boosting = false
    this.speedMult = speedMult ?? 1
    this.rootSpeedMult = speedMult ?? 1
    this.respawnAt = Infinity
    this.colorIndex = colorIndex ?? 0
    this.name = name ?? ''
    this.isPlayer = !!isPlayer
    this.combo = 0
    this.comboTimer = 0
    this.comboMult = 1
    this.foodEaten = 0
    this.kills = 0
    this.survivalTime = 0
    this.effects.shield = 0
    this.effects.grace = 0
    this.effects.magnet = 0
    this.effects.slow = 0
    this.effects.ghost = 0
    this.effects.double = 0
    if (this.ai) {
      this.ai.state = 'roam'
      this.ai.timer = 0
      this.ai.targetAngle = angle
      this.ai.stuck = 0
    }
    this.refreshDerived()
    this.path.clear()
    this.nodeCount = 0

    // 初始身体沿反方向铺开，避免所有节点堆在头部
    const stepDist = Math.max(0.5, this.speed * this.cfg.fixedStep)
    const count = Math.min(SPAWN_PATH_MAX_POINTS, Math.ceil(this.bodyLen / stepDist))
    const bx = Math.cos(angle)
    const by = Math.sin(angle)
    for (let i = count; i >= 0; i--) {
      const d = i * stepDist
      this.path.push(x - bx * d, y - by * d)
    }
    this.resample()
  }

  refreshDerived() {
    const c = this.cfg
    this.mass = Math.max(MIN_MASS, this.mass)
    this.radius = Math.min(
      MAX_RADIUS,
      c.radiusBase + c.radiusGain * Math.pow(this.mass, c.radiusExp),
    )
    this.bodyLen = Math.min(c.lenMax, c.lenBase + c.lenPerMass * this.mass)
    const speedPenalty = Math.min(c.speedPenaltyCap, this.mass * c.speedMassPenalty)
    const turnPenalty = Math.min(c.turnPenaltyCap, this.mass * c.turnMassPenalty)
    const base = c.baseSpeed * this.speedMult * (1 - speedPenalty)
    this.speed = this.boosting ? base * c.boostMult : base
    this.turnRate = c.baseTurnRate * (1 - turnPenalty)
  }

  get canBoost() {
    return this.alive && this.mass > this.cfg.minMassToBoost
  }

  hasEffect(name) {
    return this.effects[name] > 0
  }

  /** 授予道具。护盾是"一次性充能"，其余是"取较长的剩余时间"。 */
  grantEffect(name, duration = 0) {
    const value = name === 'shield' ? 1 : duration
    if (value > this.effects[name]) this.effects[name] = value
  }

  /**
   * 消耗一层护盾换取短暂无敌。返回是否真的挡下了一次致命撞击。
   * 由世界在判定死亡前调用，是护盾唯一的效果出口。
   */
  consumeShield() {
    if (this.effects.shield <= 0) return false
    this.effects.shield = 0
    this.effects.grace = Math.max(this.effects.grace, this.cfg.powerupShieldGrace)
    return true
  }

  /** 相对转向（键盘）：把指令角推进一个增量。 */
  steerBy(delta) {
    this.desiredAngle += delta
  }

  /** 绝对指向（鼠标 / 触屏）：直接给定目标朝向。 */
  steerTo(angle) {
    this.desiredAngle = angle
  }

  addMass(delta) {
    this.mass += delta
    this.refreshDerived()
  }

  updateEffects(dt) {
    const e = this.effects
    if (e.grace > 0) e.grace = Math.max(0, e.grace - dt)
    if (e.magnet > 0) e.magnet = Math.max(0, e.magnet - dt)
    if (e.slow > 0) e.slow = Math.max(0, e.slow - dt)
    if (e.ghost > 0) e.ghost = Math.max(0, e.ghost - dt)
    if (e.double > 0) e.double = Math.max(0, e.double - dt)
  }

  updateCombo(dt) {
    if (this.combo <= 0) return
    this.comboTimer -= dt
    if (this.comboTimer <= 0) {
      this.combo = 0
      this.comboTimer = 0
      this.comboMult = 1
    }
  }

  registerEat(value) {
    const c = this.cfg
    this.combo += 1
    this.comboTimer = c.comboWindow
    this.comboMult = Math.min(c.comboMaxMult, 1 + Math.floor(this.combo / c.comboPerStack))
    this.foodEaten += 1
    this.addMass(value)
    return this.comboMult
  }

  /** 以固定时间步推进一个 step，返回本步位移。 */
  step(dt) {
    if (!this.alive) return 0
    const cfg = this.cfg

    // 加速的代价：持续烧质量。质量触底时自动松开加速，
    // 这样"按住加速"永远是一个有代价的决策，而不是白嫖 1.6× 速度。
    if (this.boosting) {
      this.mass -= cfg.boostMassCost * dt
      if (this.mass <= cfg.minMassToBoost) {
        this.mass = cfg.minMassToBoost
        this.boosting = false
      }
    }

    this.refreshDerived()
    this.angle = rotateTowards(this.angle, this.desiredAngle, this.turnRate * dt)

    const move = this.speed * dt
    this.x += Math.cos(this.angle) * move
    this.y += Math.sin(this.angle) * move
    this.path.push(this.x, this.y)
    this.path.trimTo(this.bodyLen + Math.max(cfg.segmentSpacing * 2, move * 2))
    this.resample()
    this.survivalTime += dt
    return move
  }

  /** 按固定弧长沿路径重采样身体节点（零分配：复用节点对象）。 */
  resample() {
    const cfg = this.cfg
    const path = this.path
    const n = path.count
    this._count = 0
    if (n === 0) {
      this.nodeCount = 0
      return
    }
    const spacing = Math.max(cfg.segmentSpacing, this.bodyLen / cfg.maxNodes)
    const total = Math.min(cfg.maxNodes + 1, Math.floor(this.bodyLen / spacing) + 1)

    let ax = path.x(n - 1)
    let ay = path.y(n - 1)
    this._writeNode(ax, ay)

    let need = spacing
    for (let i = n - 2; i >= 0 && this._count < total; i--) {
      const bx = path.x(i)
      const by = path.y(i)
      let segLen = Math.hypot(bx - ax, by - ay)
      while (segLen >= need && this._count < total) {
        const t = need / segLen
        const px = ax + (bx - ax) * t
        const py = ay + (by - ay) * t
        this._writeNode(px, py)
        ax = px
        ay = py
        segLen -= need
        need = spacing
      }
      need -= segLen
      ax = bx
      ay = by
    }
    this.nodeCount = this._count
    if (this.nodeCount > 0) {
      // 头部节点始终精确等于当前位置，避免重采样误差造成视觉抖动
      this.nodes[0].x = this.x
      this.nodes[0].y = this.y
    }
    // 自碰撞豁免区必须随体型增长：躯干越粗，判定半径和越大，
    // 若沿用固定弧长，大蛇在紧贴自身时会被自己的第二节身体判死。
    const skipDist = Math.max(
      cfg.selfHitSkipDist,
      this.radius * cfg.collideRadiusFactor * 2 + SELF_HIT_SLACK,
    )
    this.selfSkipNodes = Math.max(0, Math.ceil(skipDist / spacing))
  }

  node(i) {
    return this.nodes[i]
  }

  collideRadius() {
    return this.radius * this.cfg.collideRadiusFactor
  }

  kill() {
    this.alive = false
    this.boosting = false
  }

  /** 质量 → 死亡掉落的宝石总价值 */
  dropValue() {
    return this.mass * this.cfg.deathDropRatio
  }
}
