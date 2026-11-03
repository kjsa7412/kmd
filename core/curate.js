// 결정 규칙 · 되돌리기 — kmd 가 사람 없이 정하는 것(v0.6 §6.1 · §6.3 · KM69 · KM71).
//
//   R-A1  이름이 없는 기록은 「사람이 답한 것」 만 넣지 않기로 둔다(keep) — 본문에 「대상 없음 — 사용자 답」 줄.
//         세션이 이름을 빠뜨린 그 밖의 기록은 두지 않고 정리 일꾼의 「이름 바로잡기」 일감으로 남긴다(E5).
//   R-A2  좌표정정 — 서버가 저장 때 구조로 판정해 touches-fix 를 붙인 기록은 문서에 넣을 것이 아니다 → keep.
//   R-A3  들인 기록의 옛 판 — 같은 출처(태그 ingest/…)에 새 판이 있으면 옛 판은 keep(옛 판이 held 거나 새 판의 fixes 가 가리키면 건너뜀 · S3).
//
// S2: R-A3 은 core/ingest.js supersededIngest · decisionRecord 는 core/parts.js · revertPlan 은 core/revert.js 로 옮겼다(다시 내보낸다 · 이 파일은 S13 에 걷는다).
//
// 판정은 정리 기록 하나로 남는다(작성자 kmd-auto · 태그 curate-auto · curates). 되돌리기는 옛 본문을 다시 쓰고
// 판정을 거둔다(reopens) — git revert 는 쓰지 않는다. 거둔 기록은 「주인이 되돌림」 이라 다시 초안하지 않는다.

import { isSystemRecord } from './knowledge.js'
import { supersededIngest } from './ingest.js'

export { decisionRecord } from './parts.js'
export { revertPlan } from './revert.js'

export const HUMAN_ANSWER = '대상 없음. 사용자 답'

export function decide(k) {
  const curates = []
  const tasks = []
  // R-A3 — 새 판을 만나는 차례에 옛 판을 싣는다(옮기기 전과 같은 차례)
  const sup = new Map(supersededIngest(k).map(({ by, ...c }) => [by, c]))
  for (const w of [...k.works].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (sup.has(w.id)) curates.push(sup.get(w.id))
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
