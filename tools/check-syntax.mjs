/**
 * 全量静态检查，两层：
 *
 *  1. 语法层 —— 对 src、tests、tools 下所有 ESM 文件执行 `node --check`。
 *     单元测试只覆盖纯逻辑模块，渲染层/DOM 层的语法错误必须靠这一步拦截。
 *
 *  2. 链接层 —— 逐个解析 `import { a, b as c } from './x.js'`，核对目标模块是否
 *     真的导出了这些名字。`node --check` 查不出"少写了一个 export"，
 *     而这类错误在浏览器里会直接让整个模块图求值失败（白屏），
 *     单测也测不到（单测不 import 渲染层）。因此这里必须静态拦截。
 *
 * 用法：node tools/check-syntax.mjs
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIRS = ['src', 'tests', 'tools']
const EXTS = new Set(['.js', '.mjs'])

async function collect(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await collect(full)))
    else if (EXTS.has(extname(e.name))) out.push(full)
  }
  return out
}

/** 去掉块注释与整行行注释，避免把文档示例里的 import 误判为真实导入。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** 抓出一个模块所有具名导出的名字。 */
function exportedNames(source) {
  const names = new Set()
  const patterns = [
    /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
    /export\s*\{([^}]*)\}/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(source))) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim()
        if (name) names.add(name)
      }
    }
  }
  return names
}

/** 抓出 `import { a, b as c } from '...'` 里的 (名字, 源路径) 列表。 */
function namedImports(source) {
  const out = []
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(source))) {
    const spec = m[2]
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name) out.push({ name, spec })
    }
  }
  return out
}

const files = []
for (const d of DIRS) files.push(...(await collect(join(ROOT, d))))

const failures = []

// ---- 1. 语法 ----
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (r.status !== 0) {
    failures.push({
      stage: 'syntax',
      file: file.slice(ROOT.length + 1),
      error: (r.stderr || '').trim().split('\n').slice(0, 3).join(' | '),
    })
  }
}

// ---- 2. 具名导入/导出链接 ----
const sourceCache = new Map()
async function sourceOf(file) {
  if (!sourceCache.has(file)) {
    sourceCache.set(file, stripComments(await readFile(file, 'utf8')))
  }
  return sourceCache.get(file)
}

let linked = 0
for (const file of files) {
  const src = await sourceOf(file)
  for (const { name, spec } of namedImports(src)) {
    if (!spec.startsWith('.')) continue // 裸模块（node: 内置）跳过
    const target = resolve(dirname(file), spec)
    try {
      const targetSrc = await sourceOf(target)
      const names = exportedNames(targetSrc)
      linked++
      if (!names.has(name)) {
        failures.push({
          stage: 'link',
          file: file.slice(ROOT.length + 1),
          error: `模块 ${spec} 没有导出 '${name}'（会导致整个模块图求值失败、页面白屏）`,
        })
      }
    } catch {
      failures.push({
        stage: 'link',
        file: file.slice(ROOT.length + 1),
        error: `无法解析导入路径 '${spec}'`,
      })
    }
  }
}

const report = { checked: files.length, linkedImports: linked, failures }
console.log(JSON.stringify(report, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
