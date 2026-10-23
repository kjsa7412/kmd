// 오늘 바뀐 것 — 사람마다의 줄(`<data>/feed/<사람>.json` · 7일 · 200줄).
//
// 노란 줄(yl)은 「kmd 가 값을 바꿨다」 처럼 그 사람이 알아야 하는 것 — 그 기록을 쓴 사람에게 간다(정리하는 사람이 아니라).
// 노란 줄은 다음 Claude Code 대화의 첫 안내(brief)에도 한 번 실린다(실리면 briefed).

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const fileOf = (dataDir, user) => path.join(dataDir, 'feed', `${encodeURIComponent(String(user).toLowerCase())}.json`)
const KEEP_MS = 7 * 864e5
const locks = new Map()
const serial = (key, f) => {
  const run = (locks.get(key) || Promise.resolve()).then(f, f)
  locks.set(key, run.catch(() => {}))
  return run
}

async function load(dataDir, user) {
  const all = await fs.readFile(fileOf(dataDir, user), 'utf8').then(JSON.parse, () => [])
  const cut = Date.now() - KEEP_MS
  return all.filter((x) => Date.parse(x.at) >= cut)
}
async function store(dataDir, user, all) {
  const f = fileOf(dataDir, user)
  await fs.mkdir(path.dirname(f), { recursive: true })
  await fs.writeFile(f + '.tmp', JSON.stringify(all.slice(0, 200)), { mode: 0o600 })
  await fs.rename(f + '.tmp', f)
}

export function add(dataDir, user, entry) {
  if (!user) return Promise.resolve()
  return serial(fileOf(dataDir, user), async () => {
    const all = await load(dataDir, user)
    all.unshift({ id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), ...entry })
    await store(dataDir, user, all)
  })
}
export const list = (dataDir, user) => load(dataDir, user)

// 아직 대화에 안 실린 노란 줄 — 실으면 표시
export function takeNotices(dataDir, user) {
  return serial(fileOf(dataDir, user), async () => {
    const all = await load(dataDir, user)
    const out = all.filter((x) => (x.yl || x.brief) && !x.briefed)
    if (out.length) {
      for (const x of out) x.briefed = true
      await store(dataDir, user, all)
    }
    return out
  })
}
export function mark(dataDir, user, id, patch) {
  return serial(fileOf(dataDir, user), async () => {
    const all = await load(dataDir, user)
    const x = all.find((e) => e.id === id)
    if (x) Object.assign(x, patch)
    await store(dataDir, user, all)
    return x
  })
}
