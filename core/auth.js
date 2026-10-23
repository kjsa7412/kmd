// 명부 · 들어가기 · 세션 · 열쇠 — 팀 서버의 「누구인가」 한 곳.
//
//   <data>/auth.json  { v: 1, users: { <아이디>: 사람 줄 | 기계 줄 }, setup }
//     사람 줄   { kind: 'person', admin, pw, sv, first, keys: [{ id, sha, host, osuser, at }], legacy: [sha], pwSetBy }
//     기계 줄   { kind: 'machine', machine: { kn, source, types, exp }, keys: [{ id, sha, at }] }
//   <data>/session.key   쿠키 서명 열쇠(32바이트 · 처음 시작 때)
//   <data>/keys-used.json 열쇠의 마지막 사용(하루 한 번 적는다) — 90일 안 쓴 기기 열쇠는 끊긴다
//
// 권한은 사람에게, 자격은 신원만 — 열쇠 · 쿠키는 「누구인가」 만 말하고, 무엇을 보나는 주인 장부(owners)가 정한다.
// 들어가기 실패의 답은 하나다(없는 아이디 · 틀린 비밀번호 · 잠김이 같은 글 · 같은 상태).

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { KmdError } from './errors.js'
import { isReservedUser } from './names.js'
import * as pw from './passwd.js'

export const FAIL = '아이디나 비밀번호를 확인하세요 — 여러 번 틀리면 잠시 막힌다'
const H = 3600_000
const IDLE_MS = 12 * H
const MAX_MS = 7 * 24 * H
const PC_MS = 30 * 24 * H
const SUDO_MS = 15 * 60_000
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const unb64 = (s) => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

