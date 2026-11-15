// 로고 파일 짓기: node scripts/logo.mjs
// app/logo.js 의 모양 한 벌(LOGO · FILE 색)로 파일을 다시 짓는다 — 손으로 고치지 않는다
//   app/logo.svg      마크 + 글자표(글자표는 밝은 바탕 잉크 · 어두운 바탕(prefers-color-scheme) 밝은 글)
//   app/favicon.svg   마크만(잉크 칸 · 밝은 k · 민트 갈래 점) — 어두운 탭 바탕에서도 칸 테로 보인다
//   site/favicon.svg  같은 마크(소개 사이트)
// 화면 · 서버 페이지는 파일이 아니라 logoSvg()(app/logo.js)를 그대로 넣는다(색은 kmd.css 토큰)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOGO, FILE } from '../app/logo.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mark = `<path d="${LOGO.tile}" fill="${FILE.tile}" stroke="${FILE.line}" stroke-width="1"/><path d="${LOGO.k}" fill="none" stroke="${FILE.k}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${LOGO.dot[0]}" cy="${LOGO.dot[1]}" r="${LOGO.dot[2]}" fill="${FILE.dot}"/>`
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO.wFull} ${LOGO.h}" role="img" aria-label="kmd"><style>.w{stroke:${FILE.word}}@media (prefers-color-scheme:dark){.w{stroke:${FILE.wordDark}}}</style>${mark}<path class="w" d="${LOGO.word}" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO.wMark} ${LOGO.h}">${mark}</svg>\n`
const out = { 'app/logo.svg': full, 'app/favicon.svg': icon, 'site/favicon.svg': icon }
for (const [f, s] of Object.entries(out)) { fs.writeFileSync(path.join(ROOT, f), s); console.log(f, s.length) }
