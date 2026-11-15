// kmd 로고 — 한 벌의 모양(마크 + 글자표). 화면(main.js) · 서버 페이지(설명서 · 받기) · 파일(logo.svg · favicon.svg · site)이 모두 이 줄기를 쓴다.
//   마크: 잉크 칸(장부 한 칸 · 32 · 모서리 7.5 · 테 1) 안의 k 획 셋과 민트 갈래 점 하나(가지 끝 · 서명)
//   글자표: 「kmd」 를 획 3 의 선으로 그린 것(글꼴에 기대지 않는다 · 끝 둥근)
//   색은 CSS 토큰으로만 칠한다(kmd.css 의 .lg 한 줄 · 서버 페이지는 그 줄을 떼어 싣는다) · 파일로 쓸 때만 아래 FILE 의 hex 를 쓴다
// 이 파일을 고치면 node scripts/logo.mjs 로 logo.svg · favicon.svg(app · site)를 다시 짓는다
export const LOGO = {
  tile: 'M8 .5h16A7.5 7.5 0 0 1 31.5 8v16a7.5 7.5 0 0 1-7.5 7.5H8A7.5 7.5 0 0 1 .5 24V8A7.5 7.5 0 0 1 8 .5z',
  k: 'M11 8.5V23.5 M11 19L17.8 12.2 M14.4 15.6L20.5 23.5',
  dot: [21.5, 8.5, 2.5],
  word: 'M44 4V25 M44 20.5L51.5 13 M47.3 17.2L52 25 M57 13V25 M57 17.5a4.5 4.5 0 0 1 9 0V25 M66 17.5a4.5 4.5 0 0 1 9 0V25 M92.5 4V25 M86.5 13a6 6 0 1 0 0 12a6 6 0 1 0 0-12',
  wMark: 32, wFull: 94, h: 32
}
// 파일(img · 파비콘)로 쓸 때의 색 — 토큰 값과 같다(--nav-bg · --nav-line · --nav-text · --nav-accent · --text)
export const FILE = { tile: '#141416', line: '#3a3a3d', k: '#ededed', dot: '#6ee7d4', word: '#141416', wordDark: '#ededed' }

// 화면에 바로 넣는 SVG — word 면 글자표까지 · 이름은 aria-label(꾸밈이면 hidden)
export function logoSvg({ word = true, cls = '', label = 'kmd', hidden = false } = {}) {
  const L = LOGO, w = word ? L.wFull : L.wMark
  const a11y = hidden ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${label}"`
  return `<svg class="lg${cls ? ' ' + cls : ''}" viewBox="0 0 ${w} ${L.h}" ${a11y}><path class="lg-t" d="${L.tile}"/><path class="lg-k" d="${L.k}"/><circle class="lg-d" cx="${L.dot[0]}" cy="${L.dot[1]}" r="${L.dot[2]}"/>${word ? `<path class="lg-w" d="${L.word}"/>` : ''}</svg>`
}

