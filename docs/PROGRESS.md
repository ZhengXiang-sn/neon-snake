# 开发过程记录（PROGRESS）

任务来源：课件《🍅 草履虫也懂的 Vibe Coding 部署课》要求做一个纯 HTML 项目 → 推 GitHub → 部署 Vercel（Framework Preset = Other）→ 提交 `xxx.vercel.app` 链接。
用户把课件里的"番茄钟"换成**贪吃蛇**，并要求尽可能 SOTA：美观 UI、全向移动、玩法比"只吃目标"更丰富，且全程记录、自测自审、最后做严苛的独立上下文审核。

---

## 阶段 0 · 环境勘察

- 工作目录 `neon-snake/`。
- Bash 工具在本机是 Git-Bash 阉割版，**缺 coreutils**（`mkdir`/`cp`/`dirname` 都不可用），因此文件操作全部走 Write/Edit/Read，命令走 PowerShell。
- Node `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`；系统自带 Edge 可用于无头端到端测试（不必安装 Playwright）。
- 发现：`node --test tests/` 与 `node --test tests` 在这个 Node 版本上都会报 `Cannot find module`，必须用 `node --test tests/**/*.test.js`。

## 阶段 1 · 调研（docs/RESEARCH.md）

拆解 Google Snake 的玩法模式与 Slither.io 的机制，并查 Canvas 性能资料，得出优先级：

- **P0 必备**：全向转向、加速消耗质量、身体即武器、AI 对手、缩圈竞技场
- **P1 加分**：三级食物、连击、5 种道具、陨石障碍、成就、多主题
- **性能结论**：热路径禁用 `shadowBlur` / `filter` / 逐帧新建渐变；静态层预渲染缓存；粒子和碰撞必须零分配

## 阶段 2 · 设计与实现（docs/DESIGN.md）

玩法规格 G-01…G-17 落到代码，按"纯逻辑 / 渲染 / UI"三层拆分，让 `core` 与 `game` 完全不碰 DOM、可在 Node 下直接单测。

关键实现选择：

| 问题 | 方案 |
| --- | --- |
| 全向移动怎么表达身体？ | 头部轨迹环形缓冲 + 按固定弧长重采样成节点序列。天然支持任意方向与曲率，且与帧率无关 |
| 惯性转向 | `rotateTowards(current, target, turnRate × dt)`，永不瞬转；质量越大转向率越低 |
| 每帧数千次碰撞怎么不卡？ | 均匀空间网格，桶内用 5 元组扁平数组 `[x,y,r,ref,idx]`，跨帧只清 length 不重建 |
| 发光怎么便宜？ | 预渲染径向渐变精灵 + `globalCompositeOperation='lighter'` |
| 帧率不一致怎么办？ | 1/60 s 固定步 + 累加器 + 追帧上限（防切回前台时死亡螺旋） |

## 阶段 3 · 自测自审（发现并修掉的真实 bug）

1. **单测第 1 轮 60/64 失败**：`rotateTowards` 断言写错角度符号；碰撞类测试被随机生成的陨石干扰而随机失败（加 `isolate()` 隔离）；`edgePressure` 断言过严。
2. **单测第 2 轮暴露真实玩法 bug**：自撞豁免用的是固定弧长，**大蛇会咬死自己的第二节**。改为随半径缩放（`radius × collideRadiusFactor × 2 + 28`），并补一条跨质量 12→400 的回归测试。
3. **冒烟测试第 1 轮：白屏**。根因是 `renderer.js` 里少了一个换行，两个语句被粘成一行（`SyntaxError`）。修复后**新增 `tools/check-syntax.mjs`**，让渲染层/DOM 层的语法错误无法再溜过单测。这一步后来证明价值极大。
4. **冒烟测试第 2 轮：随机出生角度导致出生即撞陨石**。新增 `_clearanceAt` / `_findSpawnAngle`（16 方向里挑最开阔的），玩家与 AI 出生共用。
5. 给页面挂上**只读诊断接口** `window.__neonSnake.snapshot()`，端到端测试据此做硬断言，而不是靠截图肉眼比对。

## 阶段 4 · 两轮独立上下文审计（docs/AUDIT.md）

- 第一轮：3 个全新上下文审计代理并行（逻辑 / 前端 / 冗余）。
- 发现 **7 个 P0**：加速不扣质量、护盾纯装饰、触屏完全无法转向、`globalAlpha` 泄漏导致蛇头半透明、覆盖层被 Enter 穿透、点击"成就"抛 `ReferenceError`、主菜单吸引模式是死代码。
- 修完全部 P0 与多数 P1/P2 后，按要求**开启第二轮**：2 个全新审计代理做"修复验证 + 回归 + 新漏洞"。
- 第二轮结果 **P0 = 0**（5 项修复全部被独立验证有效），另揪出 4 处 P2 + 1 处第一轮遗漏的 P1，一并修掉。
- 最终：`check` 34 文件 / 94 链接 0 失败，`test` 73/73，`smoke` 50/50。

### 最值钱的三条教训

1. **"单测全绿"不等于"功能完整"**。7 个 P0 里有 4 个落在测试盲区：护盾没效果、触屏不能转向、成就按钮报错、吸引模式是死代码 —— 它们全都有 65/65 的绿灯背书。**必须要有真实跑起来的端到端测试**。
2. **静态检查要覆盖"链接"而不只是"语法"**。少写一个 `export` 既不是语法错误、单测也不会 import 渲染层，但会让浏览器白屏。补上具名导入/导出核对之后，同类问题在开发过程中被拦下 2 次。
3. **对抗式审计不能省**。"看起来对"的代码（`effects.shield = true` 写得很自然）和"真的生效"差着一条调用链。让全新上下文的人来读，才问得出"这个字段到底谁在读"。

