// 저장 저널 — 저장 하나가 쓰는 파일의 원래 글을 먼저 남기고 쓴다. 커밋까지 가면 지운다.
//
//   자리     <지식>/.git/kmd-saving-<pid>/ — journal.json { pid, at, head, files: [{ rel, had }] } · 원래 글은 <i>.bak
//   넘어짐   저장 중 오류 — undo() 가 원래 글로 되돌린다(새 파일은 지운다) · 스테이징도 푼다
//   꺼짐     프로세스가 죽거나 정전 — 다음에 그 지식을 저장 · 거두기할 때, 켤 때 recover() 가 같은 되돌리기를 한다.
//            커밋까지 가고 저널을 지우기 전에 꺼진 것(HEAD 가 바뀌었고 그 파일들이 깨끗하다)은 그대로 둔다.
//            되돌리기 전 지금 글은 .git/kmd-rescued/ 에 사본을 둔다(꺼진 사이 사람이 고친 글을 잃지 않게)
//            살아 있는 다른 kmd 의 저널(10분 안)은 건드리지 않는다
//   writeAtomic — 임시 파일에 쓰고 이름 바꾸기(정전에 반쯤 잘린 글이 남지 않게)
//
// 같은 지식의 저장은 save.serial 로 한 줄이다 — begin · recover 는 그 줄 안에서 부른다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { headSha, tryGit } from './git.js'

const PREFIX = 'kmd-saving-'
export const STALE_MS = 10 * 60_000

const tmpOf = (full, pid = process.pid) => path.join(path.dirname(full), `.${path.basename(full)}.${pid}.kmd-tmp`)
const fullOf = (dir, rel) => path.join(dir, ...rel.split('/'))

export async function writeAtomic(full, data) {
  const tmp = tmpOf(full)
  await fs.writeFile(tmp, data)
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(tmp, full)
    } catch (e) {
      // Windows — 편집기 · 백신이 잠깐 잡고 있으면 이름 바꾸기가 막힌다
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
      await new Promise((ok) => setTimeout(ok, 100))
    }
  }
}

// 저장 시작 — 남은 저널부터 되돌리고 새 저널을 연다. add(rel) 는 그 파일을 쓰기 전에 부른다
export async function begin(dir) {
  await recover(dir)
  const at = path.join(dir, '.git', `${PREFIX}${process.pid}`)
  await fs.mkdir(at, { recursive: true })
  const j = { pid: process.pid, at: Date.now(), head: await headSha(dir), files: [] }
  const put = () => writeAtomic(path.join(at, 'journal.json'), JSON.stringify(j))
  await put()
  return {
    async add(rel) {
      if (j.files.some((f) => f.rel === rel)) return
      const raw = await fs.readFile(fullOf(dir, rel)).catch(() => null)
      if (raw != null) await writeAtomic(path.join(at, `${j.files.length}.bak`), raw)
      j.files.push({ rel, had: raw != null })
      await put()
    },
    undo: () => rollback(dir, at, j),
    done: () => fs.rm(at, { recursive: true, force: true }).catch(() => {}),
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// 남은 저널을 되돌린다 — 되돌린 파일의 rel 목록
export async function recover(dir) {
  const out = []
  for (const n of await fs.readdir(path.join(dir, '.git')).catch(() => [])) {
    if (!n.startsWith(PREFIX)) continue
    const at = path.join(dir, '.git', n)
    const j = await fs.readFile(path.join(at, 'journal.json'), 'utf8').then(JSON.parse, () => null)
    // 저널을 적기 전에 꺼졌다 — 쓴 파일이 없다
    if (!j) {
      await fs.rm(at, { recursive: true, force: true })
      continue
    }
    if (j.pid !== process.pid && alive(j.pid) && Date.now() - j.at < STALE_MS) continue
    const rels = j.files.map((f) => f.rel)
    if (rels.length && (await headSha(dir)) !== j.head) {
      const st = await tryGit(dir, ['status', '--porcelain', '-uall', '--', ...rels])
      if (!st.ok) continue // 지금은 git 이 답하지 않는다 — 다음에
      if (!st.out.trim()) {
        await fs.rm(at, { recursive: true, force: true })
        continue
      }
    }
    await rollback(dir, at, j, { rescue: true })
    out.push(...rels)
  }
  return out
}

async function rollback(dir, at, j, { rescue = false } = {}) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  for (const [i, f] of j.files.entries()) {
    const full = fullOf(dir, f.rel)
    await fs.rm(tmpOf(full, j.pid), { force: true }).catch(() => {})
    const was = f.had ? await fs.readFile(path.join(at, `${i}.bak`)) : null
    const cur = await fs.readFile(full).catch(() => null)
    if (rescue && cur != null && !(was && cur.equals(was))) {
      const to = path.join(dir, '.git', 'kmd-rescued', `${stamp}-${f.rel.replace(/[\\/]/g, '_')}`)
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.writeFile(to, cur)
    }
    if (was) await writeAtomic(full, was)
    else await fs.rm(full, { force: true })
  }
  // 커밋 전에 git add 까지 갔으면 스테이징에 남는다 — 그 파일만 푼다(HEAD 가 아직 없는 저장소면 할 것이 없다)
  for (const f of j.files) await tryGit(dir, ['reset', '-q', '--', f.rel])
  await fs.rm(at, { recursive: true, force: true })
}
