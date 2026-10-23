// 보내기 — 내 지식에서 고친 것을 보낼 곳(팀 지식)으로(v0.3 V5 · M10).
//
// 보낼 곳은 지식 폴더의 `.kmd.json` { send: [{ kn, url? }] } — url 이 없으면 같은 kmd(save 하나), 있으면 그 kmd 로
// 기기 열쇠 HTTP(`POST <url>/api/k/<kn>/receive`). 닿지 않으면 `<data>/send/<지식>.json` 의 wait 에 두고 닿을 때 저절로.
// 보낼 것 = 보낸 뒤(또는 보낼 곳을 정한 뒤) 바뀐 문서 — 항목마다 지문을 견줘 바뀐 항목만 글로 싣는다.
// 받는 쪽은 기록 하나(태그 `sent/<지문>` — 같은 것을 두 번 받으면 0) · 이름은 받는 지식의 이름 장부로 정확히 맞는 것만.

import fs from 'node:fs/promises'
import path from 'node:path'
import { sha16 } from './text.js'
import { KmdError } from './errors.js'

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
  return (Array.isArray(c.send) ? c.send : []).filter((d) => d && typeof d.kn === 'string' && d.kn).map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}) }))
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
  return { sent: s.sent || {}, dropped: s.dropped || {}, wait: s.wait || [], log: s.log || [] }
}
export async function writeState(dataDir, id, st) {
  await fs.mkdir(path.join(dataDir, 'send'), { recursive: true })
  const f = stateFile(dataDir, id)
  await fs.writeFile(f + '.tmp', JSON.stringify({ ...st, log: st.log.slice(0, 30) }))
  await fs.rename(f + '.tmp', f)
}

// 문서의 지문 — 항목마다(저절로 채우는 표 · applied 표지는 빼고 견준다)
const clean = (b) => String(b || '').replace(/<!--\s*applied:[^>]*-->/g, '').trim()
export function marks(d) {
  const secs = {}
  for (const s of d.sections) if (s.h) secs[s.h] = sha16(clean(s.body))
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
    out.push({ doc: d.id, path: d.path, title: d.title, heads, isNew: !prev, sha: m.sha, on: st.dropped[d.path] !== m.sha, when: d.mtime })
  }
  return out.sort((a, b) => String(b.when).localeCompare(String(a.when)))
}

// 보낼 글 하나 — 바뀐 항목만
export function itemOf(k, q) {
  const d = k.byDocPath.get(q.path)
  const body = q.heads.map((h) => `## ${h}\n${clean(d.sections.find((s) => s.h === h)?.body)}`).join('\n\n')
  const title = q.isNew ? `${d.title} — 새 문서` : `${d.title} — ${q.heads.join(' · ')}`
  return { title: title.slice(0, 200), body, sha: sha16(`${k.id}\n${q.path}\n${q.sha}`) }
}

// 다른 kmd 로 — 기기 열쇠(Bearer). 닿지 않으면 throw(호출하는 쪽이 wait 에 둔다)
export async function post(url, kn, payload, key, { timeoutMs = 10_000 } = {}) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(`${url}/api/k/${encodeURIComponent(kn)}/receive`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(payload), signal: ac.signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j?.error?.message || `HTTP ${r.status}`), { status: r.status })
    return j
  } finally {
    clearTimeout(t)
  }
}
