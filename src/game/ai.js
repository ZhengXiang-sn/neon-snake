import { angleDelta, wrapAngle } from '../core/math.js'

/** 16 个候选方向（预计算，避免每帧三角函数开销与分配）。 */
const DIR_COUNT = 16
const DIR_ANGLE = new Float64Array(DIR_COUNT)
for (let i = 0; i < DIR_COUNT; i++) {
  DIR_ANGLE[i] = (i / DIR_COUNT) * Math.PI * 2
}

/** 复用的探测回调状态，避免在热路径上创建闭包。 */
const probeState = { blocked: false }
function blockVisitor() {
  probeState.blocked = true
  return false
}

/** 上下文转向权重：既要前方开阔，又要靠近目标方向。 */
const W_CLEARANCE = 1.0
const W_ALIGN = 0.85
/**
 * 空间充足度采用平方加权（非线性），使"前方几乎没路"的代价呈指数上升，
 * 否则会出现"因为对齐目标而直冲墙壁"的经典转向行为 bug。
 */
const CLEARANCE_EXP = 2
/** 最佳可用空间低于该比例时，判定为被包围，执行脱困急转。 */
const MIN_CLEARANCE_RATIO = 0.42

export function createBrain(cfg, rng) {
  return {
    cfg,
    rng,
    timer: 0,
    state: 'roam',
    targetAngle: 0,
    lastX: 0,
    lastY: 0,
    stuck: 0,
    /** 上一次决策间隔（秒），用于把"位移是否过小"换算成与速度无关的判据 */
    lastInterval: cfg.aiReaction,
    boostUntil: 0,
  }
}

/** 探测某方向上的可用空间，返回 [0, maxLook] 的距离。 */
function clearance(snake, world, cfg, angle, maxLook) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const steps = cfg.aiProbes
  const bodyR = snake.radius * 1.35
  for (let s = 1; s <= steps; s++) {
    const d = (maxLook * s) / steps
    const px = snake.x + cos * d
    const py = snake.y + sin * d
    const centerDist = Math.hypot(px, py)
    if (centerDist > world.arenaRadius - snake.radius * 2) return d
    const obstacles = world.obstacles
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]
      const dx = o.x - px
      const dy = o.y - py
      const rr = o.r + bodyR
      if (dx * dx + dy * dy <= rr * rr) return d
    }
    probeState.blocked = false
    world.queryBodies(px, py, bodyR, snake, blockVisitor)
    if (probeState.blocked) return d
  }
  return maxLook
}

/** 选取当前最有价值的追击目标；返回 {x, y, kind} 或 null。 */
function pickTarget(snake, world, cfg) {
  let best = null
  let bestScore = -Infinity

  const powerups = world.powerups
  for (let i = 0; i < powerups.length; i++) {
    const p = powerups[i]
    if (!p.alive) continue
    const d = Math.hypot(p.x - snake.x, p.y - snake.y)
    if (d > 1000) continue
    const score = 900 / (d + 60)
    if (score > bestScore) {
      bestScore = score
      best = { x: p.x, y: p.y, kind: 'powerup' }
    }
  }

  const player = world.player
  if (player && player.alive && !snake.isPlayer && snake.mass >= player.mass * 0.75) {
    const d = Math.hypot(player.x - snake.x, player.y - snake.y)
    if (d < 760) {
      // 包夹：瞄准玩家头部前方的拦截点
      const lead = player.radius * 2 + 70
      const score = 1400 / (d + 80)
      if (score > bestScore) {
        bestScore = score
        best = {
          x: player.x + Math.cos(player.angle) * lead,
          y: player.y + Math.sin(player.angle) * lead,
          kind: 'player',
        }
      }
    }
  }

  const food = world.food
  for (let i = 0; i < food.length; i++) {
    const f = food[i]
    if (!f.alive) continue
    const d = Math.hypot(f.x - snake.x, f.y - snake.y)
    const score = (f.value * 26) / (d + 70)
    if (score > bestScore) {
      bestScore = score
      best = { x: f.x, y: f.y, kind: 'food' }
    }
  }
  return best
}

/**
 * 推进一条 AI 蛇的决策。纯逻辑，只依赖 world 暴露的只读接口，
 * 因此可以在单元测试里用最小 stub world 驱动。
 */
export function updateBrain(snake, world, dt) {
  const b = snake.ai
  if (!b) return
  const cfg = b.cfg
  b.timer -= dt

  if (b.timer > 0) {
    snake.steerTo(b.targetAngle)
    snake.boosting = snake.canBoost && b.boosting === true
    return
  }
  b.timer = cfg.aiReaction * (0.7 + b.rng.next() * 0.6)

  // 判据必须与"本决策周期预期能走多远"比较，而不是与固定半径比较：
  // 否则被玩家的减速力场笼罩（速度减半）或体型变大（半径变大）时会被误判为卡住，
  // 触发毫无意义的原地急转。
  const expected = Math.max(1e-3, snake.speed * b.lastInterval)
  const moved = Math.hypot(snake.x - b.lastX, snake.y - b.lastY)
  b.lastX = snake.x
  b.lastY = snake.y
  b.stuck = moved < expected * 0.45 ? b.stuck + 1 : 0
  b.lastInterval = b.timer

  const maxLook = Math.max(150, snake.speed * 0.9)
  const target = pickTarget(snake, world, cfg)
  const desired = target
    ? Math.atan2(target.y - snake.y, target.x - snake.x)
    : b.targetAngle + b.rng.gauss() * 0.5

  let bestDir = snake.angle
  let bestScore = -Infinity
  let bestClearRatio = 0
  for (let i = 0; i < DIR_COUNT; i++) {
    const a = DIR_ANGLE[i]
    const clear = clearance(snake, world, cfg, a, maxLook)
    const ratio = clear / maxLook
    const align = 0.5 + 0.5 * Math.cos(angleDelta(a, desired))
    // 优先不回头：与当前朝向夹角过大时轻微惩罚，避免左右高频抖动
    const turnCost = (0.12 * Math.abs(angleDelta(snake.angle, a))) / Math.PI
    const score = Math.pow(ratio, CLEARANCE_EXP) * W_CLEARANCE + align * W_ALIGN - turnCost
    if (score > bestScore) {
      bestScore = score
      bestDir = a
      bestClearRatio = ratio
    }
  }

  if (bestClearRatio < MIN_CLEARANCE_RATIO) {
    // 已被完全包围：原地急转寻找出口
    b.stuck += 1
    bestDir = wrapAngle(snake.angle + (b.rng.chance(0.5) ? 1 : -1) * 1.9)
  } else if (b.stuck > 6) {
    b.stuck = 0
    bestDir = wrapAngle(snake.angle + (b.rng.chance(0.5) ? 1 : -1) * 1.1)
  }

  b.targetAngle = bestDir
  snake.steerTo(bestDir)
  b.state = target && target.kind === 'player' ? 'hunt' : 'roam'

  // 加速：仅在质量充裕且前方开阔时（避免烧掉自己）
  const ahead = clearance(snake, world, cfg, snake.angle, maxLook * 1.4)
  const wantBoost =
    snake.canBoost &&
    snake.mass > 26 &&
    ahead > maxLook * 0.75 &&
    (b.state === 'hunt' || b.rng.chance(0.15) || b.stuck > 3)
  b.boosting = wantBoost
  snake.boosting = wantBoost
}
