// 주인 장부 — 지식마다 주인 · 지식관리자(예전 정리하는 사람) · 되살림 표지. 팀 서버의 지식은 모두 팀 지식이다(개인 지식은 각자의 PC 에만).
//
// `<data>/owners.json { groups: { <묶음>: { members } }, knowledge: { <지식>: { owner, curators, restored, at, access } } }` — 서버에 하나.
// 줄이 없는 지식도 팀 지식이다(자리를 받은 사람 · 총괄 관리자만 본다). 옛 장부 · `_members.md` 의 「개인」 은 읽지 않는다.
//
//   access    지식마다 자리(docs/kmd_권한_모델.md v1.1) — { all, users: { 아이디: 자리 }, groups: { 묶음: 자리 } } · 자리는 none · read · write · admin(지식관리자).
//             없는 줄의 기본은 없음(none) · 주인 · 예전 정리하는 사람(curators)은 늘 지식관리자
//   accessV   (장부 맨 위) 2 — 옛 기본 「모두: 쓰기」 를 사람 줄로 옮기고 기본을 없음으로 바꾼 표시(한 번만 · migrateV2)
//
//   restored  (옛 판) git 으로 되살린 지식 — 주인을 알기 전까지 관리자만 본다. 이제는 되살릴 때 `_members.md` 를 따르고(없으면 팀
//             지식) 켤 때 맞추며 이 표지를 걷는다
//
// 깨진 장부는 빈 것으로 읽지 않는다 — 빈 것이면 가림이 모두 풀린다. 서버가 뜨지 않는다.
// 가림은 화면과 API 뿐이다 — 「팀 서버에 둔 내 지식은 서버 관리자가 디스크 · 백업으로 볼 수 있다」.
//
// 정답은 둘이다 — 장부(살림 자리)와 지식 안의 `_members.md`(백업 · 되살림을 따라간다). 서버는 켤 때 · 동기화 때 둘을 맞춘다. 장부는 한 줄로 서서 고치고(hub 의 큐) ·
// 쓰기는 이 프로세스만의 임시 파일 뒤 이름 바꾸기 · 셸(kmd owner · restore)이 쓰면 도는 서버가 mtime 을 보고 다시 읽는다.

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

