// HTTP 서버 — 화면(app/) · 화면 자료(/api) · MCP(/mcp) · 들어가기 · 살아 있나(/healthz) 를 한 포트로.
//
// 누구인가 — 요청마다 한 번: Bearer 열쇠(기기 kmdk_ · 기계 kmdm_ · 예전 열쇠) 또는 서명 쿠키(화면).
// 들어오지 않은 요청이 받는 것은 화면 파일 · /healthz · /api/me · 들어가기 길뿐이다. 기계 열쇠는 그 지식의
// 기준선 길 하나만. 사람 관리(더하기 · 다시 정하기 · 풀기 · 기기 모두 끊기)는 관리자 + 재인증(15분).
// 쓰는 요청(POST)은 같은 화면(Origin)이나 Origin 없는 프로그램만 받는다.

import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KmdError, httpStatusOf } from '../core/errors.js'
import { makeAuth } from '../core/auth.js'
import { makeMcp } from './mcp.js'
import { makeHub, defaultDataDir } from './hub.js'
import { VERSION } from './version.js'
import * as V from './views.js'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' }
const MAX_BODY = 2 << 20

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra })
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

export async function startServer({ root, data = null, mode = 'team', user = os.userInfo().username, host = '127.0.0.1', port = 7373, log, scryptN = null }) {
  const dataDir = data || defaultDataDir(root)
  const pcUser = mode === 'pc' ? String(user).toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'me' : null
  const hub = await makeHub({ root, dataDir, mode, pcUser, log })
  const auth = await makeAuth({ dataDir, mode, scryptN: scryptN || hub.config.scryptN || null })
  const mcp = makeMcp(hub)
  if (pcUser) await auth.ensurePc(pcUser)

  const ipOf = (req) => (hub.config.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress)

  // 누구인가 → { ctx, set } · 열쇠가 틀리면 E_AUTH(물러서지 않는다)
  function who(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)
    if (m) {
      const ctx = auth.bearer(m[1])
      if (!ctx) throw new KmdError('E_AUTH', '열쇠가 맞지 않는다 — 끊겼거나 90일 동안 쓰지 않았다. 팀 화면 › 설치 한 줄을 다시 붙여 넣는다')
      return { ctx }
    }
    const s = auth.session(req.headers.cookie)
    return s || { ctx: null }
  }
  const need = (ctx) => {
    if (!ctx) throw new KmdError('E_AUTH', '들어온 뒤 쓴다')
    if (ctx.machine) throw new KmdError('E_FORBIDDEN', '기계 열쇠는 기준선 길만 쓴다', { need: 'person' })
    return ctx
  }
  const admin = (ctx, { sudo = true } = {}) => {
    need(ctx)
    if (!ctx.admin) throw new KmdError('E_FORBIDDEN', '관리자만 한다')
    if (sudo && !ctx.sudo && !ctx.pc) throw new KmdError('E_SUDO', '비밀번호를 한 번 더 넣는다(15분)')
    return ctx
  }

  // ── 들어가기 길 — 들어오지 않아도 받는다 ──
  const gate = async (req, res, p) => {
    const ip = ipOf(req)
    const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((x) => x.trim().split('=')).filter((x) => x[0]))
    const b = await readBody(req)
    if (p === '/login') {
      if (b.token) return send(res, 200, await auth.loginLegacy({ token: b.token, ip }))
      const r = await auth.login({ user: b.user, pw: b.pw, ip, cookies })
      return send(res, 200, { user: r.user, notice: r.notice }, undefined, { 'set-cookie': r.cookies })
    }
    if (p === '/logout') return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.logoutCookie() })
    if (p === '/first') {
      if (b.check) return send(res, 200, { user: auth.firstUser(b.code) })
      const r = await auth.first({ code: b.code, pw: b.pw })
      return send(res, 200, { user: r.user }, undefined, { 'set-cookie': r.cookies })
    }
    if (p === '/setup') {
      const r = await auth.setup({ code: b.code, name: b.name, pw: b.pw })
      return send(res, 200, { user: r.user }, undefined, { 'set-cookie': r.cookie })
    }
    if (p === '/once') return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.takeOnce(b.code) })
    if (p === '/device/keys') {
      const r = await auth.deviceKey({ ticket: b.ticket, user: b.user, pw: b.pw, host: b.host, osuser: b.osuser, ip })
      hub.notifyDevice?.(r.user, r.device)
      return send(res, 200, { key: r.key, user: r.user })
    }
    throw new KmdError('E_NOTFOUND', '그런 길은 없다')
  }

  const api = async (req, res, url, ctx, set) => {
    const p = url.pathname
    const out = (status, body) => send(res, status, body, undefined, set ? { 'set-cookie': set } : {})
    if (p === '/api/me') {
      if (!ctx) return out(200, { mode, anon: true, setup: !auth.hasUsers(), legacy: auth.legacyWaiting(), version: VERSION, host: req.headers.host })
      return out(200, { mode, user: ctx.user, admin: !!ctx.admin, sudo: !!ctx.sudo, password: ctx.password !== false, version: VERSION, host: req.headers.host })
    }
    // 기계 열쇠 — 그 지식의 기준선 길 하나만(E6 이 채운다)
    const bl = p.match(/^\/api\/k\/([^/]+)\/baseline$/)
    if (bl && ctx?.machine) {
      if (ctx.machine.kn !== decodeURIComponent(bl[1])) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!hub.baseline) throw new KmdError('E_NOTFOUND', '아직 없는 길이다')
      return out(200, await hub.baseline(ctx, decodeURIComponent(bl[1]), await readBody(req)))
    }
    need(ctx)
    if (p === '/api/knowledge') return out(200, (await hub.all(ctx)).map((k) => ({ ...V.knowledgeRow(k), role: hub.roleIn(k.id, ctx), ...(mode === 'pc' ? { dir: k.dir } : {}) })))
    if (p === '/api/stops') return out(200, await hub.stops(ctx))
    if (p === '/api/find') {
      const rs = await hub.search(ctx, url.searchParams.get('k') || null, { q: url.searchParams.get('q') || '' })
      return out(200, V.findView(await Promise.all(rs.map(async (r) => ({ k: await hub.get(r.knowledge), r })))))
    }
    // ── 나 — 재인증 · 설치 표 · 내 기기 · 모든 기기에서 나가기 ──
    if (p === '/api/sudo') return send(res, 200, { ok: true }, undefined, { 'set-cookie': await auth.sudo(ctx, { pw: (await readBody(req)).pw, ip: ipOf(req), cookieHeader: req.headers.cookie }) })
    if (p === '/api/device/ticket') {
      if (ctx.device || ctx.legacy) throw new KmdError('E_FORBIDDEN', '열쇠로는 다른 열쇠를 만들지 못한다')
      const t = auth.ticket(ctx, { ip: ipOf(req) })
      const origin = `http://${req.headers.host}`
      return out(200, { ticket: t, line: `kmd connect ${origin} --ticket ${t}`, expires: 10 })
    }
    if (p === '/api/me/devices') return out(200, auth.devices(ctx.user))
    if (p === '/api/me/devices/revoke') return out(200, { revoked: await auth.revokeDevice(ctx.user, String((await readBody(req)).id || '')) })
    if (p === '/api/me/logout-all') {
      await auth.logoutAll(ctx.user)
      return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.logoutCookie() })
    }
    // ── 관리 — 사람 ──
    if (p === '/api/admin/users') {
      if (req.method === 'GET') return out(200, { users: auth.users(), locked: auth.locked() })
      admin(ctx)
      const b = await readBody(req)
      const r = await auth.addUser({ id: b.id, admin: b.admin })
      return out(200, { id: r.id, link: `http://${req.headers.host}/first#code=${r.code}` })
    }
    const am = p.match(/^\/api\/admin\/users\/([^/]+)\/(reset|unlock|revoke-all|logout-all|admin)$/)
    if (am) {
      admin(ctx)
      const id = decodeURIComponent(am[1])
      if (am[2] === 'reset') {
        const r = await auth.reset(id, { by: ctx.user })
        return out(200, { id, link: `http://${req.headers.host}/first#code=${r.code}` })
      }
      if (am[2] === 'unlock') return out(200, { ok: auth.unlock(id) ?? true })
      if (am[2] === 'revoke-all') return out(200, { revoked: await auth.revokeDevice(id, '*') })
      if (am[2] === 'logout-all') return out(200, { ok: await auth.logoutAll(id) ?? true })
      return out(200, { ok: (await auth.setAdmin(id, !!(await readBody(req)).admin)) ?? true })
    }

    const m = p.match(/^\/api\/k\/([^/]+)\/(tree|doc|rec|att|model|item|save|backup|backup\/pull|owner|learn|edit|revert)$/)
    if (!m) throw new KmdError('E_NOTFOUND', '그런 길은 없다')
    const id = decodeURIComponent(m[1])
    const what = m[2]
    if (['save', 'backup', 'backup/pull', 'owner', 'learn', 'edit', 'revert'].includes(what)) {
      if (what === 'backup' && req.method === 'GET') return out(200, (await hub.backupState(ctx, id)) || { off: true })
      if (what === 'owner' && req.method === 'GET') return out(200, hub.owner(id) || {})
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const body = await readBody(req)
      if (what === 'save') return out(200, await hub.save(ctx, id, body))
      if (what === 'learn') return out(200, await hub.learn(ctx, id, body))
      if (what === 'edit') return out(200, await hub.edit(ctx, id, body))
      if (what === 'revert') return out(200, await hub.revert(ctx, id, body))
      if (what === 'owner') return out(200, await hub.setOwner(ctx, id, body))
      admin(ctx)
      if (what === 'backup') return out(200, await hub.backupAttach(ctx, id, String(body.url || '')))
      return out(200, await hub.backupPull(ctx, id))
    }
    const k = await hub.get(id, ctx)
    if (what === 'tree') return out(200, V.tree(k))
    if (what === 'model') return out(200, V.model(k))
    if (what === 'item') {
      const v = V.itemView(k, url.searchParams.get('key') || '')
      if (!v) throw new KmdError('E_NOTFOUND', '이 항목은 이제 없다')
      return out(200, v)
    }
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
      return out(200, { ...v, direct: hub.canDirect(ctx, k.id) })
    }
    const v = V.recView(k, url.searchParams.get('r'))
    if (!v) throw new KmdError('E_NOTFOUND', '이 기록은 이제 없다')
    return out(200, v)
  }

  const staticFile = async (res, p) => {
    // 화면 길(/first · /setup)은 같은 화면 한 장이 연다
    const rel = p === '/' || p === '/first' || p === '/setup' ? 'index.html' : p.slice(1)
    const full = path.join(APP, ...rel.split('/'))
    if (!full.startsWith(APP + path.sep) || rel.split('/').includes('..')) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    const buf = await fs.readFile(full).catch(() => null)
    if (!buf) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    send(res, 200, buf, TYPES[path.extname(full)] || 'application/octet-stream', rel === 'index.html' ? { 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" } : {})
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      if (req.method === 'POST' && req.headers.origin && !sameOrigin(req)) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      if (p === '/healthz') {
        const lines = await hub.stops({ user: null, admin: true })
        return send(res, 200, { ok: true, version: VERSION, mode, stops: lines.map((l) => ({ level: l.level, text: l.text })) })
      }
      if (req.method === 'POST' && ['/login', '/logout', '/first', '/setup', '/once', '/device/keys'].includes(p)) return await gate(req, res, p)
      const { ctx, set } = who(req)
      if (p === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST 로 보낸다' })
        need(ctx)
        const body = await readBody(req)
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map((m) => mcp.call(m, ctx)))).filter(Boolean)
          return out.length ? send(res, 200, out) : (res.writeHead(202), res.end())
        }
        const out = await mcp.call(body, ctx)
        return out ? send(res, 200, out) : (res.writeHead(202), res.end())
      }
      if (p.startsWith('/api/')) return await api(req, res, url, ctx, set)
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '읽기만', 'text/plain; charset=utf-8')
      return await staticFile(res, p)
    } catch (e) {
      if (!(e instanceof KmdError)) console.error('[kmd]', e)
      const status = e instanceof KmdError ? httpStatusOf(e.code) : 500
      send(res, status, { error: e.code || 'E_INTERNAL', message: e instanceof KmdError ? e.message : '서버 안에서 넘어졌다', ...(e.need ? { need: e.need } : {}) }, undefined, status === 401 && req.url.startsWith('/mcp') ? { 'www-authenticate': 'Bearer' } : {})
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
    auth,
    store: hub,
    pcUser,
    close: () =>
      new Promise((r) => {
        hub.stop()
        server.close(() => r())
        server.closeAllConnections?.()
      }),
  }
}