async function readJson(f, fallback) {
  const t = await fs.readFile(f, 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
  if (t == null) return fallback
  try {
    return JSON.parse(t)
  } catch (e) {
    throw new Error(`${path.basename(f)} 이 깨졌다 — ${e.message}`)
  }
}
async function writeJson(f, v, mode = 0o600) {
  await fs.mkdir(path.dirname(f), { recursive: true })
  await fs.writeFile(f + '.tmp', JSON.stringify(v, null, 1) + '\n', { mode })
  await fs.rename(f + '.tmp', f)
}

const localHm = (iso) => {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function parseCookies(h) {
  const out = {}
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export async function makeAuth({ dataDir, mode = 'team', scryptN = null, now = () => Date.now() }) {
  const file = path.join(dataDir, 'auth.json')
  const db = await readJson(file, { v: 1, users: {}, setup: null })
  if (!db || typeof db !== 'object' || typeof db.users !== 'object') throw new Error('auth.json 의 모양이 아니다')
  for (const id of Object.keys(db.users)) if (isReservedUser(id)) throw new Error(`명부에 kmd 가 쓰는 이름이 있다 — ${id} · 이름을 바꾼 뒤 다시 띄운다`)
  const keyFile = path.join(dataDir, 'session.key')
  let secret = await fs.readFile(keyFile).catch(() => null)
  if (!secret) {
    secret = crypto.randomBytes(32)
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(keyFile, secret, { mode: 0o600 })
  }
  const usedFile = path.join(dataDir, 'keys-used.json')
  const used = await readJson(usedFile, {})
  const N = await pw.scryptN(dataDir, { override: scryptN })
  const locks = pw.makeLocks({ now })
  const tickets = new Map() // 설치 표 — 메모리 · 10분 · 한 번
  const onces = new Map() // PC 화면 한 번용 번호 — 60초
  const log = [] // auth.log 에 적는다
  const logFile = path.join(dataDir, 'auth.log')

  // 셸의 kmd user · machine 이 명부를 바꾸면 도는 서버가 다음 요청에서 다시 읽는다
  let seenMtime = (() => { try { return statSync(file).mtimeMs } catch { return 0 } })()
  const reload = () => {
    let m = 0
    try { m = statSync(file).mtimeMs } catch { return }
    if (m === seenMtime) return
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      if (j && typeof j.users === 'object') { db.users = j.users; db.setup = j.setup ?? null }
    } catch {}
    seenMtime = m
  }
  const persist = async () => {
    await writeJson(file, db)
    try { seenMtime = statSync(file).mtimeMs } catch {}
  }
  // 일마다 번호(seq)를 붙여 적고 명부에도 그 번호를 남긴다 — 옛 명부로 되살린 뒤 그보다 큰 번호의 일만 다시 적용한다(reapply)
  const note = async (what) => {
    db.seq = (db.seq || 0) + 1
    const line = JSON.stringify({ at: new Date(now()).toISOString(), seq: db.seq, ...what })
    log.push(line)
    await fs.appendFile(logFile, line + '\n', { mode: 0o600 }).catch(() => {})
    await persist()
  }
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  const seal = (o) => {
    const p = b64(o)
    return `${p}.${sign(p)}`
  }
  const open = (v) => {
    const [p, s] = String(v || '').split('.')
    if (!p || !s) return null
    const want = Buffer.from(sign(p))
    const got = Buffer.from(s)
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
    return unb64(p)
  }
  const userOf = (id) => {
    const u = db.users[String(id || '').toLowerCase()]
    return u && (u.kind || 'person') === 'person' ? u : null
  }
  const markName = (id) => 'kmd_m_' + pw.sha(String(id).toLowerCase()).slice(0, 10)
  const cookie = (name, value, maxMs) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxMs / 1000)}`
  const clearCookie = (name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

  function issue(id, { pc = false, su = 0 } = {}) {
    const u = userOf(id)
    const t = now()
    return cookie('kmd_s', seal({ u: id, sv: u?.sv || 0, iat: t, lst: t, pc, su }), pc ? PC_MS : MAX_MS)
  }
  const ctxOf = (id, extra = {}) => {
    const u = userOf(id)
    return { user: id, admin: !!u?.admin, ...extra }
  }

  const auth = {
    FAIL,
    legacyWaiting: () => Object.values(db.users).some((u) => (u.legacy || []).length && !u.pw),
    hasUsers: () => Object.values(db.users).some((u) => (u.kind || 'person') === 'person'),
    users: () => Object.entries(db.users).map(([id, u]) => ({ id, kind: u.kind || 'person', admin: !!u.admin, password: !!u.pw, firstOpen: !!u.first && Date.parse(u.first.exp) > now(), devices: (u.keys || []).length, legacy: (u.legacy || []).length, machine: u.machine || null })),
    log: () => log.slice(),

    // ── 첫 관리자 — 셸이 받는 주소의 번호(24시간) ──
    async setupCode() {
      if (auth.hasUsers()) return null
      const { code, rec } = pw.newCode({ now: now() })
      db.setup = rec
      await persist()
      return code
    },
    async setup({ code, name, pw: ph }) {
      if (auth.hasUsers() || !pw.checkCode(db.setup, code, { now: now() })) throw new KmdError('E_AUTH', '이 주소는 이제 쓸 수 없다 — 서버 창에 새 주소가 있다')
      const id = auth.checkId(name)
      db.users[id] = { kind: 'person', admin: true, pw: await pw.hashPassword(ph, { N }), sv: 1, keys: [], at: new Date(now()).toISOString() }
      db.setup = null
      await persist()
      await note({ what: 'setup', user: id })
      return { user: id, cookie: issue(id) }
    },
    checkId(name) {
      const id = String(name || '').trim().toLowerCase()
      if (!ID_RE.test(id)) throw new KmdError('E_INPUT', '아이디는 영문 · 숫자 · . _ - 로 32자 안')
      if (isReservedUser(id)) throw new KmdError('E_INPUT', `「${id}」 는 kmd 가 쓰는 이름이다`)
      return id
    },

    // ── 들어가기 ──
    async login({ user, pw: ph, ip, cookies = {} }) {
      reload()
      const id = String(user || '').trim().toLowerCase()
      const known = userOf(id)
      const markOk = (() => {
        const m = open(cookies[markName(id)])
        return !!m && m.u === id
      })()
      // 잠긴 동안에는 판정하지 않는다 — 그래도 같은 시간을 쓴다(가짜 해시)
      if (!markOk && locks.locked(id, ip)) {
        await pw.verifyPassword(null, ph, { N })
        throw new KmdError('E_AUTH', FAIL)
      }
      const ok = await pw.verifyPassword(known?.pw, ph, { N })
      if (!ok) {
        if (!markOk) locks.fail(id, ip)
        throw new KmdError('E_AUTH', FAIL)
      }
      locks.ok(id, ip)
      const notice = known.pwSetBy ? `${localHm(known.pwSetBy.at)} 에 관리자가 새 링크를 만들었다 — 내가 부탁한 것이 아니면 관리자에게` : null
      if (known.pwSetBy) {
        delete known.pwSetBy
        await persist()
      }
      return { user: id, notice, cookies: [issue(id), cookie(markName(id), seal({ u: id, iat: now() }), 365 * 24 * H)] }
    },
    // 예전 열쇠(옮기는 동안) — 비밀번호를 아직 안 정한 사람만 · 곧바로 비밀번호 정하기로
    async loginLegacy({ token, ip }) {
      const s = pw.sha(String(token || ''))
      const hit = Object.entries(db.users).find(([, u]) => (u.legacy || []).includes(s))
      if (!hit || hit[1].pw || locks.locked('legacy', ip)) {
        locks.fail('legacy', ip)
        throw new KmdError('E_AUTH', '이 열쇠로는 들어올 수 없다 — 비밀번호로 들어온다')
      }
      const { code, rec } = pw.newCode({ now: now(), ms: 15 * 60_000 })
      hit[1].first = rec
      await persist()
      return { setPassword: true, user: hit[0], code }
    },
    // 처음 들어오기 링크 — 번호로 비밀번호를 정한다(한 번 · 24시간)
    async first({ code, pw: ph }) {
      reload()
      const hit = Object.entries(db.users).find(([, u]) => (u.kind || 'person') === 'person' && pw.checkCode(u.first, code, { now: now() }))
      if (!hit) throw new KmdError('E_AUTH', '이 링크는 이제 쓸 수 없다 — 관리자에게 새 링크를 부탁한다')
      const [id, u] = hit
      u.pw = await pw.hashPassword(ph, { N })
      u.sv = (u.sv || 0) + 1
      delete u.first
      await persist()
      await note({ what: 'password', user: id })
      locks.clear(id)
      return { user: id, cookies: [issue(id), cookie(markName(id), seal({ u: id, iat: now() }), 365 * 24 * H)] }
    },
    firstUser(code) {
      const hit = Object.entries(db.users).find(([, u]) => (u.kind || 'person') === 'person' && pw.checkCode(u.first, code, { now: now() }))
      return hit ? hit[0] : null
    },

    // ── 세션 ──
    // 쿠키 → ctx · 쓰는 동안 늘린다(set: 새 쿠키). sv 가 오르면 옛 쿠키는 끊긴다
    session(cookieHeader) {
      reload()
      const c = parseCookies(cookieHeader)
      const s = open(c.kmd_s)
      if (!s) return null
      const t = now()
      if (s.pc) {
        if (mode !== 'pc' || t - s.iat > PC_MS) return null
        return { ctx: { user: s.u, admin: true, pc: true } }
      }
      const u = userOf(s.u)
      if (!u || (u.sv || 0) !== s.sv) return null
      if (t - s.lst > IDLE_MS || t - s.iat > MAX_MS) return null
      const out = { ctx: ctxOf(s.u, { sudo: s.su > t, password: !!u.pw }) }
      if (t - s.lst > 10 * 60_000) out.set = cookie('kmd_s', seal({ ...s, lst: t }), MAX_MS - (t - s.iat))
      return out
    },
    logoutCookie: () => clearCookie('kmd_s'),
    // 재인증 — 비밀번호 한 번 · 15분 · 같은 잠금 계수
    async sudo(ctx, { pw: ph, ip, cookieHeader }) {
      const u = userOf(ctx.user)
      if (locks.locked(ctx.user, ip)) throw new KmdError('E_AUTH', FAIL)
      if (!(await pw.verifyPassword(u?.pw, ph, { N }))) {
        locks.fail(ctx.user, ip)
        throw new KmdError('E_AUTH', FAIL)
      }
      const s = open(parseCookies(cookieHeader).kmd_s)
      return cookie('kmd_s', seal({ ...s, su: now() + SUDO_MS, lst: now() }), MAX_MS - (now() - s.iat))
    },
    async logoutAll(id) {
      const u = userOf(id)
      if (!u) throw new KmdError('E_NOTFOUND', '그런 사람은 없다')
      u.sv = (u.sv || 0) + 1
      await persist()
      await note({ what: 'sv', user: id })
    },

    // ── PC — 한 번용 번호(60초) → 루프백 쿠키 30일 ──
    once(user) {
      const code = crypto.randomBytes(18).toString('base64url')
      onces.set(code, { user, exp: now() + 60_000 })
      return code
    },
    takeOnce(code) {
      const o = onces.get(code)
      onces.delete(code)
      if (!o || o.exp < now()) throw new KmdError('E_AUTH', '이 주소는 이제 쓸 수 없다 — kmd up 을 다시 연다')
      return issue(o.user, { pc: true })
    },

    // ── 사람 더하기 · 다시 정하기(관리자) — 처음 들어오기 링크 ──
    async addUser({ id: name, admin = false }) {
      const id = auth.checkId(name)
      if (db.users[id]) throw new KmdError('E_CONFLICT', '이미 있는 아이디다')
      const { code, rec } = pw.newCode({ now: now() })
      db.users[id] = { kind: 'person', admin: !!admin, sv: 1, keys: [], first: rec, at: new Date(now()).toISOString() }
      await persist()
      await note({ what: 'add', user: id })
      return { id, code }
    },
    async reset(id, { by = null } = {}) {
      const u = userOf(id)
      if (!u) throw new KmdError('E_NOTFOUND', '그런 사람은 없다')
      const { code, rec } = pw.newCode({ now: now() })
      u.first = rec
      delete u.pw
      u.sv = (u.sv || 0) + 1
      u.pwSetBy = { by, at: new Date(now()).toISOString() }
      await persist()
      await note({ what: 'reset', user: id })
      locks.clear(id)
      return { id, code }
    },
    unlock: (id) => locks.clear(id),
    locked: () => locks.list(),
    async setAdmin(id, admin) {
      const u = userOf(id)
      if (!u) throw new KmdError('E_NOTFOUND', '그런 사람은 없다')
      if (!admin && Object.values(db.users).filter((x) => x.admin && (x.kind || 'person') === 'person').length <= 1 && u.admin) throw new KmdError('E_INPUT', '마지막 관리자다')
      u.admin = !!admin
      await persist()
    },
    // 예전 열쇠 들이기(옮기기) — 그 사람 줄에 sha 만
    async addLegacy(id, token) {
      const u = userOf(id)
      if (!u) throw new KmdError('E_NOTFOUND', '그런 사람은 없다')
      ;(u.legacy ||= []).push(pw.sha(token))
      await persist()
    },

    // ── 기기 열쇠 ──
    ticket(ctx, { ip } = {}) {
      const t = 'kmdt_' + crypto.randomBytes(18).toString('base64url')
      tickets.set(pw.sha(t), { user: ctx.user, exp: now() + pw.TICKET_MS, ip })
      return t
    },
    async deviceKey({ ticket, user, pw: ph, host = '', osuser = '', ip }) {
      let id
      let yellow = false
      if (ticket) {
        const k = pw.sha(ticket)
        const t = tickets.get(k)
        tickets.delete(k)
        if (!t || t.exp < now()) throw new KmdError('E_AUTH', '설치 표가 끝났다 — 팀 화면에서 설치 한 줄을 다시 복사한다')
        id = t.user
        yellow = !!t.ip && !!ip && net24(t.ip) !== net24(ip)
      } else {
        id = String(user || '').trim().toLowerCase()
        if (locks.locked(id, ip)) throw new KmdError('E_AUTH', FAIL)
        if (!(await pw.verifyPassword(userOf(id)?.pw, ph, { N }))) {
          locks.fail(id, ip)
          throw new KmdError('E_AUTH', FAIL)
        }
      }
      const u = userOf(id)
      if (!u) throw new KmdError('E_AUTH', FAIL)
      const key = pw.newKey(pw.DEVICE_PREFIX)
      const dev = { id: crypto.randomBytes(6).toString('hex'), sha: pw.sha(key), host: String(host).slice(0, 64), osuser: String(osuser).slice(0, 64), at: new Date(now()).toISOString(), yellow }
      ;(u.keys ||= []).push(dev)
      await persist()
      await note({ what: 'device', user: id, device: dev.id, host: dev.host })
      return { key, user: id, device: { ...dev, sha: undefined } }
    },
    // 되살린 뒤 — 명부(auth.json)보다 늦은 auth.log 의 일을 다시 적용한다(v0.6 L6). 비밀번호 · 열쇠 값은 로그에 없으므로
    // 늦게 바꾼 비밀번호 · 늦게 만든 링크는 「다시 정하기」 로(관리자가 링크를 새로) · 늦게 이은 기기 · 늦게 만든 사람은 다시 잇는다.
    async reapply(text) {
      const base = db.seq || 0
      const out = { revoked: 0, sv: 0, reset: [], missing: [], devices: [], machines: 0, from: base, to: base }
      for (const line of String(text || '').split('\n')) {
        let x
        try { x = JSON.parse(line) } catch { continue }
        if (!x || !(x.seq > base)) continue
        out.to = Math.max(out.to, x.seq)
        const u = db.users[x.user]
        if (x.what === 'revoke' && u) { const n = (u.keys || []).length; u.keys = (u.keys || []).filter((d) => x.device !== '*' && d.id !== x.device); out.revoked += n - u.keys.length; u.sv = (u.sv || 0) + 1 }
        else if (x.what === 'sv' && u) { u.sv = (u.sv || 0) + 1; out.sv++ }
        else if ((x.what === 'password' || x.what === 'reset') && u) { delete u.pw; delete u.first; u.sv = (u.sv || 0) + 1; if (!out.reset.includes(x.user)) out.reset.push(x.user) }
        else if (x.what === 'machine-revoke' && u) { delete db.users[x.user]; out.machines++ }
        else if (x.what === 'device') out.devices.push(`${x.user} · ${x.host || x.device}`)
        else if ((x.what === 'add' || x.what === 'setup') && !u) out.missing.push(x.user)
      }
      db.seq = out.to
      await persist()
      await note({ what: 'reapply', from: out.from, to: out.to })
      return out
    },
    devices(id) {
      return (userOf(id)?.keys || []).map((d) => ({ id: d.id, host: d.host, osuser: d.osuser, at: d.at, used: used[d.sha] || null, yellow: !!d.yellow }))
    },
    async revokeDevice(id, devId) {
      const u = userOf(id)
      const before = (u?.keys || []).length
      if (u) u.keys = u.keys.filter((d) => devId !== '*' && d.id !== devId)
      if (u && u.keys.length !== before) {
        await persist()
        await note({ what: 'revoke', user: id, device: devId })
      }
      return before - (u?.keys || []).length
    },

    // ── 기계 열쇠 — 지식 하나 · 원천 이름 하나 · 종류 · 1년 ──
    async machineAdd({ kn, source, types = [] }) {
      if (!kn || !source) throw new KmdError('E_INPUT', '지식과 원천 이름이 있다')
      const id = `machine-${crypto.randomBytes(4).toString('hex')}`
      const key = pw.newKey(pw.MACHINE_PREFIX)
      db.users[id] = { kind: 'machine', machine: { kn, source, types, exp: new Date(now() + pw.MACHINE_DAYS * 24 * H).toISOString() }, keys: [{ id: 'm', sha: pw.sha(key), at: new Date(now()).toISOString() }] }
      await persist()
      await note({ what: 'machine', user: id, kn, source })
      return { id, key }
    },
    async machineRevoke(id) {
      if (db.users[id]?.kind !== 'machine') throw new KmdError('E_NOTFOUND', '그런 기계 열쇠는 없다')
      delete db.users[id]
      await persist()
      await note({ what: 'machine-revoke', user: id })
    },

    // PC — 그 PC 의 주인(윈도 사용자) 한 사람. 들어가기 없음(비밀번호 없는 관리자)
    async ensurePc(id) {
      if (db.users[id]) return
      db.users[id] = { kind: 'person', admin: true, sv: 1, keys: [], pc: true, at: new Date(now()).toISOString() }
      await persist()
    },
    // 서버 안에서 바로 — PC 프로그램이 자기 열쇠를 만들 때(표 없이)
    async deviceKeyFor(id, { host = '', osuser = '' } = {}) {
      const u = userOf(id)
      if (!u) throw new KmdError('E_NOTFOUND', '그런 사람은 없다')
      const key = pw.newKey(pw.DEVICE_PREFIX)
      ;(u.keys ||= []).push({ id: crypto.randomBytes(6).toString('hex'), sha: pw.sha(key), host: String(host).slice(0, 64), osuser: String(osuser).slice(0, 64), at: new Date(now()).toISOString() })
      await persist()
      return key
    },

    // ── 정리 일꾼 열쇠(kmdw_) — 일감을 받고 상태를 알리는 것만. 재료 · 초안은 일감마다의 단기 열쇠(서버 메모리)로 ──
    async workerAdd() {
      const id = `worker-${crypto.randomBytes(4).toString('hex')}`
      const key = 'kmdw_' + crypto.randomBytes(32).toString('base64url')
      db.users[id] = { kind: 'worker', keys: [{ id: 'w', sha: pw.sha(key), at: new Date(now()).toISOString() }] }
      await persist()
      await note({ what: 'worker', user: id })
      return { id, key }
    },

    // Bearer → ctx · 기기 열쇠(90일 안 쓰면 끊김) · 기계 열쇠(1년) · 예전 열쇠
    bearer(token) {
      reload()
      const t = String(token || '')
      const s = pw.sha(t)
      for (const [id, u] of Object.entries(db.users)) {
        if (u.kind === 'worker') {
          if (t.startsWith('kmdw_') && u.keys.some((k) => k.sha === s)) return { user: 'kmd-worker', admin: false, worker: { id } }
          continue
        }
        if (u.kind === 'machine') {
          if (!t.startsWith(pw.MACHINE_PREFIX) || !u.keys.some((k) => k.sha === s)) continue
          if (Date.parse(u.machine.exp) < now()) return null
          touch(s)
          return { user: 'kmd-auto', admin: false, machine: { id, ...u.machine } }
        }
        const dev = (u.keys || []).find((k) => k.sha === s)
        if (dev) {
          const last = Date.parse(used[s] || dev.at)
          if (now() - last > pw.DEVICE_IDLE_DAYS * 24 * H) return null
          touch(s)
          return { user: id, admin: !!u.admin, device: dev.id, newDevice: now() - Date.parse(dev.at) < 24 * H ? dev.host : null }
        }
        if ((u.legacy || []).includes(s)) return { user: id, admin: !!u.admin, legacy: true }
      }
      return null
    },
  }

  // 마지막 사용 — 하루 한 번 적는다
  function touch(s) {
    const day = new Date(now()).toISOString().slice(0, 10)
    if (used[s]?.startsWith(day)) return
    used[s] = new Date(now()).toISOString()
    writeJson(usedFile, used).catch(() => {})
  }
  const net24 = (ip) => String(ip).replace(/^::ffff:/, '').split('.').slice(0, 3).join('.')
  return auth
}
