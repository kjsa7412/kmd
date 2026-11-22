// 손으로 고친 파일: 편집기로 직접 고친 지식 폴더를 30초 고요 뒤 살핀다(H6 · H-D33 · H-D37: 옛 거두기는 걷었다).
//
//   docs/ 의 md(고침 · 새 파일 · 지움)  → 글을 들이지 않는다. 고친 글을 「손으로 고친 파일」 목록(.git/kmd-hand)에 두고 문서는 되돌린다
//                                       (지식관리자가 「넣을 것으로 올리기」 · 「버리기」 를 고른다)
//   work/ · log/ 의 손 고침             → 원래대로 되돌린다(기록은 고치지 않는다 · 바로잡으려면 바로잡는 기록을 쓴다)
//   _vocab.md · _managed.md · _forms.md · _members.md 손 고침 → 되돌리고 사본을 둔다(장부는 kmd 가 쓴다)
//
// 감시는 지식 폴더마다 하나(fs.watch 재귀). kmd 자신이 쓰는 동안의 변화는 save 뒤 git 이 깨끗하니 저절로 빠진다.
// 같은 폴더를 두 kmd 가 살피지 않게 `.git/kmd-collect.lock`(설치 id · pid)을 잡는다.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { tryGit, git } from './git.js'
import { readText, nfc } from './text.js'
import { parseDoc } from './sections.js'
import { localStamp } from './save.js'
import { recover, writeAtomic } from './journal.js'

let cfg = { quietMs: 30_000 }
export function configure(o) {
  cfg = { ...cfg, ...o }
}
const INSTALL = crypto.randomBytes(6).toString('hex')

// git 이 본 바뀐 파일 — 작업 트리 기준(스테이징과 무관)
async function changed(dir) {
  const r = await tryGit(dir, ['status', '--porcelain', '-uall', '-z'])
  if (!r.ok) return []
  return r.out.split('\0').filter(Boolean).map((x) => ({ code: x.slice(0, 2), path: nfc(x.slice(3)) }))
}

async function lock(dir) {
  const f = path.join(dir, '.git', 'kmd-collect.lock')
  try {
    const cur = JSON.parse(await fsp.readFile(f, 'utf8'))
    if (cur.install !== INSTALL && cur.pid !== process.pid) {
      let alive = true
      try {
        process.kill(cur.pid, 0)
      } catch {
        alive = false
      }
      if (alive && Date.now() - cur.at < 10 * 60_000) return false
    }
  } catch {}
  await fsp.writeFile(f, JSON.stringify({ install: INSTALL, pid: process.pid, at: Date.now() })).catch(() => {})
  return true
}

// 한 번 거둔다 — { record, docs, reverted } 또는 null(거둘 것 없음)
export async function collectNow(dir, { user }) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null
  if (!(await lock(dir))) return null
  // 꺼지며 남은 반쯤 쓴 저장은 먼저 되돌린다 — kmd 가 쓰다 만 글을 사람의 고침으로 들이지 않게
  await recover(dir)
  const files = await changed(dir)
  if (!files.length) return null
  const reverted = []
  // 되돌리기 전에 손 고침의 사본을 둔다(.git/kmd-rescued/ — 글을 잃지 않게 · 화면 「이력」 이 그 자리를 알린다)
  const rescued = []
  const rescue = async (p, why) => {
    const t = await fsp.readFile(path.join(dir, ...p.split('/')), 'utf8').catch(() => null)
    if (t == null) return
    const to = path.join(dir, '.git', 'kmd-rescued', `${localStamp().replace(/[^0-9]/g, '')}-${p.replace(/[\\/]/g, '_')}`)
    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.writeFile(to, t, 'utf8')
    rescued.push({ path: p, copy: to, why })
  }
  for (const f of files) {
    //   사람 칸(_members.md · 개인 지식의 저장 방식 표지)도 kmd 가 쓴다 — 손 고침으로 제안 의무가 풀리지 않게(저장 승인 PC1)
    if (/^(work|log)\//.test(f.path) || f.path === '_vocab.md' || f.path === '_managed.md' || f.path === '_forms.md' || f.path === '_members.md') {
      if (f.code.includes('?')) continue // 새로 만든 기록 파일은 건드리지 않는다
      await rescue(f.path, /^(work|log)\//.test(f.path) ? '기록 · 이력은 고치지 않는다. 바로잡으려면 바로잡는 기록을 남긴다' : f.path === '_members.md' ? '사람 칸 · 저장 방식은 kmd 가 쓴다' : '항목 · 문서 · 갈래 장부는 kmd 가 쓴다. 항목 세우기 · 갈래 세우기(save 의 names · forms)로')
      await tryGit(dir, ['checkout', '--', f.path])
      reverted.push(f.path)
    }
  }
  const docs = files.filter((f) => /^docs\/.+\.md$/i.test(f.path) && !reverted.includes(f.path)).map((f) => f.path)
  if (!docs.length) return reverted.length ? { reverted, rescued } : null
  // 손으로 고친 문서(H6 · H-D33) — 글을 그대로 들이지 않는다. 고친 글의 사본을 두고 문서는 되돌린다(새 파일은 치운다).
  //   사본은 「손으로 고친 파일」 목록(.git/kmd-hand/index.json)에 서고, 지식관리자가 「원천으로 넣기」(공식 절차 · 저장 제안) 또는 「버리기」 를 고른다
  const hand = []
  for (const f of files.filter((x) => docs.includes(x.path))) {
    const full = path.join(dir, ...f.path.split('/'))
    const now = await fsp.readFile(full, 'utf8').then(readText, () => null)
    const old = await git(dir, ['show', `HEAD:${f.path}`]).then(readText, () => null)
    const kind = old == null ? 'new' : now == null ? 'del' : 'mod'
    const a = old ? parseDoc(old, '').sections : []
    const b = now ? parseDoc(now, '').sections : []
    const heads = b.filter((s) => { const o = a.find((x) => x.h === s.h); return !o || o.body !== s.body }).map((s) => ({ h: s.h, body: s.body }))
    const gone = a.filter((s) => !b.some((x) => x.h === s.h)).map((s) => s.h)
    if (kind === 'new') await fsp.rm(full, { force: true })
    else await tryGit(dir, ['checkout', '--', f.path])
    reverted.push(f.path)
    if (!heads.length && !gone.length && kind !== 'del') continue
    hand.push({ id: crypto.randomBytes(6).toString('hex'), path: f.path, kind, at: localStamp(), by: user, heads, gone })
  }
  if (hand.length) {
    const ix = path.join(dir, '.git', 'kmd-hand', 'index.json')
    await fsp.mkdir(path.dirname(ix), { recursive: true })
    const cur = await fsp.readFile(ix, 'utf8').then((t) => JSON.parse(t), () => [])
    await writeAtomic(ix, JSON.stringify([...(Array.isArray(cur) ? cur : []), ...hand].slice(-200), null, 1))
  }
  return { reverted, rescued, hand }
}

