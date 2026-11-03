// kmd 가 쓰는 기록 칸 · 판정 기록(docs/kmd_문서_작성기준.md 2-3 · docs/품질개선/KMD_개편_설계.md 2-2 · 3-1).
//
//   S2: 옛 core/curate.js 의 decisionRecord 만 옮겼다(curate.js 는 다시 내보낸다).
//   `## 넣은 것` · `## 넣지 못함` · `## 되돌린 항목` 칸을 쓰고 읽는 함수는 S3 에 여기 더한다. 이 모듈은 다른 kmd 모듈을 부르지 않는다.

export function decisionRecord(curates) {
  return {
    title: `정리: 알아서 한 것 ${curates.length}`,
    body: curates.map((c) => `- ${c.id}: ${c.reason}`).join('\n'),
    tags: ['curate-auto'],
    curates,
  }
}
