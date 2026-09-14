/**
 * 极简静态服务器，仅用于本地自查与无头浏览器冒烟测试。
 * 不参与线上部署（Vercel 直接托管静态文件）。
 *
 * 用法：node tools/serve.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = Number(process.argv[2] || 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '')
    const filePath = join(ROOT, safe)
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const info = await stat(filePath)
    if (info.isDirectory()) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`neon-snake dev server → http://127.0.0.1:${PORT}/`)
})