// 감시 — 바뀜이 오면 시계를 다시 건다 · 고요해지면 거둔다
export function watch(dir, run) {
  let timer = null
  let w = null
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(() => run().catch(() => {}), cfg.quietMs)
    timer.unref?.()
  }
  try {
    w = fs.watch(dir, { recursive: true }, (ev, f) => {
      const p = String(f || '').replace(/\\/g, '/')
      if (!p || p.startsWith('.git') || p.startsWith('.kmd')) return
      kick()
    })
  } catch {
    return { close() {} }
  }
  return {
    kick,
    close() {
      clearTimeout(timer)
      w?.close()
    },
  }
}

// 손으로 고친 파일(H6) — 목록 · 하나 빼기(.git/kmd-hand/index.json · 원자 쓰기)
export async function handList(dir) {
  const t = await fsp.readFile(path.join(dir, '.git', 'kmd-hand', 'index.json'), 'utf8').catch((e) => (e.code === 'ENOENT' ? '[]' : Promise.reject(e)))
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [] } catch { return [] }
}
export async function handTake(dir, id) {
  const all = await handList(dir)
  const x = all.find((y) => y.id === id)
  if (!x) return null
  await writeAtomic(path.join(dir, '.git', 'kmd-hand', 'index.json'), JSON.stringify(all.filter((y) => y.id !== id), null, 1))
  return x
}
// 손으로 고친 글 → 원천 글(공식 절차의 「넣을 것」) — 고친 항목의 새 글을 `##` 마다
//   사실만 싣는다(문서 · 사람이 쓴 머리와 글 · 까닭 · 없앤 머리). 어떻게 넣을지는 일 설명(hub.agentTask 의 문서 고치기 갈래 · 서버가 단 src.hand)이 정한다:
//   원천 글 안의 지시(「같은 머리 항목을 이 글대로 고친다 · 없는 머리는 새 항목」)가 생성 룰 R3-5(있는 항목의 값이면 그 항목)와 부딪혀 세션이 길게 망설였다(채널 평가 T14 · real-5 edit-source 425초)
export function handSource({ path: p, heads = [], gone = [], kind = 'mod' }, { title = null, why = '' } = {}) {
  const doc = String(p).replace(/^docs\//, '').replace(/\.md$/, '')
  return [
    `# 문서 고치기: ${title || doc}`,
    '',
    `- 문서: ${doc}`,
    `- 사람이 ${kind === 'new' ? '새로 쓴 문서' : '고친 글'}: 아래 \`##\` 마다 머리 하나와 그 글`,
    ...(why ? [`- 까닭: ${why}`] : []),
    '',
    ...heads.flatMap((x) => [`## ${x.h}`, '', String(x.body || '').trim(), '']),
    ...(gone.length ? ['## 없앤 항목', '', ...gone.map((h) => `- ${h}: 사람이 이 머리를 지웠다`), ''] : []),
  ].join('\n')
}