export const RESERVED_FILES = ['_members.md', '_format.json', '_sources.json']
export const isReservedFile = (f) => RESERVED_FILES.includes(String(f ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').split('/').pop().toLowerCase())

const fileOf = (dataDir) => path.join(dataDir, 'owners.json')

function parseReg(text) {
  if (text == null) return { groups: {}, knowledge: {} }
  let j
  try {
    j = JSON.parse(text)
  } catch (e) {
    throw new Error(`owners.json 이 깨졌다: ${e.message} · 고치거나 지운 뒤 다시 띄운다`)
  }
  if (!j || typeof j !== 'object' || typeof (j.knowledge ?? {}) !== 'object') throw new Error('owners.json 의 모양이 아니다. { knowledge: { … } }')
  return { ...(Number.isInteger(j.accessV) ? { accessV: j.accessV } : {}), groups: j.groups && typeof j.groups === 'object' ? j.groups : {}, knowledge: j.knowledge || {} }
}
export async function load(dataDir) {
  return parseReg(await fs.readFile(fileOf(dataDir), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e))))
}
// 요청마다 볼 때 — 셸이 바꾼 장부를 곧바로(mtime 이 바뀌었을 때만 읽는다)
export function loadSync(dataDir) {
  let text = null
  try { text = fsSync.readFileSync(fileOf(dataDir), 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
  return parseReg(text)
}
export function mtimeOf(dataDir) {
  try { return fsSync.statSync(fileOf(dataDir)).mtimeMs } catch { return 0 }
}

// 프로세스 사이 잠금 — 도는 서버와 셸(kmd owner · restore)이 같은 장부를 고칠 때 한 줄로(owners.json.lock · 'wx').
// 잠금 안에서 디스크의 것을 다시 읽고 고쳐 쓴다 · 30초 넘은 잠금은 넘어진 프로세스의 것으로 보고 걷는다
export async function withLock(dataDir, fn) {
  await fs.mkdir(dataDir, { recursive: true })
  const lock = fileOf(dataDir) + '.lock'
  for (let i = 0; ; i++) {
    try {
      const h = await fs.open(lock, 'wx')
      await h.writeFile(`${process.pid} ${new Date().toISOString()}`)
      await h.close()
      break
    } catch (e) {
      if (e.code !== 'EEXIST' && !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      const st = await fs.stat(lock).catch(() => null)
      if (st && Date.now() - st.mtimeMs > 30_000) await fs.rm(lock, { force: true }).catch(() => {})
      else if (i > 400) throw Object.assign(new Error('주인 장부를 다른 kmd 가 쥐고 있다. 잠시 뒤 다시'), { code: 'E_BUSY' })
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  try {
    return await fn()
  } finally {
    await fs.rm(lock, { force: true }).catch(() => {})
  }
}

// 쓰기 — 이 쓰기만의 임시 파일(둘이 같은 .tmp 를 다투지 않게) 뒤 이름 바꾸기 · Windows 가 잠깐 잡으면(EPERM) 몇 번 더
export async function store(dataDir, reg) {
  await fs.mkdir(dataDir, { recursive: true })
  const f = fileOf(dataDir)
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, JSON.stringify(reg, null, 1) + '\n')
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(tmp, f)
    } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
      await new Promise((r) => setTimeout(r, 50))
    }
  }
}

// ── 자리 — 없음 · 읽기 · 쓰기 · 지식관리자(docs/kmd_권한_모델.md v1.1) ──
export const LEVELS = ['none', 'read', 'write', 'admin']
export const LEVEL_WORD = { none: '없음', read: '읽기', write: '쓰기', admin: '지식관리자' }
// 옛 이름 「관리」 도 읽는다(옛 _members.md · 셸)
const WORD_LEVEL = { ...Object.fromEntries(Object.entries(LEVEL_WORD).map(([k, v]) => [v, k])), 관리: 'admin' }
export const rank = (l) => Math.max(0, LEVELS.indexOf(l))
export const atLeast = (l, want) => rank(l) >= rank(want)
const top = (...ls) => ls.filter(Boolean).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'none')
// 자리 이름 하나 — 영어(none · read …)나 화면 이름(없음 · 읽기 …) · 아니면 null
export const levelWord = (x) => (LEVELS.includes(String(x)) ? String(x) : WORD_LEVEL[String(x ?? '').trim()] || null)
const badLevel = (x) => Object.assign(new Error(`자리는 없음 · 읽기 · 쓰기 · 지식관리자 중 하나다: ${String(x).slice(0, 20)}`), { code: 'E_INPUT' })
// 묶음 이름 — 한 줄 40자 · _members.md 의 「묶음: 이름=자리, …」 를 깨지 않게
export const groupName = (n) => {
  const s = String(n ?? '').normalize('NFC').trim()
  if (!s || s.length > 40 || /[=,:·\r\n\t]/.test(s)) throw Object.assign(new Error('묶음 이름은 한 줄 40자 안 · = , : · 는 쓰지 않는다'), { code: 'E_INPUT' })
  return s
}
// 자리 표를 한 꼴로 — 없음 줄은 뺀다(모두보다 낮출 수 없다 · 자리는 가장 높은 것)
export function normAccess(a = {}) {
  const lv = (x) => { const l = levelWord(x); if (!l) throw badLevel(x); return l }
  const map = (m, key) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).map(([k, v]) => [key(k), lv(v)]).filter(([k, v]) => k && v !== 'none'))
  return { all: a.all == null ? 'none' : lv(a.all), users: map(a.users, (k) => String(k).trim().toLowerCase()), groups: map(a.groups, groupName) }
}
// 그 지식의 자리 표 — 칸이 없으면 기본 없음(받지 않은 지식은 보이지 않는다 · 주인 · 총괄 관리자만)
export function accessOf(row) {
  if (row?.access) return { all: row.access.all || 'none', users: row.access.users || {}, groups: row.access.groups || {} }
  return { all: 'none', users: {}, groups: {} }
}
// 옛 규칙(accessV 2 전) — 칸이 없으면 모두 쓰기 · 되살림 · 주인 없음이면 총괄 관리자만. 옮기기(migrateV2)만 쓴다
export function legacyAccessOf(row) {
  if (row?.access) return accessOf(row)
  if (row?.restored && !row.owner) return { all: 'none', users: {}, groups: {} }
  return { all: 'write', users: {}, groups: {} }
}
// 그 줄의 예전 정리하는 사람 — 되살림 · 주인 없음 줄은 아무도 아니다(총괄 관리자만 · docs/kmd_권한_모델.md 4절)
export const curatorsOf = (row) => (row?.restored && !row.owner ? [] : row?.curators || [])
export const groupsOf = (reg, user) => Object.entries(reg?.groups || {}).filter(([, g]) => (g?.members || []).includes(user)).map(([n]) => n)

