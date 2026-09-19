import { Snake } from './snake.js'
import { createBrain, updateBrain } from './ai.js'
import { createGrid, circlesOverlap } from './collision.js'
import { generateTerrain } from './terrain.js'
import { createGameConfig, POWERUP_TYPES, SNAKE_COLORS } from '../config.js'
import { clamp, normalize } from '../core/math.js'
import { createRng, randomSeed } from '../core/rng.js'

const BOT_NAMES = ['Viper', 'Krait', 'Mamba', 'Cobra', 'Boa', 'Adder', 'Racer', 'Taipan']
const GEM_CAPACITY = 320
const GEM_TTL = 42
const BOT_RESPAWN_DELAY = 7
const MAX_EVENTS = 64
/** 减速力场半径与强度 */
const SLOW_FIELD_RADIUS = 360
const SLOW_FIELD_FACTOR = 0.5

/** `_sweepTerrainOutside` 的复用返回值，避免每帧分配对象。 */
const SWEEP = { removed: 0, last: null }

/**
 * 生态 id → 稳定的 32 位散列（FNV-1a）。
 * 用来给地形单独派生一支随机源，把"地形随机性"与"AI/掉落/食物随机性"彻底分开：
 * 以后调地形的任何参数，都不会静默改变下游的随机序列。
 */
