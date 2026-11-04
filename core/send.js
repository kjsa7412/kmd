// 보내기 — 내 지식에서 고친 것을 보낼 곳(팀 지식)으로(v0.3 V5 · M10).
//
// 보낼 곳은 지식 폴더의 `.kmd.json` { send: [{ kn, url? }] } — url 이 없으면 같은 kmd(save 하나), 있으면 그 kmd 로
// 기기 열쇠 HTTP(`POST <url>/api/k/<kn>/receive`). 닿지 않으면 `<data>/send/<지식>.json` 의 wait 에 두고 닿을 때 저절로.
// 보낼 것 = ① 변경사항 — 보낸 뒤(또는 보낼 곳을 정한 뒤) 바뀐 문서(새 문서는 전체 · 아니면 바뀐 항목만) · 그 뒤 새로 남은 기록(전체)
//          ② 지식 — 사람이 고른 문서(전체) · 기록(전체). 화면이 고른 것만 보낸다(고르지 않은 변경사항은 다음에 그대로 남는다).
// 받는 쪽은 기록 하나(태그 `sent/<지문>` — 같은 것을 두 번 받으면 0) · 이름은 받는 지식의 이름 장부로 정확히 맞는 것만.
// 받는 쪽이 글 몇 개만 거절하면(너무 긴 글 등) 나머지는 받고 { bad: [{ i, why }] } 로 돌려준다 — 보내는 쪽은 그것만 fail 줄로.
// S12(설계 4-7 · S-D36) — 받는 팀으로는 글마다 팀 MCP(mcpCalls: brief · match · section) → 내 Claude → 팀 저장 문(post path 'save' · channel send).
//   위의 받기(/receive)는 옛 판을 위해 남는다(팀 지식에는 넣지 못함 legacy-send). 저장 속도 한도(429)는 post 가 쉬고 다시 보낸다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { sha16 } from './text.js'
import { KmdError } from './errors.js'
import { joinLog } from './sections.js'

export const CONF = '.kmd.json'

