/**
 * 全局可调参数 —— 单一事实来源。
 * 所有数值都集中在此，便于平衡性调整与测试注入。
 */

export const CONFIG = {
  /** 物理固定时间步（秒）。渲染帧率与之解耦。 */
  fixedStep: 1 / 60,
  /** 单帧最多追帧次数，防止切回前台时出现"死亡螺旋"。 */
  maxSubSteps: 5,

  arena: {
    /**
     * 竞技场半径。早期版本开局 1900、终局 760（面积比 6.3×），
     * 而相机可视跨度只有 640 —— 玩家开局看到的不到全场的 1/17，
     * 观感上"又空又大"，地形也只能挤在中心。现在缩小到 1500→840，
     * 面积比 3.2×，缩圈依然有压迫感，但场地始终显得"有东西"。
     */
    radiusStart: 1500,
    radiusMin: 840,
    /** 开局多少秒后开始收缩 */
    shrinkDelay: 25,
    /** 收缩持续秒数 */
    shrinkDuration: 180,
    /** 警戒带宽度：进入后开始预警 */
    warnBand: 220,
  },

  /**
   * 地形生成参数。四个生态共用这套"分区"约定：
   * 内圈（≤ arenaRadiusMin）的障碍物终局仍在，外圈的会被缩圈逐个吞噬。
   */
  terrain: {
    /**
     * 出生点净空半径。语义是"障碍物**中心**不得进入该半径"，
     * 而不是"障碍物本体不得进入"：最内侧的障碍中心在 330 上下、
     * 半径最大约 62，所以本体最近可以探到距原点 ~272 处。
     * 实测四个生态的障碍物本体都不会盖住原点，出生点始终安全。
     */
    innerClear: 300,
    /** 缩圈吞噬地形时的粒子强度 */
    dissolveBurst: 0.9,
  },

  /**
   * 场景装饰（不参与碰撞的纯视觉物件）与空气粒子。
   * 数量按画质档缩放，避免低端机为了好看而掉帧。
   */
  scenery: {
    /** 每个生态的装饰物数量（高画质） */
    decorHigh: 132,
    decorMedium: 70,
    decorLow: 0,
    /** 屏幕空间空气粒子数量（高画质） */
    ambientHigh: 46,
    ambientMedium: 24,
    ambientLow: 0,
  },

  snake: {
    startMass: 12,
    baseSpeed: 232,
    boostMult: 1.6,
    /** 质量带来的速度惩罚系数与上限 */
    speedMassPenalty: 0.0012,
    speedPenaltyCap: 0.42,
    baseTurnRate: 4.3,
    turnMassPenalty: 0.0011,
    turnPenaltyCap: 0.45,
    /** radius = radiusBase + radiusGain * mass ^ radiusExp */
    radiusBase: 8.5,
    radiusGain: 1.65,
    radiusExp: 0.4,
    /** bodyLen = lenBase + lenPerMass * mass，并受 lenMax 约束 */
    lenBase: 190,
    lenPerMass: 6.5,
    lenMax: 4200,
    /** 加速每秒消耗质量 */
    boostMassCost: 9,
    /** 低于该质量不可加速 */
    minMassToBoost: 14,
    /** 相邻身体节点弧长间距 */
    segmentSpacing: 10.5,
    /** 单条蛇最多采样出的身体节点数（性能护栏） */
    maxNodes: 420,
    /** 头部轨迹环形缓冲容量（采样点数量） */
    pathCapacity: 3200,
    /** 头部附近多少弧长内不参与自碰撞（避免贴颈误杀） */
    selfHitSkipDist: 52,
    /** 碰撞半径缩放：视觉半径略大于判定半径，手感更宽容 */
    collideRadiusFactor: 0.86,
  },

  food: {
    /** 场上常驻普通食物数量（随竞技场缩小同步下调，保持单位面积密度稳定） */
    commonCount: 240,
    commonValue: 1,
    commonRadius: 4.6,
    goldCount: 12,
    goldValue: 6,
    goldRadius: 7.4,
    /** 食物落点避开障碍物的重试次数 */
    placeTries: 6,
    /** 宝石掉落时"每个球承载的价值"基准，仅用于决定球数与球径 */
    gemValuePerOrb: 5.5,
    gemRadius: 9,
    /** 磁铁吸附半径 */
    magnetRadius: 215,
    /** 食物被吸附时的最大速度 */
    magnetSpeed: 520,
  },

  powerup: {
    spawnInterval: 8.5,
    maxOnField: 4,
    ttl: 15,
    radius: 17,
    /** 拾取时的"接近即吸附"半径 */
    pickupRadius: 6,
    /**
     * 护盾吸收一次致命撞击后残留的无敌帧（秒）。
     * 没有这段缓冲，撞墙被护盾救下后会在下一帧立刻再次撞墙死亡。
     */
    shieldGrace: 0.9,
    /** 计时类道具的持续时间（秒）。护盾为"一次性"，不在此表内。 */
    durations: {
      magnet: 9,
      slow: 6.5,
      ghost: 7,
      double: 11,
    },
  },

  combo: {
    /** 超过该间隔未进食则连击清零（秒） */
    window: 2.6,
    /** 每多少层连击提升一级倍率 */
    perStack: 3,
    maxMult: 8,
  },

  death: {
    /** 死亡时转化为可拾取宝石的质量比例 */
    dropRatio: 0.65,
    gemOrbsMax: 46,
    /** 爆开半径 */
    ringRadius: 92,
  },

  camera: {
    /** 跟随平滑速率（指数趋近） */
    follow: 7.5,
    /** 沿朝向前瞻距离 */
    lookAhead: 96,
    /** 视口覆盖的世界跨度（较小边的基准，质量越大越远） */
    spanBase: 640,
    spanPerMass: 1.15,
    spanMax: 2300,
    zoomMin: 0.32,
    zoomMax: 1.5,
    /** 缩放趋近速率（比位置跟随更慢，避免缩放抖动） */
    zoomFollow: 3.4,
  },

  /** 各画质档的粒子上限（唯一来源，渲染器与启动流程都读这里） */
  particles: {
    high: 900,
    medium: 460,
    low: 170,
  },

  quality: {
    /** 连续统计窗口内平均帧时超过该值则降档（毫秒） */
    downshiftFrameMs: 22,
    /** 判定降档所需的最小采样帧数 */
    windowFrames: 30,
  },

  score: {
    killBonus: 60,
  },

  /** 每局结算面板展示的历史记录键 */
  storageKeys: {
    highScore: 'highscore',
    settings: 'settings',
    achievements: 'achievements',
    tutorial: 'tutorialSeen',
  },
}

