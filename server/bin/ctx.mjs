#!/usr/bin/env node
// 옛 이름 ctx — 한 판만 남긴다(P5). 같은 kmd 를 부르고 한 줄 알린다.
process.stderr.write('ctx 는 kmd 로 이름이 바뀌었다 — 다음 판에서 ctx 는 걷는다\n')
await import('./kmd.mjs')
