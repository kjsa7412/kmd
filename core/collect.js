// 거두기 — 편집기로 직접 고친 문서를 30초 고요 뒤 저장 한 번으로 들인다(KM32).
//
//   docs/ 의 md(고침 · 새 파일 · 지움)  → 고친 기록 하나(태그 edit · 작성자 그 PC 사용자) + 바뀐 항목에 그 기록의 표지 + git 한 묶음
//   work/ · log/ 의 손 고침             → 원래대로 되돌린다(기록은 고치지 않는다 — 바로잡으려면 바로잡는 기록을 쓴다)
//   _vocab.md · _managed.md 손 고침       → 되돌리고 알린다(장부는 kmd 가 쓴다)
//
// 감시는 지식 폴더마다 하나(fs.watch 재귀). kmd 자신이 쓰는 동안의 변화는 save 뒤 git 이 깨끗하니 저절로 빠진다.
// 같은 폴더를 두 kmd 가 거두지 않게 `.git/kmd-collect.lock`(설치 id · pid)을 잡는다.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { tryGit, git, commitPaths } from './git.js'
import { readText, nfc } from './text.js'
import { parseDoc, replaceSection, headingMatches } from './sections.js'
import { parseRegistry, locate } from './registry.js'
import { parseVocab } from './vocab.js'
import { renderRecord } from './frontmatter.js'
import { localStamp, recordTakenSync } from './save.js'
import { watchedOf } from './watchmark.js'

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
export async function collectNow(dir, { user, save }) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null
  if (!(await lock(dir))) return null
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
    if (/^(work|log)\//.test(f.path) || f.path === '_vocab.md' || f.path === '_managed.md') {
      if (f.code.includes('?')) continue // 새로 만든 기록 파일은 건드리지 않는다
      await rescue(f.path, /^(work|log)\//.test(f.path) ? '기록 · 이력은 고치지 않는다. 바로잡으려면 바로잡는 기록을 남긴다' : '이름 · 자리 장부는 kmd 가 쓴다. 화면의 이름 세우기로')
      await tryGit(dir, ['checkout', '--', f.path])
      reverted.push(f.path)
    }
  }
  // 원본이 주인인 문서(문서 감시가 단 것) — 편집기 손 고침은 되돌린다(고치려면 원본 파일을 고친다)
  for (const f of files) {
    if (!/^docs\/.+\.md$/i.test(f.path) || f.code.includes('?')) continue
    const head = (await tryGit(dir, ['show', `HEAD:${f.path}`])).out
    const w = watchedOf(head)
    if (w) {
      await rescue(f.path, `원본이 주인인 문서다: ${w.src} 의 ${w.path} 를 고친다`)
      await tryGit(dir, ['checkout', '--', f.path])
      reverted.push(f.path)
    }
  }
  const docs = files.filter((f) => /^docs\/.+\.md$/i.test(f.path) && !reverted.includes(f.path)).map((f) => f.path)
  if (!docs.length) return reverted.length ? { reverted, rescued } : null
  // 바뀐 항목 — HEAD 의 글과 지금 글을 항목마다 견준다
  const reg = parseRegistry(await fsp.readFile(path.join(dir, '_managed.md'), 'utf8').then(readText, () => ''))
  const vocab = parseVocab(await fsp.readFile(path.join(dir, '_vocab.md'), 'utf8').then(readText, () => ''))
  const touched = []
  const heads = []
  for (const p of docs) {
    const now = await fsp.readFile(path.join(dir, ...p.split('/')), 'utf8').then(readText, () => null)
    const old = await git(dir, ['show', `HEAD:${p}`]).then(readText, () => null)
    const a = old ? parseDoc(old, '').sections : []
    const b = now ? parseDoc(now, '').sections : []
    for (const s of b) {
      const o = a.find((x) => x.h === s.h)
      if (o && o.body === s.body) continue
      heads.push({ p, h: s.h })
      for (const c of new Set([...vocab.coords.keys()])) {
        const loc = locate(reg, c)
        if (loc && loc.doc === p && headingMatches(s.h, loc.heading) && !touched.includes(c)) touched.push(c)
      }
    }
  }
  const title = `편집기에서 고침: ${docs.map((p) => path.basename(p, '.md')).slice(0, 3).join(' · ')}${docs.length > 3 ? ` 외 ${docs.length - 3}` : ''}`
  const body = heads.length ? heads.map((x) => `- ${x.p.replace(/^docs\/|\.md$/g, '')} › ${x.h}`).join('\n') : docs.map((p) => `- ${p}`).join('\n')
  // 저장 — 기록 하나 · 바뀐 항목에 그 기록의 표지(자기 반영 — 아직 안 넣은 기록이 생기지 않는다)
  return { ...(await save({ title, body, touches: touched, heads, docs, reverted })), reverted, rescued }
}

// 저장 한 번(collectNow 의 save 로 쓴다) — 고친 파일은 손댄 글 그대로 두고 표지만 붙인다
export async function writeCollect(dir, { user, title, body, touches, heads, docs }) {
  const date = localStamp()
  const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
  let id = `${day}-편집기에서-고침`
  for (let n = 2; recordTakenSync(dir, id); n++) id = `${day}-편집기에서-고침-${n}`
  // 이력(log/) — 편집기로 바로 고친 일은 기록이 아니다(글은 이미 문서에 있다)
  await fsp.mkdir(path.join(dir, 'log'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'log', `${id}.md`), renderRecord({ id, title, date, author: user, touches, tags: ['edit'] }, body), 'utf8')
  for (const p of docs) {
    const full = path.join(dir, ...p.split('/'))
    let t = await fsp.readFile(full, 'utf8').then(readText, () => null)
    if (t == null) continue
    for (const x of heads.filter((h) => h.p === p)) {
      const sec = parseDoc(t, '').sections.find((s) => s.h === x.h)
      if (sec) t = replaceSection(t, { heading: x.h, body: sec.body, applied: id })
    }
    await fsp.writeFile(full, t, 'utf8')
  }
  // 지운 문서도 같은 묶음에(git add 가 지움을 싣는다)
  const commit = await commitPaths(dir, [`log/${id}.md`, ...docs], title, user)
  return { id, commit, docs }
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
