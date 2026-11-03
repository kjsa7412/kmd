// 문서 폴더 가져오기가 읽을 파일 — 지켜보는 폴더에서 문서(md · docx · pptx · xlsx · hwpx · pdf · 그림)로 볼 것.
//
//   들이는 길은 파일 넣기(hub.importFiles · 파일마다 기록 → 정리가 자리를 고른다 · 작성기준 7절). 예전에 이 모듈이 쓰던 사본 문서
//   (첫 줄 표지 watched · 원본이 주인)는 새로 만들지 않는다. 남은 표지는 core/watchmark.js 로 알아보고 저장 · 고치기 · 정리 · 제안이
//   그대로 지킨다(「내 문서로」 · 가져올 곳 지우기가 걷는다).

export const DOC_EXT = /\.(md|markdown|docx|pptx|xlsx|hwpx|hwp|pdf|png|jpe?g|gif|webp|svg|bmp)$/i
// 문서로 볼 파일 — 오피스가 여는 동안 만드는 잠금 파일(~$…) · 임시 파일은 뺀다
export const wantDoc = (p) => DOC_EXT.test(p) && !p.split('/').some((x) => x.startsWith('~$') || x.startsWith('.~'))
