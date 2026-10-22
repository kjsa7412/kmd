// HTTP 서버 — 화면(app/) · 화면 자료(/api) · MCP(/mcp) 를 한 포트로.
//
// K0 에는 들어가기가 없다(E2). 그래서 바깥에서 오는 쓰기를 둘로 막는다 —
// 기본은 127.0.0.1 에만 열고, 쓰는 요청(POST)은 같은 화면(Origin)이나 Origin 없는 프로그램
// (Claude Code)만 받는다. 다른 사이트의 페이지가 이 PC 의 kmd 에 쓰지 못하게.

import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listKnowledge, loadKnowledge } from '../core/knowledge.js'
import { KmdError, httpStatusOf } from '../core/errors.js'
import { save } from '../core/save.js'
import { makeMcp } from './mcp.js'
import { VERSION } from './version.js'
import * as V from './views.js'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' }
const MAX_BODY = 2 << 20

// 지식 읽기 — 저장하면 그 지식만 잊는다(다음 요청이 다시 읽는다)
function makeStore(root) {
  const cache = new Map()
  let list = null
  const store = {
    async list() {
      return (list ||= await listKnowledge(root))
    },
    async get(id) {
      const meta = (await store.list()).find((k) => k.id === id)
      if (!meta) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      if (!cache.has(id)) cache.set(id, loadKnowledge(meta).catch((e) => { cache.delete(id); throw e }))
      return cache.get(id)
    },
    async all() {
      return Promise.all((await store.list()).map((k) => store.get(k.id)))
    },
    forget(id) {
      cache.delete(id)
      list = null
    },
  }
  return store
}

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

export async function startServer({ root, mode = 'team', user, host = '127.0.0.1', port = 7373 }) {
  const store = makeStore(root)
  const mcp = makeMcp(store)
  let origin = null

  const api = async (req, res, url) => {
    const p = url.pathname
    if (p === '/api/me') return send(res, 200, { mode, user, version: VERSION, host: req.headers.host })
    if (p === '/api/knowledge') return send(res, 200, (await store.all()).map((k) => ({ ...V.knowledgeRow(k), ...(mode === 'pc' ? { dir: k.dir } : {}) })))
    if (p === '/api/find') {
      const ids = url.searchParams.get('k')
      const ks = ids ? [await store.get(ids)] : await store.all()
      return send(res, 200, V.find(ks, url.searchParams.get('q')))
    }
    const m = p.match(/^\/api\/k\/([^/]+)\/(tree|doc|rec|att|save)$/)
    if (!m) throw new KmdError('E_NOTFOUND', '그런 길은 없다')
    const k = await store.get(decodeURIComponent(m[1]))
    if (m[2] === 'tree') return send(res, 200, V.tree(k))
    if (m[2] === 'att') {
      // 첨부 — 나무에 보인 그림만 그대로 보낸다
      const name = url.searchParams.get('a') || ''
      const rel = k.atts.find((a) => a.replace(/^(docs|work)\/assets\//i, '') === name)
      const type = rel && TYPES[path.extname(rel).toLowerCase()]
      if (!rel || !type || !type.startsWith('image/') || type === 'image/svg+xml') throw new KmdError('E_NOTFOUND', '그림 첨부만 화면에 보인다')
      return send(res, 200, await fs.readFile(path.join(k.dir, ...rel.split('/'))), type)
    }
    if (m[2] === 'doc') {
      const v = V.docView(k, url.searchParams.get('d'))
      if (!v) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      return send(res, 200, v)
    }
    if (m[2] === 'rec') {
      const v = V.recView(k, url.searchParams.get('r'))
      if (!v) throw new KmdError('E_NOTFOUND', '이 기록은 이제 없다')
      return send(res, 200, v)
    }
    if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
    const r = await save(k.dir, await readBody(req), { user })
    store.forget(k.id)
    return send(res, 200, r)
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
      // 쓰는 요청은 같은 화면이나 Origin 없는 프로그램만
      if (req.method === 'POST' && req.headers.origin && !sameOrigin(req)) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST 로 보낸다' })
        const body = await readBody(req)
        const ctx = { user }
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map((m) => mcp.call(m, ctx)))).filter(Boolean)
          return out.length ? send(res, 200, out) : (res.writeHead(202), res.end())
        }
        const out = await mcp.call(body, ctx)
        return out ? send(res, 200, out) : (res.writeHead(202), res.end())
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
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
  const a = server.address()
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  origin = `http://${shown.includes(':') ? `[${shown}]` : shown}:${a.port}`
  return {
    url: origin,
    port: a.port,
    store,
    close: () => new Promise((r) => server.close(() => r())),
  }
}
