// 문서 감시가 단 표지 — 첫 줄 `<!-- watched: src="이름" path="원본 경로" [missing="날짜"] -->`.
// 저장 · 거두기 · 화면이 「원본이 주인」 인 문서를 알아보는 데 쓴다(docwatch 와 save 가 서로 부르지 않게 따로 둔다).
const MARK = /^<!--\s*watched:\s*(.*?)\s*-->\s*$/
export function watchedOf(text) {
  const m = String(text || '').split('\n', 1)[0].match(MARK)
  return m ? Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])) : null
}