// 그 사람의 자리 — 총괄 관리자 · 셸 · PC 주인 ctx → 지식관리자 · 주인 · 예전 정리하는 사람 → 지식관리자 · 그 밖은 사람 · 묶음 · 모두 줄의 가장 높은 것.
//   에이전트(kmda_) · 기계 · 초안 열쇠는 그 지식 하나만(에이전트는 바로 쓴다 · 기계는 기준선 · 초안은 재료)
export function levelOf(reg, id, ctx = {}) {
  if (!ctx) return 'none'
  if (ctx.agent) return ctx.agent.kn === id ? 'admin' : 'none'
  if (ctx.machine) return ctx.machine.kn === id ? 'write' : 'none'
  if (ctx.draft) return ctx.draft.kn === id ? 'read' : 'none'
  if (ctx.worker) return 'none'
  if (ctx.admin || ctx.shell || ctx.pc) return 'admin'
  const u = ctx.user
  if (!u) return 'none'
  const row = rowOf(reg, id)
  if (row?.owner === u || curatorsOf(row).includes(u)) return 'admin'
  const a = accessOf(row)
  return top(a.all, a.users[u], ...groupsOf(reg, u).map((g) => a.groups[g]))
}

// 그 사람이 그 지식을 보나 — ctx { user, admin } · 읽기 이상
export function visible(reg, id, ctx = {}) {
  return atLeast(levelOf(reg, id, ctx), 'read')
}
// 사람에게 자리가 따로 있나(주인 · 정리 · 사람 줄 · 묶음 줄) — 설정 › 사람의 「지식 n개에 자리」
export function seatOf(reg, id, user) {
  const row = rowOf(reg, id)
  if (!row) return null
  if (row.owner === user || curatorsOf(row).includes(user)) return 'admin'
  const a = accessOf(row)
  const l = top(a.users[user], ...groupsOf(reg, user).map((g) => a.groups[g]))
  return l === 'none' ? null : l
}

