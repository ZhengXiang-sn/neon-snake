/**
 * 成就系统：纯规则判断，便于单测。
 * 由 main.js 每帧（或每若干帧）以当前局内统计调用。
 */
export const ACHIEVEMENTS = [
  { id: 'first_blood', name: '首杀', desc: '撞死第一条 AI 蛇' },
  { id: 'combo5', name: '连击大师', desc: '连击达到 5 层' },
  { id: 'mass100', name: '膘肥体壮', desc: '质量达到 100' },
  { id: 'gold10', name: '黄金猎手', desc: '一局吃掉 10 个金色食物' },
  { id: 'gem20', name: '拾荒者', desc: '一局拾取 20 个宝石' },
  { id: 'kills3', name: '三杀', desc: '一局撞死 3 条 AI 蛇' },
  { id: 'survive180', name: '长跑选手', desc: '单局存活 180 秒' },
  { id: 'powerup5', name: '道具控', desc: '一局拾取 5 个道具' },
]

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

/** 没有新解锁时复用同一个空数组，避免每帧返回新数组造成 GC 压力。 */
const NO_UNLOCKS = []

export function createRunStats() {
  return {
    gold: 0,
    gem: 0,
    powerups: 0,
    maxCombo: 0,
  }
}

/**
 * @param {ReturnType<typeof createRunStats>} run 本局统计
 * @param {{kills:number, score:number}} world
 * @param {import('./snake.js').Snake} player
 * @param {Set<string>} unlocked 已解锁集合（会被就地修改）
 * @returns {string[]} 本次新解锁的成就 id
 */
export function evaluateAchievements(run, world, player, unlocked) {
  const out = []
  const check = (id, cond) => {
    if (cond && !unlocked.has(id)) {
      unlocked.add(id)
      out.push(id)
    }
  }
  check('first_blood', world.kills >= 1)
  check('combo5', run.maxCombo >= 5)
  check('mass100', player.mass >= 100)
  check('gold10', run.gold >= 10)
  check('gem20', run.gem >= 20)
  check('kills3', world.kills >= 3)
  check('survive180', player.survivalTime >= 180)
  check('powerup5', run.powerups >= 5)
  return out
}
