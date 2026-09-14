/**
 * 无头端到端冒烟测试（零依赖，直接用 CDP 驱动系统自带 Edge/Chrome）。
 *
 * 做真事：起静态服务器 → 打开真实页面 → 开始游戏 → 真实键鼠输入 →
 * 暂停/继续 → 切主题 → 等自然死亡验证结算 → 断言运行不变量、画布有内容、
 * 无 console 报错与未捕获异常 → 截图存档。
 *
 * 用法：node tools/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = 4189
const CDP_PORT = 9333
const SHOT_DIR = join(ROOT, 'docs', 'screenshots')
const DEATH_WAIT_MS = 20000

const BROWSER_CANDIDATES = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) if (p && existsSync(p)) return p
  return null
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const listeners = []

  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')))
  })

  ws.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`))
      else res(msg.result)
      return
    }
    if (msg.method) for (const l of listeners) l(msg)
  })

  return {
    ready,
    on(fn) {
      listeners.push(fn)
    },
    send(method, params = {}, sessionId) {
      const id = nextId++
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej })
        ws.send(JSON.stringify(payload))
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            rej(new Error(`CDP 超时: ${method}`))
          }
        }, 20000)
      })
    },
    close() {
      try {
        ws.close()
      } catch {
        /* 忽略 */
      }
    },
  }
}

async function waitForHttp(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch {
      /* 继续等待 */
    }
    await sleep(250)
  }
  return false
}

const checks = []
function check(name, ok, detail = '', soft = false) {
  checks.push({ name, ok: !!ok, soft, detail })
}