// 자리 표 바꾸기 — all · users · groups 중 온 것만 갈아 끼운다. 새 꼴로 쓸 때 curators 는 비운다 —
//   사람 줄(users)을 보내지 않았으면 지식관리자(예전 정리하는 사람)을 관리 줄로 옮기고, 보냈으면 보낸 값을 따른다(빠졌으면 자리 없음 · 낮췄으면 낮춘 대로)
export function setAccess(reg, id, { all, users, groups } = {}) {
  const prev = reg.knowledge[id] || {}
  const cur = accessOf(prev)
  const next = normAccess({ all: all ?? cur.all, users: users ?? cur.users, groups: groups ?? cur.groups })
  for (const g of Object.keys(next.groups)) if (!reg.groups?.[g]) throw Object.assign(new Error(`그런 묶음은 없다: ${g}`), { code: 'E_INPUT' })
  if (users == null) for (const c of curatorsOf(prev)) next.users[c] = 'admin'
  if (prev.owner) delete next.users[prev.owner] // 주인은 늘 관리
  const { private: _p, workerOk: _w, ...keep } = prev
  reg.knowledge[id] = { ...keep, owner: prev.owner ?? null, curators: [], access: next, at: new Date().toISOString() }
  if (reg.knowledge[id].owner) delete reg.knowledge[id].restored
  return reg.knowledge[id]
}
// 옛 지식 한 번 옮기기(docs/kmd_권한_모델.md 4절) — 기본 「모두: 쓰기」 → 「없음」. 겉으로 바뀌는 것이 없게
//   ids 의 지식마다(장부에 줄이 없는 지식도) people(떠난 사람 · 기계 · 일꾼 제외 · auth.people) 모두에게 옛 기본 자리를 사람 줄로 적고
//   (사람 줄이 이미 그 이상이면 그대로 — 낮추지 않는다 · 주인 · 묶음 자리는 그대로) · 예전 정리하는 사람은 사람 줄 지식관리자로 옮긴 뒤
//   all = none. 장부에 accessV = 2 를 단다. 이미 2 면 아무것도 하지 않는다. 바뀐 지식 id
export function migrateV2(reg, ids, people) {
  if (reg.accessV >= 2) return []
  const touched = []
  for (const id of ids) {
    const prev = reg.knowledge[id] || {}
    const old = legacyAccessOf(prev)
    const users = { ...old.users }
    for (const c of curatorsOf(prev)) users[c] = top(users[c], 'admin')
    if (old.all !== 'none') for (const u of people) if (u !== prev.owner && rank(users[u]) < rank(old.all)) users[u] = old.all
    const next = normAccess({ all: 'none', users, groups: old.groups })
    if (prev.owner) delete next.users[prev.owner]
    const was = prev.access ? JSON.stringify(normAccess(prev.access)) : null
    if (was === JSON.stringify(next) && !(prev.curators || []).length && reg.knowledge[id]) continue
    const { private: _p, workerOk: _w, ...keep } = prev
    reg.knowledge[id] = { ...keep, owner: prev.owner ?? null, curators: [], access: next, at: new Date().toISOString() }
    touched.push(id)
  }
  reg.accessV = 2
  return touched
}
// 한 사람의 사람 줄 자리를 지식마다 한 번에 — { 지식: none|read|write|admin } · none 이면 사람 줄을 지운다(묶음 · 주인 자리는 그대로)
//   설정 › 사람의 「사람 더하기」 · 사람 카드의 지식마다 자리 표. 바뀐 지식 id
export function setSeats(reg, user, seats) {
  const u = String(user ?? '').trim().toLowerCase()
  const touched = []
  for (const [id, l0] of Object.entries(seats || {})) {
    const l = levelWord(l0)
    if (!l) throw badLevel(l0)
    const prev = reg.knowledge[id] || {}
    if (prev.owner === u) continue // 주인은 늘 지식관리자
    const cur = accessOf(prev)
    const users = { ...cur.users }
    for (const c of curatorsOf(prev)) users[c] = top(users[c], 'admin')
    if ((users[u] || 'none') === l) continue
    if (l === 'none') delete users[u]
    else users[u] = l
    setAccess(reg, id, { users })
    touched.push(id)
  }
  return touched
}
// 묶음 — 더하기 · 사람 바꾸기(members 를 통째로) · 지우기(그 묶음 줄도 지식마다 걷는다)
export function setGroup(reg, name, members) {
  const n = groupName(name)
  reg.groups ||= {}
  reg.groups[n] = { members: [...new Set((Array.isArray(members) ? members : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].sort() }
  return { name: n, ...reg.groups[n] }
}
export function dropGroup(reg, name) {
  const n = groupName(name)
  if (!reg.groups?.[n]) throw Object.assign(new Error(`그런 묶음은 없다: ${n}`), { code: 'E_NOTFOUND' })
  delete reg.groups[n]
  const touched = []
  for (const [id, r] of Object.entries(reg.knowledge || {})) if (r?.access?.groups?.[n]) { delete r.access.groups[n]; touched.push(id) }
  return touched
}
// 떠난 사람 — 사람 줄 · 묶음에서 뺀다 · 바뀐 지식 id
export function dropUser(reg, user) {
  for (const g of Object.values(reg.groups || {})) if (g?.members) g.members = g.members.filter((x) => x !== user)
  const touched = []
  for (const [id, r] of Object.entries(reg.knowledge || {})) if (r?.access?.users?.[user]) { delete r.access.users[user]; touched.push(id) }
  return touched
}

// 옛 줄의 private 은 걷어 돌려준다 — 팀 서버에는 개인 지식이 없다
export const rowOf = (reg, id) => {
  const r = reg?.knowledge?.[id]
  if (!r || !('private' in r)) return r || null
  const { private: _p, ...rest } = r
  return rest
}

// tidyAt — 정해진 정리 시각(HH:MM · 기본 02:30) · tidyMode — 정리 방식(time 정해진 시각 · live 실시간 · manual 손으로만) ·
// noClaude — Claude 에 보내지 않음
export function setOwner(reg, id, { owner = null, curators, tidyAt, tidyMode, noClaude } = {}) {
  const prev = reg.knowledge[id] || {}
  if (tidyAt != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tidyAt)) throw Object.assign(new Error('정리 시각은 HH:MM 이다'), { code: 'E_INPUT' })
  if (tidyMode != null && !['time', 'live', 'manual'].includes(tidyMode)) throw Object.assign(new Error('정리 방식은 정해진 시각 · 실시간 · 손으로 중 하나'), { code: 'E_INPUT' })
  const { private: _p, workerOk: _w, ...keep } = prev
  const row = { ...keep, owner: owner ?? prev.owner ?? null, curators: curators ?? prev.curators ?? [], at: new Date().toISOString() }
  if (tidyAt != null) row.tidyAt = tidyAt
  if (tidyMode != null) row.tidyMode = tidyMode
  if (noClaude != null) row.noClaude = !!noClaude
  if (row.owner) delete row.restored
  reg.knowledge[id] = row
  return row
}

// `_members.md` — 지식 안의 사람 칸(예약 파일) · 정리 설정도 같이(살림 자리를 잃고 되살려도 그대로)
//   - 주인: kim · - 정리: park, lee · - 정리 방식: 정해진 시각 02:30 | 실시간 | 손으로만 · - Claude 에 보내지 않음: 예
//   자리 표(새 꼴 · 있을 때만): - 모두: 없음 · - 읽기: a, b · - 쓰기: c · - 지식관리자: d · - 묶음: 개발=쓰기, 운영=지식관리자(옛 「관리」 줄도 읽는다)
//   묶음의 사람 목록은 서버(owners.json)에만 둔다. 이 줄이 없는 옛 `_members.md` 는 옛 규칙
const MODE_WORD = { time: '정해진 시각', live: '실시간', manual: '손으로만' }
const YES = /^(예|네|yes|true|1)$/i
export function parseMembers(text) {
  const out = { owner: null, curators: [], settings: false }
  let acc = null
  const ids = (s) => s.split(/[,\s·]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(주인|정리 방식|정리|Claude 에 보내지 않음|모두|읽기|쓰기|지식관리자|관리|묶음)\s*[:：]\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (['모두', '읽기', '쓰기', '지식관리자', '관리', '묶음'].includes(m[1])) {
      acc ||= { all: 'none', users: {}, groups: {} }
      if (m[1] === '모두') acc.all = levelWord(m[2]) || 'none'
      else if (m[1] === '묶음') {
        for (const part of m[2].split(/[,·]/)) {
          const [g, l] = part.split('=').map((x) => (x || '').trim())
          if (g && levelWord(l) && levelWord(l) !== 'none') acc.groups[g] = levelWord(l)
        }
      } else for (const u of ids(m[2])) acc.users[u] = top(acc.users[u], WORD_LEVEL[m[1]])
      continue
    }
    if (m[1] === '주인') out.owner = m[2] || null
    else if (m[1] === '정리') out.curators = m[2].split(/[,\s·]+/).filter(Boolean)
    else if (m[1] === '정리 방식') {
      out.settings = true
      const mode = Object.keys(MODE_WORD).find((k) => m[2].startsWith(MODE_WORD[k]))
      if (mode) out.tidyMode = mode
      const at = /([01]\d|2[0-3]):[0-5]\d/.exec(m[2])
      if (at) out.tidyAt = at[0]
    } else {
      out.settings = true
      out.noClaude = YES.test(m[2])
    }
  }
  if (acc) out.access = acc
  return out
}
export function renderMembers({ owner = null, curators = [], tidyMode = 'time', tidyAt = null, noClaude = false, access = null } = {}) {
  const lines = ['# 사람', '', `- 주인: ${owner || ''}`, `- 정리: ${(curators || []).join(', ')}`, `- 정리 방식: ${MODE_WORD[tidyMode] || MODE_WORD.time}${(tidyMode || 'time') === 'time' && tidyAt ? ' ' + tidyAt : ''}`, `- Claude 에 보내지 않음: ${noClaude ? '예' : '아니오'}`]
  if (access) {
    const a = accessOf({ access })
    const who = (l) => Object.keys(a.users).filter((u) => a.users[u] === l).sort().join(', ')
    lines.push(`- 모두: ${LEVEL_WORD[a.all] || '없음'}`, `- 읽기: ${who('read')}`, `- 쓰기: ${who('write')}`, `- 지식관리자: ${who('admin')}`, `- 묶음: ${Object.keys(a.groups).sort().map((g) => `${g}=${LEVEL_WORD[a.groups[g]]}`).join(', ')}`)
  }
  return [...lines, ''].join('\n')
}
// 두 자리 표가 같은가(_members.md 와 장부 맞추기)
export const sameAccess = (a, b) => JSON.stringify(a ? normAccess(a) : null) === JSON.stringify(b ? normAccess(b) : null)
// _members.md 의 자리 표 — 손으로 고친 줄이 깨져 있어도 넘어지지 않게 · 서버에 없는 묶음 · 아이디 모양이 아닌 이름은 뺀다
const mdAccess = (reg, a) => {
  const groups = {}
  for (const [g, l] of Object.entries(a.groups || {})) { try { if (reg.groups?.[groupName(g)]) groups[groupName(g)] = l } catch {} }
  const users = Object.fromEntries(Object.entries(a.users || {}).filter(([u]) => /^[a-z0-9._-]{1,40}$/.test(u)))
  return normAccess({ all: a.all, users, groups })
}
const readMembers = async (dir) => {
  const text = await fs.readFile(path.join(dir, '_members.md'), 'utf8').catch(() => null)
  return text == null ? null : parseMembers(text)
}

// `_members.md` 를 따라 줄을 세운다.
//   `_members.md` 가 없으면 줄을 두지 않는다.
//   restore — 되살릴 때만: 설정 줄이 없는 옛 `_members.md` 면 안전한 쪽(Claude 에 보내지 않음 · 손으로만 정리)으로 두고 다시 보라고
//   표시한다(check). 켤 때 · 동기화 때는 옛 꼴이어도 설정을 건드리지 않는다(팀 지식의 정리가 말없이 멈추지 않게)
export async function adoptMembers(reg, id, dir, { restore = false } = {}) {
  const m = await readMembers(dir)
  if (!m) {
    delete reg.knowledge[id]
    return null
  }
  const settings = m.settings ? { tidyMode: m.tidyMode || 'time', tidyAt: m.tidyAt, noClaude: !!m.noClaude } : restore ? { tidyMode: 'manual', noClaude: true } : {}
  const row = setOwner(reg, id, { owner: m.owner, curators: m.curators, ...settings })
  // 자리 표 — 새 꼴이면 따른다 · 없으면 옛 규칙
  if (m.access) row.access = mdAccess(reg, m.access)
  else delete row.access
  if (!m.settings && restore) row.check = true
  else delete row.check
  return row
}

// 켤 때 · 동기화 때 — 장부와 `_members.md` 를 맞춘다. 장부에 줄이 없으면 `_members.md` 를 따른다. 앞 판의 「되살림 — 관리자만」 표지는 그대로 둔다(말없이 열지 않는다). 바뀌었으면 true
export async function reconcile(reg, id, dir) {
  const m = await readMembers(dir)
  const row = reg.knowledge[id]
  if (!m) return false
  if (!row || (row.restored && !row.owner)) {
    await adoptMembers(reg, id, dir)
    return true
  }
  // 장부가 옛 꼴인데 `_members.md` 에 자리 표가 있다(장부를 잃었거나 옛 장부로 되돌렸다) — 새 꼴을 따른다
  if (!row.access && m.access) {
    row.access = mdAccess(reg, m.access)
    return true
  }
  return false
}
