// 비밀번호 · 잠금 · 처음 들어오기 번호 · 열쇠.
//
// 서버는 비밀번호를 받지 않는다 — 화면 · 설치기가 보낸 전처리 값(`app/prehash.js`)을 사람마다 16바이트 salt 로
// 다시 scrypt 한다. scrypt 는 maxmem 을 꼭 넘긴다(Node 22 기본 32MiB 로는 N=2^15 부터 실패). 동시 계산은 2개 —
// 들어가기 폭주가 서버를 멈추지 않게. 없는 아이디도 가짜 해시를 한 번 돌린다(시간으로 명부를 흘리지 않게).

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const SCRYPT_FLOOR = 1 << 15
const R = 8
const P = 1
const MAXMEM = 256 * 1024 * 1024

const scryptP = (pw, salt, N) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, { N, r: R, p: P, maxmem: MAXMEM }, (e, k) => (e ? rej(e) : res(k))))

let running = 0
const waiting = []
async function slot(fn) {
  if (running >= 2) await new Promise((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

export const PREHASH_RE = /^[A-Za-z0-9_-]{43}$/

export async function hashPassword(prehash, { N = SCRYPT_FLOOR } = {}) {
  if (!PREHASH_RE.test(String(prehash || ''))) throw Object.assign(new Error('비밀번호 값의 모양이 아니다'), { code: 'E_INPUT' })
  const salt = crypto.randomBytes(16)
  const hash = await slot(() => scryptP(prehash, salt, N))
  return { alg: 'scrypt', N, r: R, p: P, salt: salt.toString('base64url'), hash: hash.toString('base64url'), at: new Date().toISOString() }
}

const DUMMY = { alg: 'scrypt', N: SCRYPT_FLOOR, r: R, p: P, salt: 'AAAAAAAAAAAAAAAAAAAAAA', hash: 'A'.repeat(43) }
export async function verifyPassword(rec, prehash, { N = SCRYPT_FLOOR } = {}) {
  const shaped = PREHASH_RE.test(String(prehash || ''))
  const ok = !!rec && rec.alg === 'scrypt' && shaped
  const r = ok ? rec : { ...DUMMY, N }
  const got = await slot(() => scryptP(shaped ? prehash : 'x'.repeat(43), Buffer.from(r.salt, 'base64url'), r.N || SCRYPT_FLOOR).catch(() => Buffer.alloc(32)))
  const want = Buffer.from(r.hash, 'base64url')
  return ok && want.length === got.length && crypto.timingSafeEqual(want, got)
}

// 처음 시작 때 한 번 — 이 서버에서 0.25 ~ 1초 안의 가장 큰 N(바닥 2^15) · `<data>/scrypt.json`
export async function scryptN(dataDir, { override = null, target = 500, max = 1 << 18 } = {}) {
  if (override) return Number(override)
  const f = path.join(dataDir, 'scrypt.json')
  const had = await fs.readFile(f, 'utf8').then(JSON.parse, () => null)
  if (had?.N >= SCRYPT_FLOOR) return had.N
  let N = SCRYPT_FLOOR
  let ms = 0
  for (;;) {
    const t0 = Date.now()
    await scryptP('x'.repeat(43), Buffer.alloc(16), N)
    ms = Date.now() - t0
    if (ms * 2 > target || N * 2 > max) break
    N *= 2
  }
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(f, JSON.stringify({ N, ms, at: new Date().toISOString() }) + '\n')
  return N
}

// ── 잠금 — (아이디 × IP) 5번 / 15분 · 아이디 단독 30번 / 15분 ──
// 잠긴 동안에는 비밀번호를 판정하지 않는다(맞든 틀리든 같은 답). 서버 메모리 — 다시 띄우면 풀린다.
export const LOCK_MAX = 5
export const LOCK_MS = 15 * 60_000
export const LOCK_SLOW_MAX = 30

export function makeLocks({ now = () => Date.now() } = {}) {
  const m = new Map()
  const key = (user, ip) => `${String(user || '').toLowerCase()}|${ip || '-'}`
  const bump = (k, max) => {
    let e = m.get(k)
    if (!e || (!e.until && now() - e.first > LOCK_MS) || (e.until && e.until <= now())) e = { n: 0, until: 0, first: now() }
    e.n++
    if (e.n >= max) e.until = now() + LOCK_MS
    m.set(k, e)
    if (m.size > 10000) for (const [x, v] of m) if ((v.until && v.until <= now()) || (!v.until && now() - v.first > LOCK_MS)) m.delete(x)
  }
  const on = (k) => {
    const e = m.get(k)
    return !!e && e.until > now()
  }
  return {
    locked: (user, ip) => on(key(user, ip)) || on(key(user, '*')),
    fail(user, ip) {
      bump(key(user, ip), LOCK_MAX)
      bump(key(user, '*'), LOCK_SLOW_MAX)
    },
    ok(user, ip) {
      m.delete(key(user, ip))
    },
    clear(user) {
      for (const k of [...m.keys()]) if (k.startsWith(String(user || '').toLowerCase() + '|')) m.delete(k)
    },
    list: () => [...m.entries()].filter(([, e]) => e.until > now()).map(([k, e]) => ({ user: k.split('|')[0], ip: k.split('|')[1], until: new Date(e.until).toISOString() })),
  }
}

// ── 처음 들어오기 번호 — 24시간 · 한 번 ──
export const FIRST_MS = 24 * 3600_000
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
export function newCode({ now = Date.now(), ms = FIRST_MS } = {}) {
  const code = crypto.randomBytes(24).toString('base64url')
  return { code, rec: { sha256: sha(code), exp: new Date(now + ms).toISOString() } }
}
export function checkCode(rec, code, { now = Date.now() } = {}) {
  if (!rec?.sha256 || !code) return false
  if (Date.parse(rec.exp) < now) return false
  const a = Buffer.from(rec.sha256)
  const b = Buffer.from(sha(String(code)))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── 열쇠 — 기기(kmdk_) · 기계(kmdm_) · 서버에는 sha256 만 ──
export const DEVICE_PREFIX = 'kmdk_'
export const MACHINE_PREFIX = 'kmdm_'
export const DEVICE_IDLE_DAYS = 90
export const MACHINE_DAYS = 365
export const TICKET_MS = 10 * 60_000
export const newKey = (prefix) => prefix + crypto.randomBytes(32).toString('base64url')