/** 难度预设：只影响压力与 AI 强度，不改玩法规则。 */
export const DIFFICULTY = {
  easy: { bots: 2, speedMult: 0.9, shrinkMult: 1.25, aiReaction: 0.28, aiProbes: 2 },
  normal: { bots: 4, speedMult: 1, shrinkMult: 1, aiReaction: 0.16, aiProbes: 3 },
  hard: { bots: 6, speedMult: 1.08, shrinkMult: 0.8, aiReaction: 0.08, aiProbes: 4 },
}

export const POWERUP_TYPES = ['shield', 'magnet', 'slow', 'ghost', 'double']

/**
 * 道具文案的唯一来源：`name` 用于 HUD 徽标，`toast` 用于拾取提示，`desc` 用于玩法说明。
 * 各处 UI 一律读这里，避免同一份文案在多个文件里各写一遍而逐渐漂移。
 */
export const POWERUP_INFO = {
  shield: { name: '护盾', toast: '护盾已就绪 · 可免疫一次撞击', desc: '护盾：免疫一次致命撞击' },
  magnet: { name: '磁铁', toast: '磁铁已激活 · 吸附附近食物', desc: '磁铁：吸附附近食物' },
  slow: { name: '减速力场', toast: '减速力场已激活', desc: '减速力场：附近对手变慢' },
  ghost: { name: '幽灵', toast: '幽灵形态已激活 · 可穿过自身', desc: '幽灵：可穿过自身身体' },
  double: { name: '双倍分数', toast: '双倍分数已激活', desc: '双倍分数：得分翻倍' },
}