export async function readConf(dir) {
  const t = await fs.readFile(path.join(dir, CONF), 'utf8').catch(() => null)
  if (t == null) return {}
  try {
    const j = JSON.parse(t)
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}
export async function destsOf(dir) {
  const c = await readConf(dir)
  return (Array.isArray(c.send) ? c.send : []).filter((d) => d && typeof d.kn === 'string' && d.kn).map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}), ...(d.name ? { name: String(d.name) } : {}) }))
}
export function checkDest(d) {
  if (!d || typeof d.kn !== 'string' || !/^[^\s/\\]{1,80}$/.test(d.kn)) throw new KmdError('E_INPUT', '보낼 곳은 지식 이름이다')
  if (d.url != null) {
    let u
    try {
      u = new URL(String(d.url))
    } catch {
      throw new KmdError('E_INPUT', '보낼 곳 주소가 아니다')
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new KmdError('E_INPUT', '보낼 곳 주소는 http(s) · 자격 없이')
  }
}

const stateFile = (dataDir, id) => path.join(dataDir, 'send', `${encodeURIComponent(id)}.json`)
export async function readState(dataDir, id) {
  const s = await fs.readFile(stateFile(dataDir, id), 'utf8').then(JSON.parse, () => ({}))
  // wait — 보내지 못한 것: state 'wait'(닿지 않음 — 저절로 다시) · 'fail'(거절 — 사람이 [다시] · [버리기]) · 줄마다 id
  const wait = (s.wait || []).map((w, i) => ({ id: w.id || `w${i}${String(w.at || '').replace(/\D/g, '').slice(-8)}`, state: w.state || 'wait', ...w }))
  // route — 팀 화면의 보내는 길을 정한 때({ kn, since }) · sentRecs 값은 보낸 때(예전 것은 true)
  return { sent: s.sent || {}, dropped: s.dropped || {}, sentRecs: s.sentRecs || {}, recSince: s.recSince || null, route: s.route || null, wait, log: s.log || [] }
}
export async function writeState(dataDir, id, st) {
  await fs.mkdir(path.join(dataDir, 'send'), { recursive: true })
  const f = stateFile(dataDir, id)
  await fs.writeFile(f + '.tmp', JSON.stringify({ ...st, log: st.log.slice(0, 30) }))
  await fs.rename(f + '.tmp', f)
}

// 문서의 지문 — 항목마다(applied · watched 표지는 빼고 견준다). 참고 블록 · 경과는 읽을 때(parseDoc) 이미 떨어져
// 항목 글에 없다 — 보내는 글에 보낸 쪽 기록 링크가 실리지 않는다
const clean = (b) => String(b || '').replace(/<!--\s*(applied|watched):[^>]*-->/g, '').trim()
export function marks(d) {
  const secs = {}
  // 지문은 옛 꼴과 같은 글(본문 + 출처 줄)로 잰다 — 꼴을 옮겼다고 모든 문서가 「바뀜」 으로 모이지 않게
  for (const s of d.sections) if (s.h) secs[s.h] = sha16(clean(joinLog(s.body, s.log || [])))
  return { sha: sha16(JSON.stringify(secs)), secs }
}
// 보낼 곳을 정할 때 — 지금 글을 「보낸 것」 으로(그 뒤 고친 것만 모인다)
export function baseline(k) {
  return Object.fromEntries(k.docs.map((d) => [d.path, marks(d)]))
}

// 보낼 것 — [{ doc, title, heads, isNew, sha, on, when }]
export function queue(k, st) {
  const out = []
  for (const d of k.docs) {
    const m = marks(d)
    const prev = st.sent[d.path]
    if (prev && prev.sha === m.sha) continue
    const heads = Object.keys(m.secs).filter((h) => !prev || prev.secs[h] !== m.secs[h])
    if (!heads.length) continue
    out.push({ kind: 'doc', key: `doc:${d.path}`, doc: d.id, path: d.path, title: d.title, heads, isNew: !prev, sha: m.sha, on: st.dropped[d.path] !== m.sha, when: d.mtime })
  }
  return out.sort((a, b) => String(b.when).localeCompare(String(a.when)))
}

// 변경사항의 기록 — 보낼 곳을 정한 뒤 이 지식에 새로 남은 기록(받아 온 것 · 이력은 빼고 · 보낸 것은 다시 모이지 않는다)
export function recQueue(k, st) {
  if (!st.recSince) return []
  return k.works
    .filter((w) => w.date >= st.recSince && !st.sentRecs[w.id] && !w.tags.some((t) => t.startsWith('sent/')))
    .map((w) => ({ kind: 'rec', key: `rec:${w.id}`, id: w.id, title: w.title, author: w.author, when: w.date, on: true }))
}
// 기록 하나 — 전체
export function recItem(k, w) {
  // date — 쓴 때를 같이 보낸다(받는 쪽이 받은 때가 아니라 쓴 때로 정리 차례를 세운다 · 지문에는 넣지 않는다)
  return { title: w.title.slice(0, 200), body: w.body, sha: sha16(`${k.id}\nrec\n${w.id}`), ...(w.date ? { date: w.date } : {}) }
}
// 문서 하나 — 전체(머리글 · 항목 모두)
export function docItem(k, d) {
  const body = [clean(d.intro), ...d.sections.filter((s) => s.h).map((s) => `## ${s.h}\n${clean(s.body)}`)].filter(Boolean).join('\n\n')
  return { title: `${d.title}: 문서 전체`.slice(0, 200), body, sha: sha16(`${k.id}\n${d.path}\n${marks(d).sha}\nall`) }
}

// 받는 쪽 기록 한도(200,000자) 안으로 — 넘는 글은 항목(## 머리)마다 묶어 나누고 · 항목 하나가 넘으면 글자로 자른다(제목 끝 (1/n))
//   「○○에서 보냄」 줄이 붙으니 한도보다 조금 작게. 조각의 지문은 원래 지문 + 자리 — 같은 글을 다시 보내면 받는 쪽에서 0
export const ITEM_MAX = 190_000
export function split(it, max = ITEM_MAX) {
  if (it.body.length <= max) return [it]
  const parts = []
  let cur = ''
  for (const b of it.body.split(/\n(?=## )/)) {
    if (b.length > max) {
      if (cur) parts.push(cur)
      cur = ''
      for (let i = 0; i < b.length; i += max) parts.push(b.slice(i, i + max))
    } else if (cur && cur.length + 1 + b.length > max) {
      parts.push(cur)
      cur = b
    } else cur = cur ? `${cur}\n${b}` : b
  }
  if (cur) parts.push(cur)
  return parts.map((body, i) => {
    const tail = ` (${i + 1}/${parts.length})`
    return { title: it.title.slice(0, 200 - tail.length) + tail, body, sha: sha16(`${it.sha}\n${i + 1}/${parts.length}`), ...(it.date ? { date: it.date } : {}) }
  })
}

// 보낼 글 하나 — 바뀐 항목만(새 문서면 모든 항목)
export function itemOf(k, q) {
  const d = k.byDocPath.get(q.path)
  const body = q.heads.map((h) => `## ${h}\n${clean(d.sections.find((s) => s.h === h)?.body)}`).join('\n\n')
  const title = q.isNew ? `${d.title}: 새 문서` : `${d.title}: ${q.heads.join(' · ')}`
  return { title: title.slice(0, 200), body, sha: sha16(`${k.id}\n${q.path}\n${q.sha}`) }
}

// 다른 kmd 로 — 기기 열쇠(Bearer). 닿지 않으면 throw(호출하는 쪽이 wait 에 둔다)
//   닿지 않음(연결 · 시간 넘김 · 5xx) → reach: false(저절로 다시) · 받는 쪽이 거절(4xx) → reach: true · status · code(사람이 고친다)
//   시간 제한은 묶음 크기에 맞춘다(받는 쪽은 기록마다 저장 · git 묶음을 한다 — 늦게 끝나도 같은 지문이라 다시 보내면 0)
//   저장 속도 한도(429 E_RATE · S-D28)는 실패가 아니다 — Retry-After 만큼 쉬고 다시(S12 · S-D36 · 다섯 번까지 · 한 번 쉼은 2분 안)
export const RATE_TRIES = 5
export const RATE_WAIT_MAX = 120_000
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
export async function post(url, kn, payload, key, { timeoutMs = null, path = 'receive', rateTries = RATE_TRIES } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await postOnce(url, kn, payload, key, { timeoutMs, path })
    } catch (e) {
      if (e.status !== 429 || e.code !== 'E_RATE' || i + 1 >= rateTries) throw e
      await sleep(Math.min(RATE_WAIT_MAX, Math.max(1, e.retryAfter || 1) * 1000))
    }
  }
}
async function postOnce(url, kn, payload, key, { timeoutMs = null, path = 'receive' } = {}) {
  const ac = new AbortController()
  const n = Array.isArray(payload?.items) ? payload.items.length : 1
  const t = setTimeout(() => ac.abort(), timeoutMs ?? Math.min(180_000, 15_000 + 3_000 * n))
  try {
    const r = await fetch(`${url}/api/k/${encodeURIComponent(kn)}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(payload), signal: ac.signal }).catch((e) => {
      throw Object.assign(new Error(e.name === 'AbortError' ? '팀 서버가 제때 답하지 않았다' : '팀 서버에 닿지 않는다'), { reach: false })
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j?.message || j?.error?.message || `HTTP ${r.status}`), { status: r.status, code: typeof j?.error === 'string' ? j.error : null, reach: r.status < 500, ...(r.status === 429 ? { retryAfter: Number(r.headers.get('retry-after')) || Number(j?.details?.retryAfter) || 1 } : {}), ...(j?.details ? { details: j.details } : {}) })
    return j
  } finally {
    clearTimeout(t)
  }
}

// 팀 MCP 도구 부르기(S12 · 보내기의 재료) — 기기 열쇠 · JSON-RPC tools/call. calls: [{ tool, args }] 를 한 번에(서버 묶음은 20 안)
//   도구가 거절하면(isError) 그 줄은 { error, message } · 닿지 않음 · 401 은 throw(post 와 같은 reach · status)
export async function mcpCalls(url, key, calls, { timeoutMs = 30_000 } = {}) {
  const out = []
  for (let i = 0; i < calls.length; i += 20) {
    const part = calls.slice(i, i + 20)
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const body = part.map((c, j) => ({ jsonrpc: '2.0', id: i + j + 1, method: 'tools/call', params: { name: c.tool, arguments: c.args || {} } }))
      const r = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), signal: ac.signal }).catch((e) => {
        throw Object.assign(new Error(e.name === 'AbortError' ? '팀 서버가 제때 답하지 않았다' : '팀 서버에 닿지 않는다'), { reach: false })
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw Object.assign(new Error(j?.message || (typeof j?.error === 'string' ? j.error : j?.error?.message) || `HTTP ${r.status}`), { status: r.status, code: typeof j?.error === 'string' ? j.error : null, reach: r.status < 500 })
      const byId = new Map((Array.isArray(j) ? j : [j]).filter(Boolean).map((x) => [x.id, x]))
      for (const [j2] of part.entries()) {
        const x = byId.get(i + j2 + 1)
        if (!x || x.error) out.push({ error: 'E_MCP', message: x?.error?.message || '팀 서버가 답하지 않았다' })
        else out.push(x.result?.structuredContent ?? {})
      }
    } finally {
      clearTimeout(t)
    }
  }
  return out
}
export async function mcpCall(url, key, tool, args) {
  const [r] = await mcpCalls(url, key, [{ tool, args }])
  return r
}
// 거절의 까닭 → 고칠 곳(사람이 읽는 한 줄)
export function fixOf(e) {
  if (e.status === 401) return '이 PC 의 열쇠를 팀이 받지 않는다. 팀 화면 › 설치 한 줄로 다시 잇는다'
  if (e.status === 403) return '그 팀 지식에 보낼 수 없다. 팀 지식의 주인 · 관리자에게'
  if (e.status === 404) return '팀에 그 지식이 없다. 보낼 곳을 다시 고른다'
  if (e.status === 409) return '팀 지식이 백업 뒤에 멈춰 있다. 관리자가 맞춘 뒤 [다시]'
  return '보낼 곳 · 글을 확인하고 [다시]'
}
// 나눠 보내기 — 받는 쪽 한 번에 200 개 · 8MB 까지 → 150 개 · 6MB 로 자른다
export function chunks(items, { max = 150, bytes = 6 << 20 } = {}) {
  const out = []
  let cur = []
  let size = 0
  for (const it of items) {
    const b = Buffer.byteLength(JSON.stringify(it))
    if (cur.length && (cur.length >= max || size + b > bytes)) { out.push(cur); cur = []; size = 0 }
    cur.push(it)
    size += b
  }
  if (cur.length) out.push(cur)
  return out
}