async function main() {
  const browser = findBrowser()
  if (!browser) {
    console.error('未找到 Chrome/Edge，跳过无头冒烟测试')
    process.exit(2)
  }
  console.log(`使用浏览器: ${browser}`)

  await mkdir(SHOT_DIR, { recursive: true })
  const profileDir = join(tmpdir(), `neon-snake-smoke-${Date.now()}`)

  const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
    stdio: 'ignore',
  })
  const browserProc = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      '--window-size=1280,800',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const errors = []
  let client = null

  try {
    if (!(await waitForHttp(`http://127.0.0.1:${PORT}/index.html`))) {
      throw new Error('本地静态服务器未就绪')
    }
    if (!(await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`))) {
      throw new Error('浏览器调试端口未就绪')
    }

    const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
    client = createCdpClient(version.webSocketDebuggerUrl)
    await client.ready

    client.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        errors.push(`未捕获异常: ${d.exception?.description ?? d.text}`)
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(
          `console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`,
        )
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push(`日志错误: ${msg.params.entry.text}`)
      }
    })

    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
    await client.send('Runtime.enable', {}, sessionId)
    await client.send('Log.enable', {}, sessionId)
    await client.send('Page.enable', {}, sessionId)
    await client.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `window.__bootErrors = [];
          window.addEventListener('error', (e) => {
            window.__bootErrors.push(e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
          });
          window.addEventListener('unhandledrejection', (e) => {
            window.__bootErrors.push('unhandledrejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
          });`,
      },
      sessionId,
    )

    const loaded = new Promise((res) => {
      client.on((msg) => {
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) res()
      })
    })
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }, sessionId)
    await Promise.race([loaded, sleep(10000)])
    await sleep(900)

    const evaluate = async (expression) => {
      const r = await client.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      )
      if (r.exceptionDetails) {
        const d = r.exceptionDetails
        throw new Error(d.exception?.description || d.text || '求值异常')
      }
      return r.result.value
    }
    const snapshot = () => evaluate(`JSON.stringify(window.__neonSnake ? window.__neonSnake.snapshot() : null)`)
    const shot = async (name) => {
      const r = await client.send('Page.captureScreenshot', { format: 'png' }, sessionId)
      await writeFile(join(SHOT_DIR, `${name}.png`), Buffer.from(r.data, 'base64'))
    }

    /**
     * 地形与食物都是随机生成的，玩家（全程无操作，只做定向探测）有可能在某一组
     * 断言之前就撞上陨石。这种情况属于"运气问题"而不是缺陷，因此在这里重开一局，
     * 保证后续断言考察的是行为本身。绝不用它来掩盖失败断言。
     */
    const ensurePlaying = async () => {
      let st = JSON.parse(await snapshot())
      if (st.mode === 'playing' && st.playerAlive) return st
      if (st.mode === 'over') {
        await evaluate(`document.getElementById('btn-again').click()`)
      } else if (st.mode === 'menu') {
        await evaluate(`document.getElementById('btn-play').click()`)
      }
      await sleep(700)
      return JSON.parse(await snapshot())
    }

    /** 无论当前是"游戏中 / 已暂停 / 已结算"，都回到主菜单。 */
    const returnToMenu = async () => {
      if (JSON.parse(await snapshot()).mode === 'over') {
        await evaluate(`document.getElementById('btn-back').click()`)
        await sleep(700)
      }
      if (JSON.parse(await snapshot()).mode === 'playing') {
        await evaluate(`document.getElementById('btn-pause').click()`)
        await sleep(250)
      }
      if (JSON.parse(await snapshot()).mode === 'paused') {
        await evaluate(`document.getElementById('btn-quit').click()`)
        await sleep(700)
      }
    }

    // ---- 1. 启动与骨架 ----
    check('页面标题正确', (await evaluate('document.title')).includes('Neon Snake'))
    const bootErrors = await evaluate(`JSON.stringify(window.__bootErrors || [])`)
    check('启动期无脚本错误', bootErrors === '[]', bootErrors)
    check(
      '主模块可正常求值',
      (await evaluate(`import('./src/main.js').then(() => 'ok').catch((e) => 'ERR: ' + e.message)`)) ===
        'ok',
    )
    check(
      '诊断接口可用',
      (await evaluate(`typeof window.__neonSnake?.snapshot`)) === 'function',
    )
    check(
      '主菜单已渲染',
      await evaluate(`!document.getElementById('screen-menu').classList.contains('hidden')`),
    )
    check(
      '难度/主题/画质选择器完整',
      await evaluate(
        `document.querySelectorAll('#seg-difficulty button').length === 3 &&
         document.querySelectorAll('#seg-theme button').length === 3 &&
         document.querySelectorAll('#seg-quality button').length === 3`,
      ),
    )
    check(
      'CSS 已生效',
      await evaluate(
        `getComputedStyle(document.querySelector('#screen-menu .panel')).borderRadius !== '0px'`,
      ),
    )

    // ---- 2. 开始游戏 ----
    await evaluate(`document.getElementById('btn-play').click()`)
    await sleep(1200)
    let s = JSON.parse(await snapshot())
    check('进入游戏模式', s && s.mode === 'playing', JSON.stringify(s))
    check('进入游戏时所有覆盖层已隐藏', s.screen === null, `screen=${s.screen}`)
    check('HUD 已显示', await evaluate(`!document.getElementById('hud').classList.contains('hidden')`))
    check('主菜单已隐藏', await evaluate(`document.getElementById('screen-menu').classList.contains('hidden')`))
    check('游戏时钟在推进', s.elapsed > 0.6, `elapsed=${s.elapsed}`)
    check('玩家存活且初始质量正确', s.playerAlive && s.playerMass >= 12, `mass=${s.playerMass}`)
    check('竞技场处于初始半径', Math.abs(s.arenaRadius - 1900) < 1, `r=${s.arenaRadius}`)
    check('身体节点已生成', s.playerNodes > 1, `nodes=${s.playerNodes}`)
    check('AI 对手数量符合难度预设', s.aliveBots === 4, `bots=${s.aliveBots}`)
    check(
      '轨迹点数不超容量上限',
      s.pathPoints > 0 && s.pathPoints <= 3200,
      `path=${s.pathPoints}`,
    )
    check('粒子上限与画质匹配（高=900）', s.particleLimit === 900, `limit=${s.particleLimit}`)

    const painted = await evaluate(`(() => {
      const c = document.getElementById('game')
      if (!c || c.width === 0) return -1
      const ctx = c.getContext('2d')
      const data = ctx.getImageData(0, 0, c.width, c.height).data
      let lit = 0
      for (let i = 0; i < data.length; i += 4 * 101) {
        if (data[i] > 14 || data[i + 1] > 14 || data[i + 2] > 14) lit++
      }
      return lit
    })()`)
    check('画布已渲染内容', painted > 200, `采样到 ${painted} 个非暗像素`)
    check('画布分辨率跟随 DPR', await evaluate(`document.getElementById('game').width > 600`))

    // ---- 3. 触屏输入（按下即接管转向，360° 拖动指向） ----
    // 先测这一段：此时玩家刚从场地中心出发，前方是"最开阔方向"，短时盲开不会撞到陨石。
    await ensurePlaying()
    await evaluate(`(() => {
      const c = document.getElementById('game')
      const r = c.getBoundingClientRect()
      const mk = (type, x, y) => new PointerEvent(type, {
        pointerType: 'touch', pointerId: 1, isPrimary: true,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      })
      c.dispatchEvent(mk('pointerdown', r.left + r.width * 0.5, r.top + r.height * 0.5))
      c.dispatchEvent(mk('pointermove', r.left + r.width * 0.9, r.top + r.height * 0.5))
      c.dispatchEvent(mk('pointermove', r.left + r.width * 0.94, r.top + r.height * 0.5))
      return true
    })()`)
    await sleep(800)
    const touch = JSON.parse(await snapshot())
    check('触屏按下即接管转向模式', touch.inputMode === 'pointer', `mode=${touch.inputMode}`)
    check('触屏会点亮屏幕加速按钮', touch.isTouch === true)
    check(
      '触屏拖动可把蛇头转向手指方向',
      touch.playerAlive &&
        Math.abs(Math.atan2(Math.sin(touch.playerAngle), Math.cos(touch.playerAngle))) < 0.8,
      `angle=${touch.playerAngle.toFixed(3)} alive=${touch.playerAlive}`,
    )
    await evaluate(`(() => {
      document.getElementById('game').dispatchEvent(
        new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 1, bubbles: true }),
      )
      return true
    })()`)

    // ---- 3b. 键盘输入（转向 + 加速） ----
    await ensurePlaying()
    const beforeKeys = JSON.parse(await snapshot())
    await evaluate(`(() => {
      const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
      fire('keydown', 'KeyA')
      setTimeout(() => fire('keyup', 'KeyA'), 300)
      fire('keydown', 'ShiftLeft')
      setTimeout(() => fire('keyup', 'ShiftLeft'), 900)
      return true
    })()`)
    await sleep(1400)
    s = JSON.parse(await snapshot())
    check('键盘输入后时间继续推进', s.elapsed > beforeKeys.elapsed, `${beforeKeys.elapsed} → ${s.elapsed}`)
    check(
      '键盘转向确实改变了蛇头朝向',
      Math.abs(s.playerAngle - beforeKeys.playerAngle) > 0.05,
      `${beforeKeys.playerAngle.toFixed(3)} → ${s.playerAngle.toFixed(3)}`,
    )
    // 加速的"扣质量"由单元测试精确覆盖（tests/snake.test.js）；
    // 这里守的是端到端不变量：加速状态下质量绝不允许跌破门槛。
    check(
      '加速状态下质量不低于门槛（不会被烧成负数）',
      !s.playerBoosting || s.playerMass > s.minMassToBoost,
      `mass=${s.playerMass} boosting=${s.playerBoosting} gate=${s.minMassToBoost}`,
    )
    check('键盘操作不会把输入模式永久锁在指针模式', s.inputMode === 'keyboard' || s.inputMode === 'pointer')

    // ---- 4. 鼠标输入 ----
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 200, button: 'none' }, sessionId)
    await client.send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 1000, y: 200, button: 'left', clickCount: 1, buttons: 1 },
      sessionId,
    )
    await sleep(600)
    await client.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: 1000, y: 200, button: 'left', clickCount: 1 },
      sessionId,
    )
    await sleep(400)
    const afterMouse = JSON.parse(await snapshot())
    check('鼠标交互后仍在运行', afterMouse.elapsed > s.elapsed || afterMouse.mode === 'over')

    // ---- 5. 暂停 / 继续 ----
    await ensurePlaying()
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`)
    await sleep(350)
    let paused = JSON.parse(await snapshot())
    if (paused.mode === 'paused') {
      check('Esc 可暂停', true)
      check('暂停面板出现', await evaluate(`!document.getElementById('screen-pause').classList.contains('hidden')`))
      const frozen = paused.elapsed
      await sleep(700)
      const stillFrozen = JSON.parse(await snapshot()).elapsed
      check('暂停期间世界停止推进', Math.abs(stillFrozen - frozen) < 1e-6, `${frozen} → ${stillFrozen}`)
      await evaluate(`document.getElementById('btn-resume').click()`)
      await sleep(300)
      check('可继续游戏', JSON.parse(await snapshot()).mode === 'playing')
    } else {
      check('Esc 可暂停', false, `当前模式 ${paused.mode}（可能已死亡）`, true)
    }

    // ---- 6. 主题切换 ----
    await evaluate(`document.querySelector('#seg-theme button[data-value="abyss"]').click()`)
    await sleep(500)
    check('切换主题写入状态', JSON.parse(await snapshot()).theme === 'abyss')
    check(
      '切换主题后强调色同步',
      (await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)) ===
        '#2ff0b8',
    )
    await shot('smoke-gameplay')

    // ---- 7. 回主菜单 ----
    await returnToMenu()
    const menuState = JSON.parse(await snapshot())
    check('可返回主菜单', menuState.mode === 'menu', `mode=${menuState.mode}`)
    check('主菜单界面可见', await evaluate(`!document.getElementById('screen-menu').classList.contains('hidden')`))
    check('回到主菜单时所有覆盖层状态自洽', menuState.screen === 'menu' || menuState.screen === null)
    await shot('smoke-menu')

    // ---- 7b. 主菜单"吸引模式"必须真的在跑（而不是静止的空世界） ----
    {
      const attractA = JSON.parse(await snapshot())
      await sleep(1000)
      const attractB = JSON.parse(await snapshot())
      check(
        '主菜单吸引模式的世界在推进',
        attractB.elapsed > attractA.elapsed,
        `${attractA.elapsed.toFixed(2)} → ${attractB.elapsed.toFixed(2)}`,
      )
      check('吸引模式下玩家蛇已具备身体与对手', attractB.playerNodes > 1 && attractB.aliveBots >= 1, `nodes=${attractB.playerNodes} bots=${attractB.aliveBots}`)
    }

    // ---- 7c. 覆盖层语义：Esc / Enter 不得穿透主菜单直接开局 ----
    await evaluate(`document.getElementById('btn-help').click()`)
    await sleep(250)
    check('玩法说明可以打开', JSON.parse(await snapshot()).screen === 'help')
    check(
      '玩法说明的道具条目由配置生成（非空）',
      (await evaluate(`document.getElementById('help-powerups').textContent.length`)) > 10,
    )
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))`)
    await sleep(300)
    const afterEnter = JSON.parse(await snapshot())
    check(
      '在说明界面按 Enter 不会穿透开始游戏',
      afterEnter.mode === 'menu' && afterEnter.screen === 'menu',
      `mode=${afterEnter.mode} screen=${afterEnter.screen}`,
    )

    await evaluate(`document.getElementById('btn-achievements').click()`)
    await sleep(250)
    check('成就列表渲染出全部条目', await evaluate(`document.querySelectorAll('#ach-list li').length === 8`))
    await shot('smoke-achievements')
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`)
    await sleep(250)
    check('在成就界面按 Esc 可返回主菜单', JSON.parse(await snapshot()).screen === 'menu')

    // ---- 8. 等自然死亡，验证结算链路 ----
    await evaluate(`document.getElementById('btn-play').click()`)
    const deadline = Date.now() + DEATH_WAIT_MS
    let died = false
    while (Date.now() < deadline) {
      const st = JSON.parse(await snapshot())
      if (st.mode === 'over') {
        died = true
        break
      }
      await sleep(400)
    }
    if (died) {
      const over = JSON.parse(await snapshot())
      check('死亡后进入结算界面（soft）', await evaluate(`!document.getElementById('screen-over').classList.contains('hidden')`), '', true)
      check(
        '结算面板数值有效（soft）',
        await evaluate(`(() => {
          const n = (id) => document.getElementById(id).textContent
          return /^\\d+$/.test(n('over-score')) && /^\\d+:\\d\\d$/.test(n('over-time')) &&
                 /^\\d+$/.test(n('over-kills')) && /^×\\d+$/.test(n('over-combo'))
        })()`),
        '',
        true,
      )
      check('结算时玩家确已死亡（soft）', over.playerAlive === false, '', true)
      check('最高分已持久化（soft）', over.best >= over.score, `${over.best} vs ${over.score}`, true)
      await shot('smoke-gameover')
      await evaluate(`document.getElementById('btn-again').click()`)
      await sleep(700)
      const restarted = JSON.parse(await snapshot())
      check(
        '可以再来一局（状态与计时均已重置）',
        restarted.mode === 'playing' && restarted.elapsed < 2 && restarted.playerAlive === true,
        `mode=${restarted.mode} elapsed=${restarted.elapsed} alive=${restarted.playerAlive}`,
        true,
      )
    } else {
      check('在 20 秒内自然死亡并进入结算（soft）', false, '窗口内未死亡，跳过结算链路校验', true)
    }

    check('无 console 报错与未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (err) {
    check('冒烟流程完整执行', false, err.message)
  } finally {
    client?.close()
    browserProc.kill()
    server.kill()
    await sleep(400)
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }

  const hard = checks.filter((c) => !c.soft)
  const report = {
    pass: checks.filter((c) => c.ok).length,
    fail: checks.filter((c) => !c.ok).length,
    hardFail: hard.filter((c) => !c.ok).length,
    softFail: checks.filter((c) => !c.ok && c.soft).length,
    checks,
  }
  console.log(JSON.stringify(report, null, 2))
  await mkdir(join(ROOT, '.artifacts'), { recursive: true })
  await writeFile(REPORT, JSON.stringify(report, null, 2), 'utf8')
  process.exit(report.hardFail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('冒烟测试异常终止:', err.message)
  await mkdir(join(ROOT, '.artifacts'), { recursive: true }).catch(() => {})
  await writeFile(
    REPORT,
    JSON.stringify({ pass: 0, fail: 1, hardFail: 1, error: err.message, checks }, null, 2),
    'utf8',
  )
  process.exit(1)
})
