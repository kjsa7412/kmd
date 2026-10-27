// 결정 규칙 · 되돌리기 — kmd 가 사람 없이 정하는 것(v0.6 §6.1 · §6.3 · KM69 · KM71).
//
//   R-A1  이름이 없는 기록은 「사람이 답한 것」 만 넣지 않기로 둔다(keep) — 본문에 「대상 없음 — 사용자 답」 줄.
//         세션이 이름을 빠뜨린 그 밖의 기록은 두지 않고 정리 일꾼의 「이름 바로잡기」 일감으로 남긴다(E5).
//   R-A2  좌표정정 — 서버가 저장 때 구조로 판정해 touches-fix 를 붙인 기록은 문서에 넣을 것이 아니다 → keep.
//   R-A3  들인 기록의 옛 판 — 같은 출처(태그 ingest/…)에 새 판이 있으면 옛 판은 keep.
//
// 판정은 정리 기록 하나로 남는다(작성자 kmd-auto · 태그 curate-auto · curates). 되돌리기는 옛 본문을 다시 쓰고
// 판정을 거둔다(reopens) — git revert 는 쓰지 않는다. 거둔 기록은 「주인이 되돌림」 이라 다시 초안하지 않는다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { git } from './git.js'
import { readText } from './text.js'
import { parseDoc, headingMatches } from './sections.js'
import { coordsOfSection, isSystemRecord } from './knowledge.js'
import { KmdError } from './errors.js'

export const HUMAN_ANSWER = '대상 없음. 사용자 답'

export function decide(k) {
  const curates = []
  const tasks = []
  const ingest = new Map()
  for (const w of [...k.works].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const src = w.tags.find((t) => t.startsWith('ingest/'))
    if (src) {
      const prev = ingest.get(src)
      if (prev && !k.kept.has(prev.id) && !k.reverted.has(prev.id)) curates.push({ id: prev.id, verdict: 'keep', rule: 'R-A3', reason: `새 판이 있다: ${w.id}` })
      ingest.set(src, w)
    }
    if (k.kept.has(w.id) || k.reverted.has(w.id) || isSystemRecord(w)) continue
    if (w.state === 'nowhere') {
      if (w.body.includes(HUMAN_ANSWER)) curates.push({ id: w.id, verdict: 'keep', rule: 'R-A1', reason: '넣을 곳이 없다고 사람이 답했다' })
      else tasks.push({ id: w.id, kind: 'touches', title: w.title })
    } else if (w.tags.includes('touches-fix') && (w.state === 'pend' || w.state === 'in')) {
      curates.push({ id: w.id, verdict: 'keep', rule: 'R-A2', reason: '이름만 바로잡은 기록이다' })
    }
  }
  return { curates, tasks }
}

export function decisionRecord(curates) {
  return {
    title: `정리: 알아서 한 것 ${curates.length}`,
    body: curates.map((c) => `- ${c.id}: ${c.reason}`).join('\n'),
    tags: ['curate-auto'],
    curates,
  }
}

// 되돌리기 — 그 기록을 넣은 항목들을 넣기 전 글로 · 그 기록은 다시 「아직 안 넣은 기록」
export async function revertPlan(k, recordId) {
  const w = k.byWork.get(recordId)
  if (!w) throw new KmdError('E_NOTFOUND', '그 기록이 없다')
  const sections = []
  for (const d of k.docs) {
    for (const s of d.sections) {
      if (s.applied !== recordId) continue
      // 표지를 처음 이 기록으로 바꾼 묶음 — 그 앞 판의 그 항목 글이 넣기 전 글이다
      const log = (await git(k.dir, ['log', '--format=%H', '-S', `<!-- applied: ${recordId} -->`, '--', d.path]).catch(() => '')).trim().split('\n').filter(Boolean)
      const first = log[log.length - 1]
      const before = first ? await git(k.dir, ['show', `${first}^:${d.path}`]).then(readText, () => null) : null
      const old = before ? parseDoc(before, '').sections.find((x) => headingMatches(x.h, s.h)) : null
      sections.push({ doc: d.path, heading: s.h, content: old ? old.body : '', applied: old ? old.applied || null : null, coords: coordsOfSection(k, d, s.h) })
    }
  }
  return { record: w, sections }
}
