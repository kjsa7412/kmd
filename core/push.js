// 팀으로 보내는 폴더 — 내 PC 프로그램이 이 PC 의 폴더를 지켜보다 바뀐 것만 팀 지식으로 보낸다(감시 검토 v0.1 단계 2 · 결정 ④).
//
//   허락     팀 관리자가 「내 PC 폴더」 를 더하면 그 지식 · 그 이름에만 묶인 기계 열쇠가 한 번 나온다 → PC 화면에 열쇠와 폴더를 넣는다
//   선언     무엇을(문서 · 라이브러리 버전 · 표 파일) · 어디로는 팀이 정한다 — 돌 때마다 팀에 묻는다(`GET /api/k/<지식>/pcdecl`)
//   보내기   문서 — 바뀐 파일 자체(`POST …/watched` · 300 파일 · 150MB 씩) · 팀이 문서로 바꾼다
//            코드 — 이 PC 에서 규칙으로 표를 만들어(바뀐 파일만 다시) 표만 보낸다(`POST …/baseline`) — 코드는 팀으로 가지 않는다
//   장부     `<data>/watch/_push/…` — 보내기가 끝났을 때만 적는다(닿지 않으면 다음에 같은 바뀐 것을 다시 보낸다)
//   목록     `<data>/pushes.json` [{ id, team, kn, knName, name, mode, folder, at }] · 열쇠는 비밀 `push/<id>`

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { readLedger, writeLedger, dropLedger, scanFolder, changeCount } from './watch.js'
import { wantDoc } from './docwatch.js'
import { wantOf, rulesOut, pushItems } from './sources.js'
import { getSecret, setSecret, delSecret } from './secrets.js'
import { KmdError } from './errors.js'

const LIST = (dataDir) => path.join(dataDir, 'pushes.json')
const STATE = (dataDir) => path.join(dataDir, 'pushes-state.json')
export const listPushes = (dataDir) => fs.readFile(LIST(dataDir), 'utf8').then(JSON.parse, () => [])
const saveList = async (dataDir, l) => { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(LIST(dataDir), JSON.stringify(l, null, 1)) }
export const readPushState = (dataDir) => fs.readFile(STATE(dataDir), 'utf8').then(JSON.parse, () => ({}))
const savePushState = async (dataDir, st) => { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(STATE(dataDir), JSON.stringify(st)) }
const keyName = (id) => `push/${id}`

async function call(team, p, key, body = null) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 120_000)
  try {
    const r = await fetch(team + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new KmdError(j.error || 'E_INPUT', j.message || `팀이 받지 않았다 — ${r.status}`)
    return j
  } catch (e) {
    if (e instanceof KmdError) throw e
    throw new KmdError('E_SOURCE', '팀 서버에 닿지 않는다')
  } finally {
    clearTimeout(t)
  }
}

// 더하기 — 열쇠로 팀에 물어 무엇 · 어디로를 받아 둔다
export async function addPush(dataDir, { team, key, folder }) {
  let origin
  try { origin = new URL(String(team || '')).origin } catch { throw new KmdError('E_INPUT', '팀 주소가 아니다') }
  if (!/^kmdm_/.test(String(key || ''))) throw new KmdError('E_INPUT', '열쇠가 아니다 — 팀 관리자가 「내 PC 폴더」 를 더할 때 나온 열쇠')
  const full = path.resolve(String(folder || ''))
  if (!path.isAbsolute(String(folder || '')) || !(await fs.stat(full).then((s) => s.isDirectory(), () => false))) throw new KmdError('E_NOTFOUND', '그 폴더가 없다')
  // 열쇠에는 지식이 들어 있지 않으므로 팀의 「내 PC 폴더」 목록을 열쇠로 물어 찾는다
  const who = await call(origin, '/api/pcwho', key)
  const decl = await call(origin, `/api/k/${encodeURIComponent(who.kn)}/pcdecl`, key)
  const list = await listPushes(dataDir)
  if (list.some((p) => p.team === origin && p.kn === decl.kn && p.name === decl.name)) throw new KmdError('E_CONFLICT', '이미 이어 둔 폴더다')
  const id = crypto.randomBytes(5).toString('hex')
  await setSecret(dataDir, keyName(id), key)
  const p = { id, team: origin, kn: decl.kn, knName: decl.knName, name: decl.name, mode: decl.mode, folder: full, at: new Date().toISOString() }
  await saveList(dataDir, [...list, p])
  return p
}
export async function removePush(dataDir, id) {
  await saveList(dataDir, (await listPushes(dataDir)).filter((p) => p.id !== id))
  await delSecret(dataDir, keyName(id)).catch(() => {})
  await dropLedger(dataDir, '_push', id).catch(() => {})
  const st = await readPushState(dataDir)
  delete st[id]
  await savePushState(dataDir, st)
}

