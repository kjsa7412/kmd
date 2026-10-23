// HTTP 서버 — 화면(app/) · 화면 자료(/api) · MCP(/mcp) · 들어가기 · 살아 있나(/healthz) 를 한 포트로.
//
// 누구인가 — 요청마다 한 번: Bearer 열쇠(기기 kmdk_ · 기계 kmdm_ · 예전 열쇠) 또는 서명 쿠키(화면).
// 들어오지 않은 요청이 받는 것은 화면 파일 · /healthz · /api/me · 들어가기 길뿐이다. 기계 열쇠는 그 지식의
// 기준선 길 하나만. 사람 관리(더하기 · 다시 정하기 · 풀기 · 기기 모두 끊기)는 관리자 + 재인증(15분).
// 쓰는 요청(POST)은 같은 화면(Origin)이나 Origin 없는 프로그램만 받는다.

import http from 'node:http'
import crypto from 'node:crypto'
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
import * as kit from '../core/kit.js'
import { watchedOf } from '../core/watchmark.js'
import { pcLogin, makeTeamLogin } from '../core/claudelogin.js'
import { getSecret } from '../core/secrets.js'

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

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > max) {
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
  const teamLogin = makeTeamLogin({ dataDir })
  // 이 PC — 프로그램 안에서 받은 Claude 로그인(비밀 claude-token)을 이 프로그램이 부르는 Claude 에만
  if (mode === 'pc') getSecret(dataDir, 'claude-token').then((t) => { if (t) process.env.CLAUDE_CODE_OAUTH_TOKEN = t }, () => {})

  // ── 팀 화면 ↔ 내 PC(E8 · v0.5 §5 · v0.6 ⑫) — PC 프로그램만 ──
  // 설치(kmd connect)가 적은 팀 주소(<data>/teams.json)의 화면이 물으면 Origin 을 대조해 12시간 짝 열쇠(kmdp_)를 응답으로
  // 준다(누름 없음 · 화면은 탭 메모리에만 · 여기는 해시만). 적히지 않은 주소는 이 PC 화면의 [허락] 한 번.
  // 짝 열쇠 · CORS 는 그 출처의 읽기 · save 길에만 — 가져오는 곳 · 넣기 권한 · 보내지 않음 끄기 · 백업 주소 · 설정 · 관리 · /mcp 는 403.
  const pairs = new Map()
  // 팀 화면이 부를 내 PC 프로그램 주소(serve.json pcUrl · 기본 이 PC 의 7373) — CSP connect-src 에 이 하나만
  const pcUrl = (() => { try { return new URL(hub.config.pcUrl || 'http://127.0.0.1:7373').origin } catch { return 'http://127.0.0.1:7373' } })()
  const PAIR_MS = 12 * 3600_000
  const teamsFile = path.join(dataDir, 'teams.json')
  const teamsOf = async () => (await fs.readFile(teamsFile, 'utf8').then(JSON.parse, () => [])).map((u) => { try { return new URL(u).origin } catch { return null } }).filter(Boolean)
  const CORS_OK = [/^GET \/api\/knowledge$/, /^GET \/api\/k\/[^/]+\/(tree|doc|rec|model|item)$/, /^POST \/api\/k\/[^/]+\/(save|edit)$/]
  const pairSha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
  const issuePair = (origin) => {
    const token = 'kmdp_' + crypto.randomBytes(24).toString('base64url')
    pairs.set(pairSha(token), { origin, exp: Date.now() + PAIR_MS })
    return { token, user: pcUser, exp: Date.now() + PAIR_MS }
  }
  // 다른 출처에서 온 요청 — 짝 지은 팀 화면이면 { ctx } · 아니면 throw · 같은 출처면 null
  async function crossOrigin(req, res, p) {
    const origin = req.headers.origin
    if (mode !== 'pc' || !origin || sameOrigin(req)) return null
    if (p === '/healthz') { res.setHeader('access-control-allow-origin', '*'); return { open: true } }
    const known = (await teamsOf()).includes(origin)
    if (!known) throw new KmdError('E_FORBIDDEN', '이 주소의 화면은 아직 허락하지 않았다 — 이 PC 화면에서 [허락]', { need: 'allow' })
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600' })
      res.end()
      return { done: true }
    }
    if (p === '/pair' && req.method === 'POST') return { pair: true, origin }
    if (!CORS_OK.some((re) => re.test(`${req.method} ${p}`))) throw new KmdError('E_FORBIDDEN', '팀 화면에서는 읽기 · 저장만 — 이 일은 이 PC 화면에서 한다')
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(kmdp_\S+)$/)
    const pr = m && pairs.get(pairSha(m[1]))
    if (!pr || pr.exp < Date.now() || pr.origin !== origin) throw new KmdError('E_AUTH', '짝 열쇠가 끝났다 — 화면을 다시 연다')
    return { ctx: { user: pcUser, admin: true, pc: true, pair: true } }
  }

  const ipOf = (req) => (hub.config.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress)

  // 누구인가 → { ctx, set } · 열쇠가 틀리면 E_AUTH(물러서지 않는다)
  function who(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)
    if (m) {
      // 초안 전용 단기 열쇠(kmdd_) — 그 일감 · 그 지식의 재료 · 초안 길만
      if (m[1].startsWith('kmdd_')) {
        const dctx = hub.draftCtx(m[1])
        if (!dctx) throw new KmdError('E_AUTH', '이 일감의 열쇠가 끝났다')
        return { ctx: dctx }
      }
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
    if (ctx.draft || ctx.worker) throw new KmdError('E_FORBIDDEN', '정리 일꾼은 초안만 올린다', { need: 'person' })
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
      // pcUrl — 내 PC 프로그램으로 이은 기기(설치 한 줄 · osuser 가 실린 것)가 있는 사람에게만 · 없으면 화면이 PC 를 묻지 않는다
      if (!ctx) return out(200, { mode, anon: true, setup: !auth.hasUsers(), legacy: auth.legacyWaiting(), version: VERSION, host: req.headers.host })
      return out(200, { mode, user: ctx.user, admin: !!ctx.admin, sudo: !!ctx.sudo, password: ctx.password !== false, version: VERSION, host: req.headers.host, ...(mode === 'pc' ? { root: path.resolve(root) } : auth.devices(ctx.user).some((d) => d.osuser) ? { pcUrl } : {}) })
    }
    // 기계 열쇠 — 그 지식의 기준선 길 하나만(E6 이 채운다)
    const bl = p.match(/^\/api\/k\/([^/]+)\/baseline$/)
    if (bl && ctx?.machine) {
      if (ctx.machine.kn !== decodeURIComponent(bl[1])) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!hub.baseline) throw new KmdError('E_NOTFOUND', '아직 없는 길이다')
      return out(200, await hub.baseline(ctx, decodeURIComponent(bl[1]), await readBody(req)))
    }
    // 정리 일꾼 — 일감 받기 · 상태 알리기(kmdw_) · 재료 · 초안(kmdd_)
    if (p === '/api/worker/next' || p === '/api/worker/status') {
      if (!ctx?.worker) throw new KmdError('E_FORBIDDEN', '정리 일꾼 열쇠로 부른다')
      if (p === '/api/worker/next') return out(200, hub.workerNext(ctx) || { job: null })
      return out(200, await hub.workerStatus(ctx, await readBody(req)))
    }
    const wk = p.match(/^\/api\/k\/([^/]+)\/worker\/(material|drafts)$/)
    if (wk) {
      if (!ctx?.draft) throw new KmdError('E_FORBIDDEN', '이 일감의 열쇠로 부른다')
      if (wk[2] === 'material') return out(200, await hub.material(ctx, decodeURIComponent(wk[1])))
      return out(200, await hub.drafts(ctx, decodeURIComponent(wk[1]), (await readBody(req)).drafts))
    }
    need(ctx)
    if (p === '/api/today') return out(200, await hub.today(ctx))
    if (p === '/api/history') return out(200, await hub.history(ctx))
    // 사람 목록 — 아이디만(정리하는 사람 고르기)
    if (p === '/api/people') return out(200, auth.users().filter((u) => u.kind === 'person').map((u) => u.id))
    const dm = p.match(/^\/api\/k\/([^/]+)\/diff$/)
    if (dm) return out(200, await hub.diff(ctx, decodeURIComponent(dm[1]), url.searchParams.get('record') || ''))
    const jm = p.match(/^\/api\/job\/([0-9a-f]+)$/)
    if (jm) return out(200, hub.job(jm[1]) || { state: 'gone' })
    // 자동으로 가져오는 곳 — 목록 · 더하기(관리자 · PC) · 살펴보기 · 지금 가져오기 · 관리자에게 부탁
    // 이력 — 보는 지식들의 kmd 가 한 일(가져옴 · 가져오는 곳 · 바로 고침 · 정리) 한 곳에 · 새 것 위
    if (p === '/api/logs') {
      const rows = []
      for (const m of await hub.visible(ctx)) rows.push(...V.logRows(await hub.get(m.id, ctx)))
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      return out(200, { items: rows.slice(0, 500) })
    }
    if (p === '/api/sources') return out(200, { items: await hub.allSources(ctx), can: hub.mode === 'pc' || !!ctx.admin })
    // ── 설정(S7) — 이 팀 서버 · 이 PC · 저절로 하는 일 · Claude 연결 · 에이전트 설치 ──
    if (p === '/api/settings') {
      const ks = await hub.visible(ctx)
      const bk = ks.map((k) => hub.backupStateSync(k)).filter(Boolean)
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const keys = mode === 'pc' ? ['save', 'file', 'src', 'claude', 'find'] : ['file', 'find']
      const month = new Date().toISOString().slice(0, 7)
      let tidied = 0
      for (const k of ks) tidied += (await hub.get(k.id)).logs.filter((w) => w.tags.includes('curate-llm') && String(w.date).startsWith(month)).length
      return out(200, {
        host: req.headers.host,
        root: mode === 'pc' ? path.resolve(root) : undefined,
        kns: ks.length,
        backup: { n: bk.length, of: ks.length, urls: [...new Set(bk.map((b) => b.url))].slice(0, 3), bad: bk.filter((b) => b.verdict && b.verdict !== 'ok').length },
        dests: mode === 'pc' ? (await Promise.all(ks.map(async (k) => ({ name: k.name, to: (await hub.sendQueue(ctx, k.id).catch(() => ({ dests: [] }))).dests.map((d) => d.kn) })))).filter((x) => x.to.length) : undefined,
        teams: mode === 'pc' ? await teamsOf() : undefined,
        auto: Object.fromEntries(keys.map((x) => [x, hub.autoOf(ctx.user, x)])),
        claude: { off: !!process.env.KMD_NO_CLAUDE && !process.env.KMD_CLAUDE, worker: ws, month: tidied, token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), team: mode === 'team' ? { token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), flow: teamLogin.state } : undefined },
        version: VERSION,
      })
    }
    if (p === '/api/settings/auto' && req.method === 'POST') { const b = await readBody(req); return out(200, await hub.setAuto(ctx, String(b.key), !!b.on)) }
    if (p === '/api/claude/login' && req.method === 'POST') {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀 정리 로그인은 관리 › Claude 연결에서')
      return out(200, pcLogin())
    }
    // 이 PC — 프로그램 안의 로그인 흐름(시작 → 주소 · 콘솔 글 → 받은 번호 → 열쇠는 비밀에만)
    const pl = p.match(/^\/api\/claude\/login\/(start|code|cancel)$/)
    if (pl && req.method === 'POST') {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀 정리 로그인은 관리 › Claude 연결에서')
      if (pl[1] === 'start') return out(200, await teamLogin.start())
      if (pl[1] === 'cancel') return out(200, { ok: !!teamLogin.cancel() || true })
      const r = await teamLogin.code((await readBody(req)).code)
      process.env.CLAUDE_CODE_OAUTH_TOKEN = r.token
      await fs.rm(path.join(dataDir, 'worker.json'), { force: true }).catch(() => {}) // 쉼 줄을 걷는다 — 다음에 다시 잰다
      return out(200, { ok: true })
    }
    // 에이전트 설치 — 이 PC 의 작업 폴더마다(스킬 · 연결 · CLAUDE.md 안 kmd 덩이)
    const ag = p.match(/^\/api\/agent(?:\/(add|up|rm))?$/)
    if (ag) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '에이전트 설치는 내 PC 프로그램이 한다 — 팀 화면은 설치 한 줄 복사')
      const list = await kit.folders(dataDir)
      if (!ag[1]) return out(200, { latest: await kit.kitVersion(), folders: await Promise.all(list.map(async (f) => ({ ...f, ...(await kit.status(f.path)) }))) })
      const b = await readBody(req)
      const urls = { pcUrl: `http://${req.headers.host}`, teamUrl: (await teamsOf())[0] || null }
      if (ag[1] === 'add') {
        const r = await kit.install(String(b.dir || ''), urls)
        if (list.some((f) => path.resolve(f.path).toLowerCase() === r.dir.toLowerCase())) return out(200, { ...r, again: true })
        await kit.setFolders(dataDir, [...list, { name: path.basename(r.dir), path: r.dir, at: new Date().toISOString() }])
        return out(200, r)
      }
      const pick = b.dir ? list.filter((f) => path.resolve(f.path).toLowerCase() === path.resolve(String(b.dir)).toLowerCase()) : list
      if (ag[1] === 'up') { for (const f of pick) await kit.install(f.path, urls); return out(200, { n: pick.length }) }
      for (const f of pick) await kit.remove(f.path)
      await kit.setFolders(dataDir, list.filter((f) => !pick.includes(f)))
      return out(200, { n: pick.length })
    }
    // 관리 — 문제 줄만 · 정리 전용 로그인 · 링크 한꺼번에
    if (p === '/api/admin/overview') {
      admin(ctx, { sudo: false })
      const users = auth.users()
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const ks = await hub.list()
      const checks = []
      for (const k of ks) { const c = await fs.readFile(path.join(dataDir, 'searchcheck', `${encodeURIComponent(k.id)}.json`), 'utf8').then(JSON.parse, () => null); if (c?.score) checks.push({ name: k.name, in: c.score.in, n: c.score.n, at: c.at }) }
      return out(200, {
        nopw: users.filter((u) => u.kind === 'person' && !u.password && !u.firstOpen).map((u) => u.id),
        waiting: users.filter((u) => u.kind === 'person' && u.firstOpen).map((u) => u.id),
        locked: auth.locked(),
        requests: await hub.requests(),
        worker: ws,
        people: users.filter((u) => u.kind === 'person').map((u) => u.id),
        kns: ks.length,
        sources: (await hub.allSources(ctx)).map((s) => ({ name: s.name, kn: s.knName, last: s.state?.checkedAt || null })),
        backups: ks.map((k) => ({ name: k.name, ...(hub.backupStateSync(k) || { off: true }) })),
        checks,
        claude: { token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), flow: teamLogin.state },
        https: req.headers['x-forwarded-proto'] === 'https',
      })
    }
    if (p === '/api/admin/links' && req.method === 'POST') {
      admin(ctx)
      const ids = (await readBody(req)).users
      const links = []
      for (const id of Array.isArray(ids) ? ids.slice(0, 100) : []) links.push({ id, link: `http://${req.headers.host}/first#code=${(await auth.reset(id, { by: ctx.user })).code}` })
      return out(200, { links })
    }
    const ac = p.match(/^\/api\/admin\/claude\/(start|code|cancel)$/)
    if (ac && req.method === 'POST') {
      admin(ctx)
      if (mode !== 'team') throw new KmdError('E_FORBIDDEN', '팀 서버에서만')
      if (ac[1] === 'start') return out(200, await teamLogin.start())
      if (ac[1] === 'cancel') return out(200, { ok: !!teamLogin.cancel() || true })
      const r = await teamLogin.code((await readBody(req)).code)
      await fs.rm(path.join(dataDir, 'worker.json'), { force: true }).catch(() => {}) // 쉼 줄을 걷는다 — 다음 일감에서 다시 잰다
      return out(200, { ok: r.ok })
    }
    // 되살리기 · 이 백업 이어 쓰기 — 관리자(비밀번호 한 번 더) · PC 는 그 PC 의 주인
    if (p === '/api/restore' && req.method === 'POST') {
      admin(ctx)
      return out(200, await hub.restore(ctx, await readBody(req)))
    }
    const ba = p.match(/^\/api\/k\/([^/]+)\/backup\/adopt$/)
    if (ba && req.method === 'POST') {
      admin(ctx)
      return out(200, await hub.backupAdopt(ctx, decodeURIComponent(ba[1])))
    }
    // 지식 추가 — 새 이름 · 내 폴더(PC)
    if (p === '/api/knowledge/add') {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      return out(200, await hub.addKnowledge(ctx, await readBody(req)))
    }
    const sm = p.match(/^\/api\/k\/([^/]+)\/sources(?:\/(probe|run|request|every|checkdb|resync|meaning))?$/)
    if (sm) {
      const id = decodeURIComponent(sm[1])
      if (req.method === 'GET' && !sm[2]) return out(200, await hub.sources(ctx, id))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req)
      if (sm[2] === 'every') return out(200, await hub.sourceEvery(ctx, id, b))
      if (sm[2] === 'checkdb') return out(200, await hub.sourceCheckDb(ctx, id, b))
      if (sm[2] === 'resync') return out(200, await hub.sourceResync(ctx, id, String(b.name || '')))
      if (sm[2] === 'meaning') return out(200, await hub.sourceMeaning(ctx, id, { name: String(b.name || ''), on: !!b.on }))
      if (sm[2] === 'probe') {
        if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 더한다')
        return out(200, await hub.sourceProbe(ctx, id, b))
      }
      if (sm[2] === 'request') return out(200, await hub.sourceRequest(ctx, id, b))
      if (sm[2] === 'run') {
        await hub.meta(id, ctx)
        if (b.force && !hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '[그대로 반영] 은 관리자가 한다')
        return out(200, await hub.sourceRun(id, b.name || null, { force: !!b.force }))
      }
      if (hub.mode === 'team') admin(ctx, { sudo: false })
      return out(200, await hub.sourceAdd(ctx, id, b))
    }
    if (p === '/api/requests') {
      admin(ctx, { sudo: false })
      return out(200, await hub.requests())
    }
    const tm = p.match(/^\/api\/k\/([^/]+)\/tidy$/)
    if (tm) {
      const id = decodeURIComponent(tm[1])
      if (req.method === 'POST') return out(200, await hub.tidyNow(ctx, id))
      await hub.meta(id, ctx)
      const k = await hub.get(id, ctx)
      const runs = (await hub.runs(id)).map((run) => ({ ...run, rows: run.rows.map((r) => ({ ...r, reverted: !!r.record && k.reverted.has(r.record) })) }))
      return out(200, { tidyAt: hub.tidyAtOf(id), jobs: hub.jobsOf(id), runs, pend: k.works.filter((w) => w.state === 'pend').length, nowhere: k.works.filter((w) => w.state === 'nowhere').length })
    }
    if (p === '/api/knowledge') {
      const ks = await hub.all(ctx)
      return out(200, await Promise.all(ks.map(async (k) => {
        // 보낼 곳이 있는 지식 — 보낼 것 수(옆 메뉴 「보내기」 의 수)
        const sq = hub.canDirect(ctx, k.id) ? await hub.sendQueue(ctx, k.id).catch(() => null) : null
        return { ...V.knowledgeRow(k), role: hub.roleIn(k.id, ctx), ...(mode === 'pc' ? { dir: k.dir } : {}), ...(sq?.dests.length ? { dests: sq.dests.map((d) => d.kn), sendN: sq.items.filter((x) => x.on).length, sendWait: sq.wait.length } : {}), private: !!hub.owner(k.id)?.private, tidyAt: hub.tidyAtOf(k.id) }
      })))
    }
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
      return out(200, { ticket: t, line: `irm ${origin}/i/${t} | iex`, sh: `curl -fsSL ${origin}/i/${t}.sh | sh`, kmd: `kmd connect ${origin} --ticket ${t}`, expires: 10 })
    }
    if (p === '/api/me/devices') return out(200, auth.devices(ctx.user))
    if (p === '/api/me/devices/revoke') return out(200, { revoked: await auth.revokeDevice(ctx.user, String((await readBody(req)).id || '')) })
    if (p === '/api/me/logout-all') {
      await auth.logoutAll(ctx.user)
      return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.logoutCookie() })
    }
    // ── 관리 — 사람 ──
    if (p === '/api/admin/users') {
      if (req.method === 'GET') return out(200, { users: admin(ctx, { sudo: false }) && auth.users(), locked: auth.locked() })
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

    // 파일 · 폴더 넣기 — { files: [{ path, b64 }] } · 한 번에 300 파일 · 200MB(글자로 바꾸면 커져 길 상한은 280MB)
    const im = p.match(/^\/api\/k\/([^/]+)\/import$/)
    if (im) {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req, 280 << 20)
      const files = (Array.isArray(b.files) ? b.files : []).map((f) => ({ path: String(f.path || f.name || ''), data: Buffer.from(String(f.b64 || ''), 'base64') }))
      return out(200, await hub.importFiles(ctx, decodeURIComponent(im[1]), files))
    }
    // 지식 지우기 — 보관하지 않고 완전히 · 확인은 지식 이름 · 팀 관리자는 비밀번호 한 번 더(개인 지식의 주인은 이름 확인만)
    const dl = p.match(/^\/api\/k\/([^/]+)\/delete$/)
    if (dl && req.method === 'POST') {
      const id = decodeURIComponent(dl[1])
      const b = await readBody(req)
      if (mode === 'team' && ctx?.admin && hub.owner(id)?.owner !== ctx.user) admin(ctx)
      return out(200, await hub.deleteKnowledge(ctx, id, b))
    }
    // 보내기 — 보낼 것 · 보낼 곳 · 이번에 빼기 · 보내기 · 받기 · 받은편지함 정리
    const sd = p.match(/^\/api\/k\/([^/]+)\/(send|send\/dests|send\/drop|receive|inbox\/tidy|inbox\/send)$/)
    if (sd) {
      const id = decodeURIComponent(sd[1])
      if (sd[2] === 'send' && req.method === 'GET') return out(200, await hub.sendQueue(ctx, id))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req, sd[2] === 'receive' ? 8 << 20 : MAX_BODY)
      if (sd[2] === 'send') return out(200, await hub.send(ctx, id, b))
      if (sd[2] === 'send/dests') return out(200, await hub.sendDests(ctx, id, b.dests))
      if (sd[2] === 'send/drop') return out(200, await hub.sendDrop(ctx, id, b))
      if (sd[2] === 'receive') return out(200, await hub.receive(ctx, id, b))
      if (sd[2] === 'inbox/send') return out(200, await hub.inboxSend(ctx, id, b))
      return out(200, await hub.inboxTidy(ctx, id, { dry: !!b.dry }))
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
      const v = V.itemView(k, url.searchParams.get('key') || '', { src: await hub.sourceState(k.id) })
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
      const v = V.docView(k, url.searchParams.get('d'), { src: await hub.sourceState(k.id) })
      if (!v) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      // 원본이 주인인 문서 — 어디서 왔나 · 고치기 없음
      const dd = k.docs.find((x) => x.id === url.searchParams.get('d'))
      const watched = dd ? watchedOf(await fs.readFile(path.join(k.dir, ...dd.path.split('/')), 'utf8').catch(() => '')) : null
      return out(200, { ...v, watched, direct: hub.canDirect(ctx, k.id) && !watched })
    }
    const v = V.recView(k, url.searchParams.get('r'))
    if (!v) throw new KmdError('E_NOTFOUND', '이 기록은 이제 없다')
    return out(200, v)
  }

  const staticFile = async (res, p) => {
    // 화면 길(/first · /setup)은 같은 화면 한 장이 연다
    const rel = p === '/' || p === '/first' || p === '/setup' || (p === '/pair' && mode === 'pc') ? 'index.html' : p.slice(1)
    const full = path.join(APP, ...rel.split('/'))
    if (!full.startsWith(APP + path.sep) || rel.split('/').includes('..')) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    const buf = await fs.readFile(full).catch(() => null)
    if (!buf) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    send(res, 200, buf, TYPES[path.extname(full)] || 'application/octet-stream', rel === 'index.html' ? { 'content-security-policy': `default-src 'self'; connect-src 'self'${mode === 'team' ? ' ' + pcUrl : ''}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` } : {})
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      const xo = await crossOrigin(req, res, p)
      if (xo?.done) return
      if (xo?.pair) return send(res, 200, issuePair(xo.origin))
      if (xo?.ctx) {
        if (p.startsWith('/api/')) return await api(req, res, url, xo.ctx, null)
        throw new KmdError('E_FORBIDDEN', '팀 화면에서는 읽기 · 저장만')
      }
      if (req.method === 'POST' && req.headers.origin && !sameOrigin(req) && !xo?.open) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      // 이 PC 화면의 [허락] — 적히지 않은 팀 주소를 teams.json 에 더하고 짝 열쇠를 준다(그 창이 opener 에게 넘긴다)
      if (p === '/api/pair/allow' && mode === 'pc' && req.method === 'POST') {
        const { ctx: me } = who(req)
        need(me)
        let origin
        try { origin = new URL(String((await readBody(req)).origin || '')).origin } catch { throw new KmdError('E_INPUT', '팀 주소가 아니다') }
        if (!/^https?:$/.test(new URL(origin).protocol)) throw new KmdError('E_INPUT', '팀 주소가 아니다')
        const teams = await fs.readFile(teamsFile, 'utf8').then(JSON.parse, () => [])
        if (!teams.includes(origin)) await fs.writeFile(teamsFile, JSON.stringify([...teams, origin], null, 1))
        return send(res, 200, issuePair(origin))
      }
      if (p === '/healthz') {
        const lines = await hub.stops({ user: null, admin: true })
        return send(res, 200, { ok: true, version: VERSION, mode, stops: lines.map((l) => ({ level: l.level, text: l.text })) })
      }
      // 설치 한 줄이 받는 작은 스크립트 — `irm <팀>/i/<표> | iex`(PowerShell) · `curl -fsSL <팀>/i/<표>.sh | sh`. 표는 여기서 쓰지 않는다(설치가 /device/keys 로 한 번)
      const im = mode === 'team' && req.method === 'GET' && p.match(/^\/i\/(kmdt_[A-Za-z0-9_-]{10,80})(\.sh)?$/)
      if (im) {
        const origin = `http://${req.headers.host}`
        const ps = `$ErrorActionPreference = 'Stop'\r\nif (Get-Command kmd -ErrorAction SilentlyContinue) { kmd connect '${origin}' --ticket '${im[1]}' }\r\nelse { Write-Host 'kmd 가 이 PC 에 없다 — 먼저 깐다: ${origin}/dl' }\r\n`
        const sh = `#!/bin/sh\nif command -v kmd >/dev/null 2>&1; then kmd connect '${origin}' --ticket '${im[1]}'; else echo 'kmd 가 이 PC 에 없다 — 먼저 깐다: ${origin}/dl'; fi\n`
        return send(res, 200, im[2] ? sh : ps, 'text/plain; charset=utf-8')
      }
      // 꾸러미 받기 — 관리자가 둔 PC 꾸러미(serve.json dl · 기본 <살림 자리>/dl). 비밀이 아니라 들어오지 않아도 받는다
      if (mode === 'team' && req.method === 'GET' && (p === '/dl' || p.startsWith('/dl/'))) {
        const dl = path.resolve(hub.config.dl || path.join(dataDir, 'dl'))
        const files = (await fs.readdir(dl).catch(() => [])).filter((n) => /\.(zip|tgz|exe|msi)$/i.test(n))
        if (p === '/dl') return send(res, 200, `<!doctype html><meta charset="utf-8"><title>kmd 받기</title><body style="font:15px system-ui;margin:40px"><h1>kmd 받기</h1>${files.length ? `<ul>${files.map((n) => `<li><a href="/dl/${encodeURIComponent(n)}">${n.replace(/[<>&"]/g, '')}</a></li>`).join('')}</ul><p>PC 꾸러미를 풀어 PATH 에 더한 뒤, 팀 화면 › 설치 한 줄을 다시 붙여 넣는다.</p>` : '<p>아직 꾸러미가 없다 — 관리자에게 묻는다.</p>'}</body>`, 'text/html; charset=utf-8')
        const n = decodeURIComponent(p.slice(4))
        if (!files.includes(n)) return send(res, 404, '없다', 'text/plain; charset=utf-8')
        return send(res, 200, await fs.readFile(path.join(dl, n)), 'application/octet-stream', { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(n)}` })
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
