// HTTP 서버 — 화면(app/) · 화면 자료(/api) · MCP(/mcp) · 살아 있나(/healthz) 를 한 포트로.
//
// 들어가기가 생기기 전(E2)에는 바깥 쓰기를 둘로 막는다 — 기본은 127.0.0.1 에만 열고, 쓰는 요청(POST)은
// 같은 화면(Origin)이나 Origin 없는 프로그램(Claude Code)만 받는다.

import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KmdError, httpStatusOf } from '../core/errors.js'
import { makeMcp } from './mcp.js'
import { makeHub, defaultDataDir } from './hub.js'
import { VERSION } from './version.js'
import * as V from './views.js'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' }
const MAX_BODY = 2 << 20

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(buf)
}

function sameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > MAX_BODY) {
        reject(new KmdError('E_INPUT', '보낸 글이 너무 크다'))
        req.destroy()
      } else parts.push(c)
    })
    req.on('end', () => {
      try {
        resolve(n ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {})
      } catch {
        reject(new KmdError('E_INPUT', 'JSON 모양이 아니다'))
      }
    })
    req.on('error', reject)
  })
}

export async function startServer({ root, data = null, mode = 'team', user, host = '127.0.0.1', port = 7373, log }) {
  const hub = await makeHub({ root, dataDir: data || defaultDataDir(root), mode, log })
  const mcp = makeMcp(hub)

  const api = async (req, res, url, ctx) => {
    const p = url.pathname
    if (p === '/api/me') return send(res, 200, { mode, user: ctx.user, version: VERSION, host: req.headers.host })
    if (p === '/api/knowledge') return send(res, 200, (await hub.all()).map((k) => ({ ...V.knowledgeRow(k), ...(mode === 'pc' ? { dir: k.dir } : {}) })))
    if (p === '/api/stops') return send(res, 200, await hub.stops())
    if (p === '/api/find') {
      const id = url.searchParams.get('k')
      const ks = id ? [await hub.get(id)] : await hub.all()
      return send(res, 200, V.find(ks, url.searchParams.get('q')))
    }
    const m = p.match(/^\/api\/k\/([^/]+)\/(tree|doc|rec|att|save|backup|backup\/pull)$/)
    if (!m) throw new KmdError('E_NOTFOUND', '그런 길은 없다')
    const id = decodeURIComponent(m[1])
    const what = m[2]
    if (what === 'save' || what.startsWith('backup')) {
      if (what === 'backup' && req.method === 'GET') return send(res, 200, (await hub.backupState(id)) || { off: true })
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const body = await readBody(req)
      if (what === 'save') return send(res, 200, await hub.save(ctx, id, body))
      if (what === 'backup') return send(res, 200, await hub.backupAttach(id, String(body.url || '')))
      return send(res, 200, await hub.backupPull(id))
    }
    const k = await hub.get(id)
    if (what === 'tree') return send(res, 200, V.tree(k))
    if (what === 'att') {
      // 첨부 — 나무에 보인 그림만 그대로 보낸다
      const name = url.searchParams.get('a') || ''
      const rel = k.atts.find((a) => a.replace(/^(docs|work)\/assets\//i, '') === name)
      const type = rel && TYPES[path.extname(rel).toLowerCase()]
      if (!rel || !type || !type.startsWith('image/') || type === 'image/svg+xml') throw new KmdError('E_NOTFOUND', '그림 첨부만 화면에 보인다')
      return send(res, 200, await fs.readFile(path.join(k.dir, ...rel.split('/'))), type)
    }
    if (what === 'doc') {
      const v = V.docView(k, url.searchParams.get('d'))
      if (!v) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      return send(res, 200, v)
    }
    const v = V.recView(k, url.searchParams.get('r'))
    if (!v) throw new KmdError('E_NOTFOUND', '이 기록은 이제 없다')
    return send(res, 200, v)
  }

  const staticFile = async (res, p) => {
    const rel = p === '/' ? 'index.html' : p.slice(1)
    const full = path.join(APP, ...rel.split('/'))
    if (!full.startsWith(APP + path.sep) || rel.split('/').includes('..')) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    const buf = await fs.readFile(full).catch(() => null)
    if (!buf) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    send(res, 200, buf, TYPES[path.extname(full)] || 'application/octet-stream')
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      if (req.method === 'POST' && req.headers.origin && !sameOrigin(req)) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      const ctx = { user }
      if (url.pathname === '/healthz') {
        const lines = await hub.stops()
        return send(res, 200, { ok: true, version: VERSION, mode, stops: lines.map((l) => ({ level: l.level, text: l.text })) })
      }
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST 로 보낸다' })
        const body = await readBody(req)
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map((m) => mcp.call(m, ctx)))).filter(Boolean)
          return out.length ? send(res, 200, out) : (res.writeHead(202), res.end())
        }
        const out = await mcp.call(body, ctx)
        return out ? send(res, 200, out) : (res.writeHead(202), res.end())
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, ctx)
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '읽기만', 'text/plain; charset=utf-8')
      return await staticFile(res, url.pathname)
    } catch (e) {
      if (!(e instanceof KmdError)) console.error('[kmd]', e)
      send(res, e instanceof KmdError ? httpStatusOf(e.code) : 500, { error: e.code || 'E_INTERNAL', message: e instanceof KmdError ? e.message : '서버 안에서 넘어졌다' })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  await hub.start()
  const a = server.address()
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  const origin = `http://${shown.includes(':') ? `[${shown}]` : shown}:${a.port}`
  return {
    url: origin,
    port: a.port,
    hub,
    store: hub,
    close: () => new Promise((r) => {
      hub.stop()
      server.close(() => r())
      server.closeAllConnections?.()
    }),
  }
}