// 한 번 — 바뀐 것만 보낸다 · { state, files, docs?, tables? }
export async function runPush(dataDir, p, { full = false, onProgress = null } = {}) {
  const st = await readPushState(dataDir)
  const s0 = (st[p.id] ||= {})
  const now = new Date().toISOString()
  try {
    const key = await getSecret(dataDir, keyName(p.id))
    if (!key) throw new KmdError('E_AUTH', '열쇠가 없다 — 다시 이어 붙인다')
    const decl = await call(p.team, `/api/k/${encodeURIComponent(p.kn)}/pcdecl`, key)
    const L = await readLedger(dataDir, '_push', p.id)
    const first = !Object.keys(L.files || {}).length
    const host = os.hostname()
    let res
    if (decl.mode === 'docs') {
      const scan = await scanFolder(p.folder, L, { want: wantDoc, maxFile: 32 << 20, full, onProgress })
      const n = changeCount(scan.changes)
      if (!n && !full) res = { state: 'same', files: 0 }
      else {
        // 300 파일 · 150MB 씩 — 지운 것은 마지막 묶음에
        const todo = [...scan.changes.added, ...scan.changes.changed]
        let docs = 0
        let missing = 0
        let i = 0
        do {
          const batch = []
          let bytes = 0
          while (i < todo.length && batch.length < 300 && bytes < 150 << 20) {
            const data = await scan.readBuf(todo[i])
            bytes += data.length
            batch.push({ path: todo[i], b64: data.toString('base64') })
            i++
          }
          const last = i >= todo.length
          const r = await call(p.team, `/api/k/${encodeURIComponent(p.kn)}/watched`, key, { files: batch, removed: last ? scan.changes.removed : [], host, first })
          if (r.state === 'stopped') throw new KmdError('E_STOPPED', `팀에서 멈췄다 — 문서 ${r.vanished}개가 한꺼번에 사라졌다 · 관리자가 확인한다`)
          docs += r.docs || 0
          missing += r.missing || 0
        } while (i < todo.length)
        res = { state: docs || missing ? 'changed' : 'same', files: n, docs, missing }
      }
      await writeLedger(dataDir, '_push', p.id, { ...L, files: scan.files })
    } else {
      const src = { name: decl.name, rules: decl.rules }
      const scan = await scanFolder(p.folder, L, { want: wantOf(src), full, onProgress })
      const n = changeCount(scan.changes)
      const all = first || full || L.rules !== JSON.stringify(decl.rules) || !L.out
      if (!n && !all) res = { state: 'same', files: 0 }
      else {
        const out = await rulesOut(src, scan, L.out || {}, { all })
        const r = await call(p.team, `/api/k/${encodeURIComponent(p.kn)}/baseline`, key, { source: decl.name, items: pushItems(src, out.items), host, files: n })
        res = { state: r.changed ? 'changed' : 'same', files: n, tables: r.changed || 0 }
        await writeLedger(dataDir, '_push', p.id, { v: 1, files: scan.files, out: out.cache, rules: JSON.stringify(decl.rules) })
      }
      if (res.state === 'same' && !n) await writeLedger(dataDir, '_push', p.id, { ...L, files: scan.files })
    }
    const real = full ? 0 : res.files
    Object.assign(s0, { checkedAt: now, failures: 0, failingSince: null, mode: decl.mode, lastNote: res.state === 'changed' ? (decl.mode === 'docs' ? `보냈다 — 문서 ${res.docs}${res.missing ? ' · 원본에 없다 ' + res.missing : ''}` : `보냈다 — 바뀐 표 ${res.tables}`) : full ? '다시 맞춤 — 그대로' : '그대로', ...(res.state === 'changed' ? { lastChange: { at: now, files: real, docs: res.docs || 0, tables: res.tables || 0, removed: res.missing || 0 } } : {}) })
    await savePushState(dataDir, st)
    return res
  } catch (e) {
    s0.failures = (s0.failures || 0) + 1
    s0.failingSince ||= now
    s0.lastNote = e.message
    await savePushState(dataDir, st)
    return { state: 'failed', why: e.message }
  }
}
