// 되돌리기 — 그 기록을 넣은 항목들을 넣기 전 글로 · 그 기록은 다시 「아직 안 넣은 기록」(v0.6 §6.3 · KM71).
//
//   git revert 는 쓰지 않는다: 표지를 처음 그 기록으로 바꾼 묶음의 앞 판에서 그 항목 글을 꺼낸다.
//   S2 에서 core/curate.js 에서 옮겼다(curate.js 는 다시 내보낸다). 항목 거르기 · base · remove 는 S5(docs/품질개선/KMD_개편_설계.md 3-4 · S-D53).

import { git } from './git.js'
import { readText } from './text.js'
import { parseDoc, headingMatches } from './sections.js'
import { coordsOfSection } from './knowledge.js'
import { KmdError } from './errors.js'

export async function revertPlan(k, recordId) {
  const w = k.byWork.get(recordId)
  if (!w) throw new KmdError('E_NOTFOUND', '그 기록이 없다')
  const sections = []
  for (const d of k.docs) {
    for (const s of d.sections) {
      if (s.applied !== recordId) continue
      // 표지를 처음 이 기록으로 바꾼 묶음 — 그 앞 판의 그 항목 글이 넣기 전 글이다
      //   git log 가 실패하면 앞 판이 없는 것으로 본다(빈 글로 되돌림) · 까닭은 로그에 남긴다
      const log = (await git(k.dir, ['log', '--format=%H', '-S', `<!-- applied: ${recordId} -->`, '--', d.path]).catch((e) => { console.error(`[revert] ${d.path} 이력을 읽지 못했다: ${e?.message || e}`); return '' })).trim().split('\n').filter(Boolean)
      const first = log[log.length - 1]
      const before = first ? await git(k.dir, ['show', `${first}^:${d.path}`]).then(readText, (e) => { console.error(`[revert] ${d.path} 앞 판을 읽지 못했다(빈 글로 되돌림): ${e?.message || e}`); return null }) : null
      const old = before ? parseDoc(before, '').sections.find((x) => headingMatches(x.h, s.h)) : null
      sections.push({ doc: d.path, heading: s.h, content: old ? old.body : '', applied: old ? old.applied || null : null, coords: coordsOfSection(k, d, s.h) })
    }
  }
  return { record: w, sections }
}