/** 蛇体配色索引，玩家固定 0。 */
export const SNAKE_COLORS = [
  { name: 'cyan', main: '#35e6ff', glow: '#0af0ff', dark: '#0a5f7a' },
  { name: 'magenta', main: '#ff5ce0', glow: '#ff2ec4', dark: '#7a1a67' },
  { name: 'lime', main: '#9dff4d', glow: '#6cff0a', dark: '#3f7a1a' },
  { name: 'amber', main: '#ffb43d', glow: '#ff9500', dark: '#7a4d0e' },
  { name: 'violet', main: '#a98cff', glow: '#8a5cff', dark: '#452a7a' },
  { name: 'coral', main: '#ff7a5c', glow: '#ff4a2e', dark: '#7a2f1a' },
  { name: 'spring', main: '#4dffc3', glow: '#0affa8', dark: '#1a7a5c' },
]

/**
 * 生成"扁平运行时配置"：把嵌套的 CONFIG 与难度预设摊平成一维，
 * 供 game/ 下的纯逻辑模块直接消费（避免各模块到处写 cfg.snake.xxx）。
 */
export function createGameConfig({ difficulty = 'normal', biome = 'neon' } = {}) {
  const d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal
  const s = CONFIG.snake
  return {
    difficulty: d,
    /** 本局生态 id；地形生成按它选布局算法 */
    biome,
    fixedStep: CONFIG.fixedStep,
    maxSubSteps: CONFIG.maxSubSteps,

    startMass: s.startMass,
    baseSpeed: s.baseSpeed,
    boostMult: s.boostMult,
    speedMassPenalty: s.speedMassPenalty,
    speedPenaltyCap: s.speedPenaltyCap,
    baseTurnRate: s.baseTurnRate,
    turnMassPenalty: s.turnMassPenalty,
    turnPenaltyCap: s.turnPenaltyCap,
    radiusBase: s.radiusBase,
    radiusGain: s.radiusGain,
    radiusExp: s.radiusExp,
    lenBase: s.lenBase,
    lenPerMass: s.lenPerMass,
    lenMax: s.lenMax,
    boostMassCost: s.boostMassCost,
    minMassToBoost: s.minMassToBoost,
    segmentSpacing: s.segmentSpacing,
    maxNodes: s.maxNodes,
    pathCapacity: s.pathCapacity,
    selfHitSkipDist: s.selfHitSkipDist,
    collideRadiusFactor: s.collideRadiusFactor,

    comboWindow: CONFIG.combo.window,
    comboPerStack: CONFIG.combo.perStack,
    comboMaxMult: CONFIG.combo.maxMult,

    deathDropRatio: CONFIG.death.dropRatio,
    deathGemOrbsMax: CONFIG.death.gemOrbsMax,
    deathRingRadius: CONFIG.death.ringRadius,

    arenaRadiusStart: CONFIG.arena.radiusStart,
    arenaRadiusMin: CONFIG.arena.radiusMin,
    arenaShrinkDelay: CONFIG.arena.shrinkDelay,
    arenaShrinkDuration: CONFIG.arena.shrinkDuration * d.shrinkMult,
    arenaWarnBand: CONFIG.arena.warnBand,

    terrainInnerClear: CONFIG.terrain.innerClear,
    terrainDissolveBurst: CONFIG.terrain.dissolveBurst,

    foodCommonCount: CONFIG.food.commonCount,
    foodCommonValue: CONFIG.food.commonValue,
    foodCommonRadius: CONFIG.food.commonRadius,
    foodGoldCount: CONFIG.food.goldCount,
    foodGoldValue: CONFIG.food.goldValue,
    foodGoldRadius: CONFIG.food.goldRadius,
    foodGemValuePerOrb: CONFIG.food.gemValuePerOrb,
    foodGemRadius: CONFIG.food.gemRadius,
    foodPlaceTries: CONFIG.food.placeTries,
    foodMagnetRadius: CONFIG.food.magnetRadius,
    foodMagnetSpeed: CONFIG.food.magnetSpeed,

    powerupSpawnInterval: CONFIG.powerup.spawnInterval,
    powerupMaxOnField: CONFIG.powerup.maxOnField,
    powerupTtl: CONFIG.powerup.ttl,
    powerupRadius: CONFIG.powerup.radius,
    powerupPickupRadius: CONFIG.powerup.pickupRadius,
    powerupShieldGrace: CONFIG.powerup.shieldGrace,
    powerupDurations: CONFIG.powerup.durations,

    killBonus: CONFIG.score.killBonus,

    botCount: d.bots,
    botSpeedMult: d.speedMult,
    aiReaction: d.aiReaction,
    aiProbes: d.aiProbes,
  }
}
