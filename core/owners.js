// 주인 장부 — 지식마다 주인 · 개인 · 정리하는 사람 · 되살림 표지.
//
// `<data>/owners.json { knowledge: { <지식>: { owner, private, curators, restored, at } } }` — 서버에 하나.
// 줄이 없는 지식은 팀 지식이다(들어온 사람 모두 읽고 기록한다). 줄이 있으면 두 겹을 더한다:
//
//   private   주인만 본다 — 관리자의 「모두」 도 가린다(화면 · 찾기 · MCP 가 같은 판정 한 곳)
//   restored  git 으로 되살린 지식 — 주인을 알기 전까지 관리자만 본다(`_members.md` 를 읽어 다시 건다)
//
// 깨진 장부는 빈 것으로 읽지 않는다 — 빈 것이면 가림이 모두 풀린다. 서버가 뜨지 않는다.
// 가림은 화면과 API 뿐이다 — 「팀 서버에 둔 내 지식은 서버 관리자가 디스크로 볼 수 있다」.

import fs from 'node:fs/promises'
import path from 'node:path'

export const RESERVED_FILES = ['_members.md', '_format.json', '_sources.json']
export const isReservedFile = (f) => RESERVED_FILES.includes(String(f ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').split('/').pop().toLowerCase())

const fileOf = (dataDir) => path.join(dataDir, 'owners.json')

export async function load(dataDir) {
  const text = await fs.readFile(fileOf(dataDir), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
  if (text == null) return { knowledge: {} }
  let j
  try {
    j = JSON.parse(text)
  } catch (e) {
    throw new Error(`owners.json 이 깨졌다 — ${e.message} · 고치거나 지운 뒤 다시 띄운다`)
  }
  if (!j || typeof j !== 'object' || typeof (j.knowledge ?? {}) !== 'object') throw new Error('owners.json 의 모양이 아니다 — { knowledge: { … } }')
  return { knowledge: j.knowledge || {} }
}

export async function store(dataDir, reg) {
  await fs.mkdir(dataDir, { recursive: true })
  const f = fileOf(dataDir)
  await fs.writeFile(f + '.tmp', JSON.stringify(reg, null, 1) + '\n')
  await fs.rename(f + '.tmp', f)
}

// 그 사람이 그 지식을 보나 — ctx { user, admin }
export function visible(reg, id, ctx = {}) {
  const e = reg?.knowledge?.[id]
  if (!e) return true
  if (e.restored && !e.owner) return !!ctx.admin
  if (e.private && e.owner !== ctx.user) return false
  return true
}

export const rowOf = (reg, id) => reg?.knowledge?.[id] || null

export function setOwner(reg, id, { owner = null, private: priv, curators } = {}) {
  const prev = reg.knowledge[id] || {}
  const row = { ...prev, owner: owner ?? prev.owner ?? null, private: priv ?? prev.private ?? false, curators: curators ?? prev.curators ?? [], at: new Date().toISOString() }
  if (row.owner) delete row.restored
  reg.knowledge[id] = row
  return row
}

export function markRestored(reg, id) {
  reg.knowledge[id] = { ...(reg.knowledge[id] || {}), restored: true, at: new Date().toISOString() }
  return reg.knowledge[id]
}

// `_members.md` — 지식 안의 사람 칸(예약 파일)
//   - 주인: kim · - 개인: 예 · - 정리: park, lee
export function parseMembers(text) {
  const out = { owner: null, private: false, curators: [] }
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(주인|개인|정리)\s*[:：]\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (m[1] === '주인') out.owner = m[2] || null
    else if (m[1] === '개인') out.private = /^(예|네|yes|true|1)$/i.test(m[2])
    else out.curators = m[2].split(/[,\s·]+/).filter(Boolean)
  }
  return out
}
export function renderMembers({ owner = null, private: priv = false, curators = [] } = {}) {
  return ['# 사람', '', `- 주인: ${owner || ''}`, `- 개인: ${priv ? '예' : '아니오'}`, `- 정리: ${curators.join(', ')}`, ''].join('\n')
}

// 되살린 지식 — `_members.md` 로 주인 · 개인을 다시 걸고, 주인이 없으면 관리자만 보게 남긴다
export async function adoptMembers(reg, id, dir) {
  const text = await fs.readFile(path.join(dir, '_members.md'), 'utf8').catch(() => null)
  const m = text ? parseMembers(text) : null
  if (m?.owner) return setOwner(reg, id, { owner: m.owner, private: m.private, curators: m.curators })
  return markRestored(reg, id)
}
