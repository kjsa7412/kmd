// 주인 장부 — 지식마다 주인 · 정리하는 사람 · 되살림 표지. 팀 서버의 지식은 모두 팀 지식이다(개인 지식은 각자의 PC 에만).
//
// `<data>/owners.json { knowledge: { <지식>: { owner, curators, restored, at } } }` — 서버에 하나.
// 줄이 없는 지식도 팀 지식이다(들어온 사람 모두 읽고 기록한다). 옛 장부 · `_members.md` 의 「개인」 은 읽지 않는다.
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
  if (text == null) return { knowledge: {} }
  let j
  try {
    j = JSON.parse(text)
  } catch (e) {
    throw new Error(`owners.json 이 깨졌다: ${e.message} · 고치거나 지운 뒤 다시 띄운다`)
  }
  if (!j || typeof j !== 'object' || typeof (j.knowledge ?? {}) !== 'object') throw new Error('owners.json 의 모양이 아니다. { knowledge: { … } }')
  return { knowledge: j.knowledge || {} }
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

// 그 사람이 그 지식을 보나 — ctx { user, admin }
export function visible(reg, id, ctx = {}) {
  const e = reg?.knowledge?.[id]
  if (!e) return true
  if (e.restored && !e.owner) return !!ctx.admin
  return true
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
const MODE_WORD = { time: '정해진 시각', live: '실시간', manual: '손으로만' }
const YES = /^(예|네|yes|true|1)$/i
export function parseMembers(text) {
  const out = { owner: null, curators: [], settings: false }
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(주인|정리 방식|정리|Claude 에 보내지 않음)\s*[:：]\s*(.*?)\s*$/.exec(line)
    if (!m) continue
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
  return out
}
export function renderMembers({ owner = null, curators = [], tidyMode = 'time', tidyAt = null, noClaude = false } = {}) {
  return ['# 사람', '', `- 주인: ${owner || ''}`, `- 정리: ${curators.join(', ')}`, `- 정리 방식: ${MODE_WORD[tidyMode] || MODE_WORD.time}${(tidyMode || 'time') === 'time' && tidyAt ? ' ' + tidyAt : ''}`, `- Claude 에 보내지 않음: ${noClaude ? '예' : '아니오'}`, ''].join('\n')
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
  return false
}
