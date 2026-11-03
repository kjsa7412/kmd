// 되돌리기 — 그 기록을 넣은 항목들을 넣기 전 글로(설계 3-4 · S-D13 · S-D53).
//
//   git revert 는 쓰지 않는다: 표지를 처음 그 기록으로 바꾼 묶음의 앞 판에서 그 항목 글을 꺼낸다.
//   { doc, heading } 을 주면 그 항목(들)만 · 항목마다 base(지금 글의 지문 — 되돌리기 사이 누가 고쳤으면 저장이 E_CONFLICT) ·
//   앞 판에 그 항목이 없으면(그 기록이 세운 항목 · 첫 커밋 문서) 빈 글 대신 remove(빈 머리가 남지 않게).
//   git 을 읽지 못하면 던진다(E_GIT) — 앞 판을 모르는 채 항목을 지우거나 비우지 않게.

import { git, tryGit } from './git.js'
import { readText, sha16 } from './text.js'
import { parseDoc, headingMatches } from './sections.js'
import { coordsOfSection } from './knowledge.js'
import { KmdError } from './errors.js'

// 그 기록이 처음 표지를 단 묶음의 앞 판 문서 글 — 앞 판에 문서가 없으면 null
async function beforeText(dir, rel, recordId) {
  const log = await git(dir, ['log', '--format=%H', '-S', `<!-- applied: ${recordId} -->`, '--', rel]).catch((e) => {
    console.error(`[revert] ${rel} 이력을 읽지 못했다: ${e?.message || e}`)
    throw new KmdError('E_GIT', `「${rel}」 의 이력을 읽지 못해 되돌리지 않았다`)
  })
  const shas = log.trim().split('\n').filter(Boolean)
  const first = shas[shas.length - 1]
  // 표지를 단 묶음이 없다(손으로 달고 아직 커밋하지 않은 표지) — 앞 판을 모르니 지우지도 비우지도 않는다
  if (!first) throw new KmdError('E_CONFLICT', `「${rel}」 에서 그 기록을 넣은 묶음을 찾지 못했다. 문서를 열어 손으로 고친다`)
  // 첫 커밋이면 앞 판이 없다 · 앞 판에 그 문서가 없으면(이 기록이 세운 문서) 없다
  if (!(await tryGit(dir, ['rev-parse', '--verify', '-q', `${first}^`])).ok) return null
  const ls = await tryGit(dir, ['ls-tree', '--name-only', `${first}^`, '--', rel])
  if (!ls.ok) {
    console.error(`[revert] ${rel} 앞 판을 찾지 못했다: ${ls.err}`)
    throw new KmdError('E_GIT', `「${rel}」 의 앞 판을 읽지 못해 되돌리지 않았다`)
  }
  if (!ls.out.trim()) return null
  return readText(await git(dir, ['show', `${first}^:${rel}`]).catch((e) => {
    console.error(`[revert] ${rel} 앞 판을 읽지 못했다: ${e?.message || e}`)
    throw new KmdError('E_GIT', `「${rel}」 의 앞 판을 읽지 못해 되돌리지 않았다`)
  }))
}

// { record, sections: [{ doc, heading, content, applied, coords, base, remove? }] } — 지금 그 기록이 표지인 항목만(live)
export async function revertPlan(k, recordId, { doc = null, heading = null } = {}) {
  const w = k.byWork.get(recordId)
  if (!w) throw new KmdError('E_NOTFOUND', '그 기록이 없다')
  const sections = []
  for (const d of k.docs) {
    if (doc && d.path !== doc) continue
    for (const s of d.sections) {
      if (s.applied !== recordId) continue
      if (heading && !headingMatches(s.h, heading)) continue
      const before = await beforeText(k.dir, d.path, recordId)
      const old = before ? parseDoc(before, '').sections.find((x) => headingMatches(x.h, s.h)) : null
      const base = sha16(s.body)
      const coords = coordsOfSection(k, d, s.h)
      if (old) sections.push({ doc: d.path, heading: s.h, content: old.body, applied: old.applied || null, coords, base })
      else sections.push({ doc: d.path, heading: s.h, content: '', applied: null, coords, base, remove: true })
    }
  }
  return { record: w, sections }
}