function biomeHash(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class World {
  constructor(cfg = createGameConfig()) {
    this.cfg = cfg
    this.rng = createRng(randomSeed())
    this.grid = createGrid(96)
    this.snakes = []
    this.player = null
    this.playerSnake = null
    this.obstacles = []
    this.events = []
    this.score = 0
    this.kills = 0
    this.elapsed = 0
    this.arenaRadius = cfg.arenaRadiusStart
    /** 当前生态 id，决定地形布局；由 newGame / rebuildTerrain 更新 */
    this.biome = cfg.biome
    /** 已被缩圈吞噬的障碍物累计数量（诊断与 HUD 用） */
    this.terrainEaten = 0
    this.state = 'idle'
    this._hitRef = null
    this._hitSelf = false
    this._deaths = []
    this._buildFoodPool()
    this._buildPowerupPool()
    this._buildSnakes()
  }

  // ---------------------------------------------------------------- 初始化

  _buildFoodPool() {
    const cfg = this.cfg
    this.commonRange = [0, cfg.foodCommonCount]
    this.goldRange = [cfg.foodCommonCount, cfg.foodCommonCount + cfg.foodGoldCount]
    this.gemRange = [cfg.foodCommonCount + cfg.foodGoldCount, cfg.foodCommonCount + cfg.foodGoldCount + GEM_CAPACITY]
    const size = this.gemRange[1]
    this.food = new Array(size)
    for (let i = 0; i < size; i++) {
      this.food[i] = {
        x: 0,
        y: 0,
        r: cfg.foodCommonRadius,
        value: 1,
        tier: 'common',
        alive: false,
        phase: 0,
        respawnAt: 0,
        expireAt: Infinity,
      }
    }
  }

  _buildPowerupPool() {
    this.powerups = []
    for (let i = 0; i < this.cfg.powerupMaxOnField; i++) {
      this.powerups.push({
        x: 0,
        y: 0,
        type: 'shield',
        alive: false,
        phase: 0,
        ttl: 0,
        radius: this.cfg.powerupRadius,
      })
    }
  }

  _buildSnakes() {
    const total = 1 + this.cfg.botCount
    for (let i = 0; i < total; i++) {
      const snake = new Snake(this.cfg)
      snake.isPlayer = i === 0
      if (!snake.isPlayer) {
        snake.ai = createBrain(this.cfg, this.rng)
      }
      this.snakes.push(snake)
    }
    this.player = this.snakes[0]
    this.playerSnake = this.player
  }

  // ---------------------------------------------------------------- 开局

  newGame({ seed = randomSeed(), biome = this.cfg.biome } = {}) {
    this.rng = createRng(seed)
    this.seed = seed
    this.biome = biome
    this.elapsed = 0
    this.score = 0
    this.kills = 0
    this.terrainEaten = 0
    this.arenaRadius = this.cfg.arenaRadiusStart
    this.state = 'playing'
    this.events.length = 0
    this._deaths.length = 0
    this.powerupTimer = this.cfg.powerupSpawnInterval * 0.6

    this._generateObstacles()

    // 食物归零后重新铺满
    for (let i = 0; i < this.food.length; i++) {
      const f = this.food[i]
      f.alive = false
      f.expireAt = Infinity
      f.respawnAt = 0
    }
    this._seedFoodRange(this.commonRange, 'common', this.cfg.foodCommonRadius, this.cfg.foodCommonValue)
    this._seedFoodRange(this.goldRange, 'gold', this.cfg.foodGoldRadius, this.cfg.foodGoldValue)

    for (let i = 0; i < this.powerups.length; i++) this.powerups[i].alive = false

    // 玩家固定在中心，出生朝向取最开阔方向
    this.player.reset({
      id: 0,
      x: 0,
      y: 0,
      angle: this._findSpawnAngle(0, 0),
      mass: this.cfg.startMass,
      colorIndex: 0,
      name: '你',
      isPlayer: true,
      speedMult: 1,
    })

    const bots = this.snakes.slice(1)
    for (let i = 0; i < bots.length; i++) {
      // 换局后重播种随机源，保证 AI 的随机性跟随本局
      if (bots[i].ai) bots[i].ai.rng = this.rng
      this._respawnBot(bots[i], i, true)
    }
    return this
  }

  _seedFoodRange(range, tier, radius, value) {
    for (let i = range[0]; i < range[1]; i++) {
      const f = this.food[i]
      const p = this._foodSpot(60, radius)
      f.x = p.x
      f.y = p.y
      f.r = radius
      f.value = value
      f.tier = tier
      f.alive = true
      f.phase = this.rng.range(0, Math.PI * 2)
      f.respawnAt = 0
      f.expireAt = Infinity
    }
  }

  /** 该点是否落在某个障碍物内（含 `radius` 与 8px 余量）。 */
  _blockedAt(x, y, radius) {
    const list = this.obstacles
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      const dx = o.x - x
      const dy = o.y - y
      const rr = o.r + radius + 8
      if (dx * dx + dy * dy < rr * rr) return true
    }
    return false
  }

  /**
   * 食物落点：优先避开障碍物。
   * 地形变密后，食物生成在陨石内部的概率明显上升——玩家看得见吃不到，
   * 小地图上也显示为"卡在石头里的点"。
   *
   * 因此随机重试用尽后，改为**按同心环确定性扫描**一个真正空闲的落点，
   * 而不是退回"最后一次被挡住的点"：内圈的石头终局也不会被缩圈溶解，
   * 埋在里面的食物整局都吃不到（而开局的 240 颗普通食物只播种一次、不会重掷）。
   */
  _foodSpot(margin, radius) {
    const tries = this.cfg.foodPlaceTries
    let p = this._randomPointInArena(margin)
    if (this.obstacles.length === 0) return p
    for (let t = 1; t < tries; t++) {
      if (!this._blockedAt(p.x, p.y, radius)) return p
      p = this._randomPointInArena(margin)
    }
    if (!this._blockedAt(p.x, p.y, radius)) return p

    const R = Math.max(80, this.arenaRadius - margin)
    for (let ring = 1; ring <= 5; ring++) {
      const d = (R * ring) / 5
      const steps = Math.max(10, Math.round(d / 70))
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2
        const x = Math.cos(a) * d
        const y = Math.sin(a) * d
        if (!this._blockedAt(x, y, radius)) return { x, y }
      }
    }
    // 竞技场被完全塞满（理论上不会发生）：退回出生点净空区，那里按设计保证没有障碍
    return { x: 0, y: 0 }
  }

  /**
   * 生成地形。具体布局算法见 game/terrain.js —— 每个生态一套，
   * 且障碍物铺满整片竞技场（含缩圈后才被吞噬的外圈），不再是中心一坨。
   *
   * 地形用**独立派生**的随机源 `(seed ^ hash(biome))`，有两个好处：
   *  1. 与玩法随机源解耦 —— 改地形参数不会连带改变 AI 决策/掉落/食物序列；
   *  2. 同一 (种子, 生态) 恒产出同一张图，来回切换生态不会"每切一次换一张脸"。
   */
  _generateObstacles() {
    const rng = createRng((this.seed ^ biomeHash(this.biome)) >>> 0)
    this.obstacles = generateTerrain(this.biome, rng, {
      innerClear: this.cfg.terrainInnerClear,
      arenaRadiusStart: this.cfg.arenaRadiusStart,
      arenaRadiusMin: this.cfg.arenaRadiusMin,
    })
  }

  /**
   * 生态热切换：不重开本局，直接重建地形。
   *
   * 必须"清场"——否则玩家可能正好站在新生成的陨石里，切换生态等于秒杀自己。
   * 因此重建后把所有蛇身附近的障碍物剔除（墙体整道剔除，避免只剩半截折线时
   * 渲染出的胶囊与碰撞圆不再重合）；
   * 同时还要**沿当前竞技场半径再扫一遍**：本局可能已经缩过圈，
   * 而新地形是按开局半径生成的，若不清扫，圈外黑暗里会凭空多出一批障碍，
   * 下一帧又被缩圈一次性吞掉 —— 表现为切换瞬间"圈外炸出一团溶解粒子"。
   */
  rebuildTerrain(biome, { pad = 130 } = {}) {
    this.biome = biome
    this._generateObstacles()
    this._clearTerrainAroundSnakes(pad)
    this._sweepTerrainOutside(this.arenaRadius)
    this.terrainEaten = 0
    this._emit({ type: 'biomeShift', biome })
    return this
  }

  _nearSnake(x, y, r, pad) {
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i]
      if (!s.alive) continue
      const reach = s.radius + r + pad
      if (circlesOverlap(x, y, reach, s.x, s.y, 0)) return true
      for (let k = 0; k < s.nodeCount; k += 2) {
        const n = s.nodes[k]
        if (circlesOverlap(x, y, reach, n.x, n.y, 0)) return true
      }
    }
    return false
  }

  _clearTerrainAroundSnakes(pad) {
    const list = this.obstacles
    if (list.length === 0) return
    const doomedGroups = new Set()
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      if (o.kind === 'wall' && this._nearSnake(o.x, o.y, o.r, pad)) doomedGroups.add(o.group)
    }
    let write = 0
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      if (o.kind === 'wall') {
        if (doomedGroups.has(o.group)) continue
      } else if (this._nearSnake(o.x, o.y, o.r, pad)) {
        continue
      }
      list[write++] = o
    }
    list.length = write
  }

  /**
   * 剔除所有"已经越出当前竞技场"的障碍物，返回被剔除的数量。
   * `_dissolveTerrain`（缩圈吞没，要计数与发事件）与 `rebuildTerrain`
   * （换生态清场，静默）共用同一套几何判定，避免两处判定漂移。
   * 结果写进复用的 `SWEEP`，不分配对象。
   */
  _sweepTerrainOutside(R) {
    const list = this.obstacles
    SWEEP.removed = 0
    SWEEP.last = null
    if (list.length === 0) return SWEEP
    let write = 0
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      const reach = o.kind === 'wall' ? o.reach : Math.hypot(o.x, o.y)
      if (reach + o.r > R) {
        SWEEP.removed++
        SWEEP.last = o
        continue
      }
      list[write++] = o
    }
    list.length = write
    return SWEEP
  }

  /**
   * 缩圈吞噬地形：径向外侧的障碍物在边界扫过时被摧毁。
   *
   * 这一步同时解决三个问题：
   *  - 视觉上，外圈障碍不会"漂"在圈外的黑暗里；
   *  - 数值上，避免缩圈把障碍密度按面积比例顶到 3 倍以上，形成无法走位的死亡陷阱；
   *  - 结构上，**墙体整道崩塌**：只要有一个节点出圈，整道墙一起消失。
   *    留下半截墙不只是难看 —— 一条跨越竞技场的弦会把圆形场地切成
   *    互不连通的两块，直接把玩家困死。
   */
  _dissolveTerrain() {
    const res = this._sweepTerrainOutside(this.arenaRadius)
    if (res.removed === 0) return
    this.terrainEaten += res.removed
    // 一帧只发一个事件：一堵墙有十几个节点，逐节点发事件会把事件队列冲垮
    if (res.last) {
      this._emit({
        type: 'terrainEaten',
        x: res.last.x,
        y: res.last.y,
        r: res.last.r,
        count: res.removed,
      })
    }
  }

  _randomPointInArena(margin = 60) {
    const R = Math.max(80, this.arenaRadius - margin)
    const a = this.rng.angle()
    const d = Math.sqrt(this.rng.next()) * R
    return { x: Math.cos(a) * d, y: Math.sin(a) * d }
  }

  _respawnBot(bot, index, initial = false) {
    const cfg = this.cfg
    // 先找完全安全的落点；若 60 次都失败（场面极度拥挤），
    // 退而求其次选"离最近的蛇/障碍最远"的候选，而不是沿用最后一次随机点。
    let x = 0
    let y = 0
    let bestClear = -Infinity
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = this._randomPointInArena(180)
      if (this._isSafeSpot(p.x, p.y, 60)) {
        x = p.x
        y = p.y
        break
      }
      let nearest = Infinity
      for (let i = 0; i < this.snakes.length; i++) {
        const s = this.snakes[i]
        if (!s.alive) continue
        const dx = s.x - p.x
        const dy = s.y - p.y
        const d2 = dx * dx + dy * dy
        if (d2 < nearest) nearest = d2
      }
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i]
        const dx = o.x - p.x
        const dy = o.y - p.y
        const d2 = dx * dx + dy * dy
        if (d2 < nearest) nearest = d2
      }
      if (nearest > bestClear) {
        bestClear = nearest
        x = p.x
        y = p.y
      }
    }
    // 极端拥挤时随机采样可能全部失败。此时改用确定性的网格扫描兜底，
    // 至少保证不会把 AI 直接放进陨石内部（否则它会复活即死、反复循环）。
    if (!this._isSafeSpot(x, y, 60)) {
      const step = Math.max(90, this.arenaRadius / 9)
      let sealed = true
      for (let gy = -this.arenaRadius + 90; gy <= this.arenaRadius - 90 && sealed; gy += step) {
        for (let gx = -this.arenaRadius + 90; gx <= this.arenaRadius - 90; gx += step) {
          if (this._isSafeSpot(gx, gy, 60)) {
            x = gx
            y = gy
            sealed = false
            break
          }
        }
      }
      // 整个场地都被占满（几乎不可能）：退回场地中心，让下一帧的重生逻辑再处理
      if (sealed) {
        x = 0
        y = 0
      }
    }
    const mass = initial ? cfg.startMass * 1.6 : clamp(14 + this.elapsed * 0.35, 14, 95)
    bot.reset({
      id: index + 1,
      x,
      y,
      angle: this._findSpawnAngle(x, y),
      mass,
      colorIndex: 1 + (index % (SNAKE_COLORS.length - 1)),
      name: BOT_NAMES[index % BOT_NAMES.length],
      isPlayer: false,
      speedMult: cfg.botSpeedMult,
    })
    bot.respawnAt = Infinity
    return bot
  }

  _isSafeSpot(x, y, radius) {
    if (Math.hypot(x, y) > this.arenaRadius - radius) return false
    for (const o of this.obstacles) {
      if (circlesOverlap(x, y, radius, o.x, o.y, o.r)) return false
    }
    for (const s of this.snakes) {
      if (!s.alive) continue
      if (Math.hypot(s.x - x, s.y - y) < 340) return false
      for (let i = 0; i < s.nodeCount; i += 3) {
        const n = s.nodes[i]
        const dx = n.x - x
        const dy = n.y - y
        const rr = s.radius + radius + 70
        if (dx * dx + dy * dy < rr * rr) return false
      }
    }
    return true
  }

  /** 某点沿某方向的可用空间（用于公平出生与 AI 探测）。 */
  _clearanceAt(x, y, angle, maxDist) {
    const step = 45
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (let d = step; d <= maxDist; d += step) {
      const px = x + cos * d
      const py = y + sin * d
      if (Math.hypot(px, py) > this.arenaRadius - 70) return d
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i]
        const dx = o.x - px
        const dy = o.y - py
        const rr = o.r + 34
        if (dx * dx + dy * dy <= rr * rr) return d
      }
    }
    return maxDist
  }

  /** 在 16 个方向中挑最开阔的一个作为出生朝向，避免"出生即撞墙"。 */
  _findSpawnAngle(x, y) {
    const maxDist = 620
    let bestAngle = 0
    let bestClear = -1
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const clear = this._clearanceAt(x, y, a, maxDist)
      if (clear > bestClear) {
        bestClear = clear
        bestAngle = a
      }
    }
    return bestAngle
  }

  // ---------------------------------------------------------------- 世界推进

  step(dt) {
    if (this.state !== 'playing') return
    this.elapsed += dt
    this._updateArena()
    this._dissolveTerrain()

    const playerSlow = this.player.alive && this.player.effects.slow > 0

    for (const s of this.snakes) {
      if (s.ai) updateBrain(s, this, dt)
      if (!s.alive) continue
      // 减速力场：玩家开启后，附近其它蛇显著变慢
      let mult = s.rootSpeedMult
      if (playerSlow && !s.isPlayer) {
        const dx = s.x - this.player.x
        const dy = s.y - this.player.y
        if (dx * dx + dy * dy < SLOW_FIELD_RADIUS * SLOW_FIELD_RADIUS) {
          mult *= SLOW_FIELD_FACTOR
        }
      }
      s.speedMult = mult
      s.updateEffects(dt)
      s.updateCombo(dt)
      s.step(dt)
    }

    this._applyMagnet(dt)
    this._resolveCollisions()
    this._updateFood(dt)
    this._consumeFood()
    this._updatePowerups(dt)
    this._respawnDeadBots()
  }

  _updateArena() {
    const cfg = this.cfg
    if (this.elapsed <= cfg.arenaShrinkDelay) {
      this.arenaRadius = cfg.arenaRadiusStart
      return
    }
    const t = clamp((this.elapsed - cfg.arenaShrinkDelay) / cfg.arenaShrinkDuration, 0, 1)
    this.arenaRadius = cfg.arenaRadiusStart + (cfg.arenaRadiusMin - cfg.arenaRadiusStart) * t
  }

  /** 供 AI 与碰撞使用的身体查询；exclude 用于排除某条蛇自身。 */
  queryBodies(x, y, r, exclude, visit) {
    return this.grid.query(x, y, r, (ex, ey, er, ref, idx) => {
      if (ref === exclude) return true
      return visit(ex, ey, er, ref, idx)
    })
  }

  _applyMagnet(dt) {
    for (const s of this.snakes) {
      if (!s.alive || s.effects.magnet <= 0) continue
      const R = this.cfg.foodMagnetRadius
      const R2 = R * R
      const speed = this.cfg.foodMagnetSpeed * dt
      for (let i = 0; i < this.food.length; i++) {
        const f = this.food[i]
        if (!f.alive) continue
        const dx = s.x - f.x
        const dy = s.y - f.y
        const d2 = dx * dx + dy * dy
        if (d2 > R2 || d2 < 1) continue
        const d = Math.sqrt(d2)
        const pull = speed * (1 - d / R + 0.35)
        f.x += (dx / d) * pull
        f.y += (dy / d) * pull
      }
    }
  }

  _resolveCollisions() {
    const grid = this.grid
    grid.begin()
    for (const s of this.snakes) {
      if (!s.alive) continue
      const r = s.collideRadius()
      const nodes = s.nodes
      for (let i = 0; i < s.nodeCount; i++) {
        const n = nodes[i]
        grid.insert(n.x, n.y, r, s, i)
      }
    }

    const deaths = this._deaths
    deaths.length = 0

    for (const s of this.snakes) {
      if (!s.alive) continue
      // 护盾破碎后的无敌帧：整条蛇跳过一切死亡判定
      if (s.effects.grace > 0) continue

      let cause = null
      let by = null

      if (Math.hypot(s.x, s.y) > this.arenaRadius + s.radius * 0.2) {
        cause = 'wall'
      }

      if (!cause) {
        const hr = s.collideRadius()
        for (let i = 0; i < this.obstacles.length; i++) {
          const o = this.obstacles[i]
          if (circlesOverlap(s.x, s.y, hr, o.x, o.y, o.r)) {
            cause = 'rock'
            break
          }
        }
      }

      if (!cause) {
        this._hitRef = null
        this._hitSelf = false
        const ghost = s.effects.ghost > 0
        grid.query(s.x, s.y, s.collideRadius(), (ex, ey, er, ref, idx) => {
          if (ref === s) {
            if (ghost) return true
            if (idx < s.selfSkipNodes) return true
            this._hitRef = s
            this._hitSelf = true
            return false
          }
          this._hitRef = ref
          this._hitSelf = false
          return false
        })
        if (this._hitRef) {
          cause = this._hitSelf ? 'self' : 'snake'
          by = this._hitSelf ? null : this._hitRef
        }
      }

      if (!cause) continue
      // 护盾：挡下一次致命撞击，碎裂后进入短暂无敌帧。
      if (s.consumeShield()) {
        this._emit({
          type: 'shieldBreak',
          x: s.x,
          y: s.y,
          cause,
          isPlayer: s.isPlayer,
          color: SNAKE_COLORS[s.colorIndex % SNAKE_COLORS.length].main,
        })
        continue
      }
      deaths.push({ snake: s, cause, by })
    }

    for (let i = 0; i < deaths.length; i++) {
      const d = deaths[i]
      if (d.snake.alive) this._killSnake(d.snake, d.by, d.cause)
    }
    deaths.length = 0
  }

  _killSnake(snake, by, cause) {
    const x = snake.x
    const y = snake.y
    const mass = snake.mass
    snake.kill()
    this._dropGems(snake)
    this._emit({
      type: 'death',
      x,
      y,
      mass,
      cause,
      isPlayer: snake.isPlayer,
      color: SNAKE_COLORS[snake.colorIndex % SNAKE_COLORS.length].main,
    })
    if (by && by !== snake) {
      by.kills += 1
      if (by.isPlayer) {
        this.score += this.cfg.killBonus
        this.kills += 1
      }
      this._emit({ type: 'kill', x, y, byPlayer: by.isPlayer, color: SNAKE_COLORS[by.colorIndex % SNAKE_COLORS.length].main })
    }
    if (!snake.isPlayer) {
      snake.respawnAt = this.elapsed + BOT_RESPAWN_DELAY
    }
  }

  _dropGems(snake) {
    const total = snake.dropValue()
    if (total <= 0) return
    // 每颗宝石承载的价值基准：决定掉落球数与球径，可由 CONFIG 调整
    const perOrb = this.cfg.foodGemValuePerOrb
    const count = clamp(Math.round(total / perOrb), 4, this.cfg.deathGemOrbsMax)
    const per = total / count
    const [gs, ge] = this.gemRange
    let slot = gs
    for (let i = 0; i < count; i++) {
      while (slot < ge && this.food[slot].alive) slot++
      if (slot >= ge) break
      const f = this.food[slot]
      const a = this.rng.angle()
      const d = Math.sqrt(this.rng.next()) * this.cfg.deathRingRadius
      f.x = snake.x + Math.cos(a) * d
      f.y = snake.y + Math.sin(a) * d
      f.value = per
      f.r = this.cfg.foodGemRadius * clamp(Math.sqrt(per / perOrb), 0.72, 1.5)
      f.tier = 'gem'
      f.alive = true
      f.phase = this.rng.range(0, Math.PI * 2)
      f.respawnAt = 0
      f.expireAt = this.elapsed + GEM_TTL
      slot++
    }
  }

  _updateFood(dt) {
    for (let i = 0; i < this.food.length; i++) {
      const f = this.food[i]
      f.phase += dt * (f.tier === 'gem' ? 2.4 : 1.5)
      if (f.alive) {
        if (f.expireAt <= this.elapsed) f.alive = false
        continue
      }
      if (f.respawnAt > 0 && f.respawnAt <= this.elapsed) {
        const p = this._foodSpot(60, f.r)
        f.x = p.x
        f.y = p.y
        f.alive = true
        f.respawnAt = 0
      }
    }
  }

  _consumeFood() {
    for (const s of this.snakes) {
      if (!s.alive) continue
      const reach = s.radius * 1.02
      for (let i = 0; i < this.food.length; i++) {
        const f = this.food[i]
        if (!f.alive) continue
        const dx = f.x - s.x
        const dy = f.y - s.y
        const rr = reach + f.r
        if (dx * dx + dy * dy > rr * rr) continue
        this._eatFood(s, f)
      }
    }
  }

  _eatFood(snake, f) {
    const cfg = this.cfg
    f.alive = false
    const mult = snake.registerEat(f.value)
    if (f.tier === 'gem') {
      f.expireAt = Infinity
    } else {
      f.respawnAt = this.elapsed + (f.tier === 'gold' ? 13 : 0.85)
      f.expireAt = Infinity
    }
    if (snake.isPlayer) {
      const doubleBonus = snake.effects.double > 0 ? 2 : 1
      this.score += f.value * mult * doubleBonus
    }
    this._emit({
      type: 'eat',
      x: f.x,
      y: f.y,
      value: f.value,
      tier: f.tier,
      mult,
      isPlayer: snake.isPlayer,
      combo: snake.combo,
      color: SNAKE_COLORS[snake.colorIndex % SNAKE_COLORS.length].main,
    })
  }

  _updatePowerups(dt) {
    const cfg = this.cfg
    this.powerupTimer -= dt
    if (this.powerupTimer <= 0) {
      this.powerupTimer = cfg.powerupSpawnInterval * this.rng.range(0.82, 1.22)
      let free = null
      for (const p of this.powerups) {
        if (!p.alive) {
          free = p
          break
        }
      }
      if (free) {
        const spot = this._foodSpot(140, cfg.powerupRadius)
        free.x = spot.x
        free.y = spot.y
        free.type = this.rng.pick(POWERUP_TYPES)
        free.alive = true
        free.ttl = cfg.powerupTtl
        free.phase = this.rng.range(0, Math.PI * 2)
      }
    }

    for (const p of this.powerups) {
      if (!p.alive) continue
      p.phase += dt * 1.8
      p.ttl -= dt
      if (p.ttl <= 0) {
        p.alive = false
        continue
      }
      for (const s of this.snakes) {
        if (!s.alive) continue
        const dx = p.x - s.x
        const dy = p.y - s.y
        const rr = s.radius + p.radius + cfg.powerupPickupRadius
        if (dx * dx + dy * dy > rr * rr) continue
        this._applyPowerup(s, p.type)
        p.alive = false
        this._emit({
          type: 'powerup',
          x: p.x,
          y: p.y,
          powerup: p.type,
          isPlayer: s.isPlayer,
        })
        break
      }
    }
  }

  _applyPowerup(snake, type) {
    snake.grantEffect(type, this.cfg.powerupDurations[type] ?? 6)
  }

  _respawnDeadBots() {
    const bots = this.snakes
    for (let i = 1; i < bots.length; i++) {
      const bot = bots[i]
      if (bot.alive) continue
      if (bot.respawnAt !== Infinity && bot.respawnAt <= this.elapsed) {
        this._respawnBot(bot, i - 1, false)
      }
    }
  }

  _emit(event) {
    if (this.events.length >= MAX_EVENTS) this.events.shift()
    this.events.push(event)
  }

  /** 玩家当前是否处于警戒带内（用于 HUD 与音效预警）。 */
  get edgePressure() {
    if (!this.player.alive) return 0
    const d = Math.hypot(this.player.x, this.player.y)
    return clamp(normalize(d, this.arenaRadius - this.cfg.arenaWarnBand, this.arenaRadius), 0, 1)
  }

  get aliveBots() {
    let n = 0
    for (let i = 1; i < this.snakes.length; i++) if (this.snakes[i].alive) n++
    return n
  }
}