## 阶段 5 · 仓库整理与部署准备

- 新增 `README.md`、`.gitignore`；清理根目录 15 个本地自查日志。
- 冒烟报告从根目录移到 `.artifacts/`（已 gitignore），避免被一起部署上线。
- `package.json` 脚本：`serve` / `check` / `test` / `smoke` / `verify`。
- `vercel.json`：`{ "version": 2, "cleanUrls": true }`，无需构建命令与输出目录，Framework Preset 选 **Other**。

## 阶段 6 · 提交前的稳定性复核（发现 1 个真实展示 bug + 3 处测试抖动）

首次提交后重跑冒烟，出现 **1 红**（`可继续游戏`）。本以为是偶发，于是**连跑多次统计**，结果 4 次里又红在不同条目上：

| 轮次 | 红掉的断言 |
| --- | --- |
| A | `可继续游戏` |
| B | `AI 对手数量符合难度预设` |
| C | `结算面板数值有效（soft）` |

### 定位过程（没有靠猜）

1. 先在页面里挂 `visibilitychange` / `blur` / `focus` 事件记录器，重跑 6 次 —— **`vis=[]`、blur 从未触发**，排除了"自动暂停竞态"这个最像的假设。
2. 转而写了一个**高频复现脚本**（`.artifacts/probe.mjs`，不入库）：30 次"暂停→继续"，每 16ms 采样一次 `mode`。结果 **4/30 次出现 `playing → over`** —— 根本原因水落石出：暂停会把世界冻在半空，如果蛇本来正朝陨石或对手冲，**恢复后几百毫秒内死亡完全正常**。断言 `mode === 'playing'` 就等于断言"这一局刚好没撞上东西"。

### 真实产品 bug（顺手揪出）

`结算面板数值有效` 会偶发失败的根因是**分数是浮点数**：宝石掉落按 `总价值 / 球数` 均分（`world.js` 的 `per = total / count`），再乘连击倍率，于是 `world.score` 可能是 `73.33333333333333`。HUD、结算面板、主菜单最高分三处都在用 `String()` 直出，**玩家会看到一长串脏小数**。

- 修复：新增 `src/core/format.js` 的 `formatScore()`（非有限值 → `0`，其余取整），HUD / 结算 / 主菜单统一走它。
- 加回归测试：`tests/format.test.js` 断言 `73.33333333333333 → '73'`、`5.5 → '6'`，且结果恒匹配 `/^\d+$/`。

### 测试抖动修复

| 断言 | 问题 | 改法 |
| --- | --- | --- |
| `可继续游戏` | 断言"蛇还活着"，依赖随机地形 | 改断言**机制**：轮询直到 `mode !== 'paused'` 且 `elapsed` 前进（死亡同样证明世界已解冻） |
| `AI 对手数量符合难度预设` | 断言"此刻恰好存活 4 个"，对手撞陨石后延迟重生 | 服务端暴露配置常量 `botTarget`；改断言 `botTarget === 4 && 1 ≤ aliveBots ≤ botTarget` |
| `结算面板数值有效` | 分数浮点直出 | 由 `formatScore` 从根上消除 |

### 最终验收

`check` 34 文件 / 97 链接 0 失败；`test` **75/75**；`smoke` 连跑 **5 次全绿 50/50**（hardFail=0、softFail=0）。

## 阶段 7 · 推送 GitHub 与 Vercel 上线

### GitHub

- 建仓：`POST /user/repos` → `ZhengXiang-sn/neon-snake`（public，默认分支 `main`）。
- 推送：`main:main`，首个远端提交 `8fee6e3`。
- 踩坑：本机 git 全局配置了一个**已失效的代理** `http://127.0.0.1:7890`，直连 `github.com:443` 也被出口策略拦（`api.github.com` 反而可达）。用一次性 `git -c http.proxy=<可用代理>` 覆盖后推送成功；令牌只出现在单次命令里，**没有写进 `.git/config` 或任何文件**。

### Vercel

- 部署方式：Vercel REST API `POST /v13/deployments`，50 个文件内联 base64 上传（排除 `.git`/`.artifacts`），`target=production`，`projectSettings.framework=null`。
- 结果：`state=READY`，`buildSkipped=False`，`builds=0`（纯静态，无构建步骤）。
- 生产别名：`neon-snake-kappa.vercel.app`（主）、`neon-snake-zheng-xiang.vercel.app`。
  - 注意 `neon-snake.vercel.app` 已被他人占用，Vercel 因此自动补了后缀，这属于正常行为。

### 上线后的一致性校验

本机出口是白名单式的（`github.com` / `vercel.com` / `api.vercel.com` 可达，`*.vercel.app` 与 `example.com` 均被拦），**无法直接抓取线上页面**。因此改用 API 做等价校验：

```
GET /v7/deployments/{id}/files/{uid}  →  { "data": "<base64 文件内容>" }
```

把 50 个远端文件的 `data` 解码后与本地文件逐一算 SHA-256：

```
local_files: 50   remote_files: 50
identical: 50   hashDiff: 0   missingRemote: 0   fetchErr: 0   extra_remote_only: 0
```

即**线上 artifact 与本地通过全部测试的那棵树逐字节相同**；再叠加 `state=READY` 与生产别名已指向该部署，可判定上线产物正确。

## 已知限制

- 音频为程序化 Web Audio 合成，需要一次用户手势解锁；在自动播放策略下首次进入菜单静音属预期行为。
- 部署产物无法在本机侧主动 HTTP 抓取（出口白名单限制），线上页面的最终目视确认建议在普通浏览器中打开 <https://neon-snake-kappa.vercel.app> 完成。
